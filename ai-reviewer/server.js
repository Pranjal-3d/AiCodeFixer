require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const OpenAI = require("openai");
const { initCollection, saveAnalysis, searchHistory, getRepoHistory, getAvailableRepos } = require("./vectordb");

console.log("✅ Loaded ai-reviewer/server.js");

initCollection().catch(err => console.error("⚠️  Qdrant init failed:", err.message));

const app = express();
app.use(express.json());

app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));

const PORT = process.env.PORT || 5000;

// ================= CONFIG =================

const ALLOWED_EXTENSIONS = [".js", ".ts", ".tsx", ".py", ".jsx"]; 
const MAX_ANALYZE_FILES = 5;
const MAX_CONTENT_LENGTH = 1500;

let USER_GITHUB_TOKEN = null;
let LAST_ANALYSIS = null;

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:5000",
    "X-Title": "AI Code Reviewer"
  }
});

// ================= TOKEN HELPER =================

function getGithubToken(options = {}) {
  const { includeEnv = true } = options;
  if (USER_GITHUB_TOKEN) return USER_GITHUB_TOKEN;
  return includeEnv ? process.env.GITHUB_TOKEN : null;
}

// ================= HELPERS =================

function extractRepoDetailsFromGithubUrl(inputUrl) {
  let url;
  try {
    url = new URL(inputUrl);
  } catch {
    throw new Error("Invalid GitHub URL. Please provide a valid https://github.com/... link.");
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error("Only github.com URLs are supported.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("GitHub URL must include owner and repository.");
  const [owner, repo] = parts;
  return { owner, repo };
}

async function getDefaultBranch(owner, repo) {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  return response.data.default_branch;
}

async function getRepoTree(owner, repo, branch) {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  return response.data.tree;
}

function isValidCodeFile(path) {
  if (path.startsWith(".")) return false;
  if (path.includes("/.")) return false;
  if (path.includes("node_modules")) return false;
  return ALLOWED_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));
}

async function fetchFileContent(owner, repo, branch, filePath) {
  console.log(`   📄 Fetching: ${filePath}`);
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  const full = Buffer.from(response.data.content, "base64").toString("utf-8");
  return { full, preview: full.substring(0, MAX_CONTENT_LENGTH) };
}

// ================= AI ANALYSIS =================

async function analyzeWithAI(filePath, content, issueToFix) {
  console.log(`   🤖 Sending to AI: ${filePath} (${content.length} chars)`);
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a senior engineer. Return only JSON." },
      {
        role: "user",
        content: `Fix the following code.

Priority user request:
${issueToFix ? issueToFix : "No specific issue was provided. Fix the most important defects and code quality issues you can find."}

Return JSON:
{
  "summary": "",
  "issues_found": [],
  "fixed_code": ""
}

Rules:
- fixed_code must be the COMPLETE corrected file as plain text (no markdown fences).
- If no changes are needed, return fixed_code as empty string "".

File: ${filePath}

Code:
${content}`
      }
    ],
    temperature: 0.2
  });
  const raw = response.choices[0].message.content;
  console.log(`   🤖 AI raw (first 300): ${raw.substring(0, 300)}`);
  return raw;
}

function safeParse(raw) {
  try {
    if (typeof raw !== "string") return null;
    return JSON.parse(raw);
  } catch {
    try {
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first === -1 || last === -1) return null;
      return JSON.parse(raw.slice(first, last + 1));
    } catch { return null; }
  }
}

function stripCodeFences(text) {
  if (typeof text !== "string") return "";
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

function normalizeFixedCode(fixedCode) {
  if (typeof fixedCode !== "string") return "";
  return stripCodeFences(fixedCode).trim();
}

// ================= GITHUB AUTOMATION =================

async function getLatestCommitSha(owner, repo, branch) {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  return response.data.object.sha;
}

async function createBranch(owner, repo, baseBranch, newBranch) {
  const sha = await getLatestCommitSha(owner, repo, baseBranch);
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    { ref: `refs/heads/${newBranch}`, sha },
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  console.log(`   ✅ Branch created: ${newBranch}`);
}

async function commitFile(owner, repo, branch, filePath, fixedContent, originalFullContent) {
  if (fixedContent === originalFullContent) {
    return { skipped: true, reason: "unchanged" };
  }
  const fileData = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  const sha = fileData.data.sha;
  const encoded = Buffer.from(fixedContent).toString("base64");
  const putResponse = await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    { message: `AI Fix: Updated ${filePath}`, content: encoded, branch, sha },
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  const commit = putResponse.data?.commit;
  return { skipped: false, commit: commit || null };
}

async function createPullRequest(owner, repo, baseBranch, newBranch) {
  const response = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      title: "AI Auto Fix",
      head: `${owner}:${newBranch}`,
      base: baseBranch,
      body: "Automated fixes generated by AI Code Reviewer"
    },
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  return response.data.html_url;
}

// ================= GITHUB LOGIN =================

app.get("/auth/github/login", (req, res) => {
  const url =
    "https://github.com/login/oauth/authorize" +
    "?client_id=" + process.env.GITHUB_CLIENT_ID +
    "&scope=repo";
  res.redirect(url);
});

app.get("/auth/github/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const response = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      },
      { headers: { Accept: "application/json" } }
    );
    USER_GITHUB_TOKEN = response.data.access_token;
    console.log(`✅ GitHub OAuth success. Token starts: ${USER_GITHUB_TOKEN?.substring(0, 8)}...`);
    res.redirect("http://localhost:5173/?github_login=success");
  } catch (err) {
    console.error("❌ GitHub OAuth failed:", err.message);
    res.redirect("http://localhost:5173/?github_login=error");
  }
});

// ================= AUTH STATUS =================

app.get("/auth/status", async (req, res) => {
  if (!USER_GITHUB_TOKEN) return res.json({ authenticated: false, user: null });
  try {
    const response = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${USER_GITHUB_TOKEN}` }
    });
    res.json({
      authenticated: true,
      user: {
        login: response.data.login,
        avatar_url: response.data.avatar_url,
        html_url: response.data.html_url
      }
    });
  } catch {
    USER_GITHUB_TOKEN = null;
    res.json({ authenticated: false, user: null });
  }
});

// ================= AUTH LOGOUT =================

app.post("/auth/logout", (req, res) => {
  USER_GITHUB_TOKEN = null;
  res.json({ success: true });
});

app.get("/", (req, res) => res.send("AI Code Reviewer API running"));

// ================= LIST USER REPOS =================

app.get("/repos", async (req, res) => {
  const token = getGithubToken();
  if (!token) return res.status(401).json({ error: "Not authenticated. Log in with GitHub first." });

  try {
    const response = await axios.get("https://api.github.com/user/repos", {
      headers: { Authorization: `token ${token}` },
      params: {
        visibility: "all",
        affiliation: "owner,collaborator,organization_member",
        sort: "pushed",
        per_page: 100
      }
    });

    const repos = response.data.map(r => ({
      id: r.id,
      full_name: r.full_name,
      html_url: r.html_url,
      description: r.description,
      private: r.private,
      language: r.language,
      stargazers_count: r.stargazers_count,
      updated_at: r.updated_at,
      default_branch: r.default_branch
    }));

    res.json({ repos });
  } catch (err) {
    console.error("❌ /repos failed:", err.message);
    res.status(500).json({ error: "Failed to fetch repos", details: err.message });
  }
});

// ================= LIST REPO FILES =================
// NEW: Returns all valid code files for a given repo so the frontend
// can render a file picker instead of asking the user to type a path.

app.get("/repos/:owner/:repo/files", async (req, res) => {
  const token = getGithubToken();
  if (!token) return res.status(401).json({ error: "Not authenticated." });

  const { owner, repo } = req.params;

  try {
    const repoData = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: { Authorization: `token ${token}` } }
    );
    const branch = repoData.data.default_branch;

    const treeData = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { Authorization: `token ${token}` } }
    );

    const files = treeData.data.tree
      .filter(f => f.type === "blob" && isValidCodeFile(f.path))
      .map(f => ({ path: f.path, size: f.size }));

    res.json({ owner, repo, branch, files });
  } catch (err) {
    console.error(`❌ /repos/${owner}/${repo}/files failed:`, err.message);
    res.status(500).json({ error: "Failed to fetch repo files", details: err.message });
  }
});

// ================= ANALYZE =================

app.post("/analyze", async (req, res) => {
  const { repo_url, issue_to_fix, selected_files } = req.body;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔍 /analyze called — repo_url: ${repo_url}`);
  console.log(`🧾 issue_to_fix: ${issue_to_fix ? issue_to_fix.substring(0, 120) : "NONE"}`);
  console.log(`📋 selected_files: ${selected_files ? JSON.stringify(selected_files) : "NONE (auto-select)"}`);

  if (!repo_url) return res.status(400).json({ error: "repo_url required" });

  const token = getGithubToken();
  if (!token) return res.status(401).json({ error: "Not authenticated." });

  try {
    const { owner, repo } = extractRepoDetailsFromGithubUrl(repo_url);
    const branch = await getDefaultBranch(owner, repo);
    const tree = await getRepoTree(owner, repo, branch);

    let validFiles = tree.filter(f => f.type === "blob" && isValidCodeFile(f.path));

    // If frontend sent specific files, filter to those; otherwise auto-pick top 5
    if (Array.isArray(selected_files) && selected_files.length > 0) {
      validFiles = validFiles.filter(f => selected_files.includes(f.path));
    } else {
      validFiles = validFiles.slice(0, MAX_ANALYZE_FILES);
    }

    console.log(`📋 Files selected for analysis: ${validFiles.length}`);

    const results = [];

    for (const file of validFiles) {
      console.log(`\n${"─".repeat(40)}`);
      console.log(`📄 Processing: ${file.path}`);
      try {
        const { full, preview } = await fetchFileContent(owner, repo, branch, file.path);
        const ai = await analyzeWithAI(file.path, preview, issue_to_fix);
        const parsed = safeParse(ai);
        if (!parsed) { console.log(`❌ Could not parse AI JSON for: ${file.path}`); continue; }

        const fixedCode = normalizeFixedCode(parsed.fixed_code);
        results.push({
          path: file.path,
          summary: parsed.summary,
          issues_found: parsed.issues_found,
          fixed_code: fixedCode,
          full_original: full,
          has_fix: !!fixedCode
        });
      } catch (fileErr) {
        console.error(`❌ Error on ${file.path}: ${fileErr.message}`);
      }
    }

    LAST_ANALYSIS = { owner, repo, branch, results };
    saveAnalysis({ owner, repo, branch, results })
      .catch(err => console.error("⚠️  Vector save failed (non-fatal):", err.message));

    res.json({
      repository: `${owner}/${repo}`,
      files_analyzed: results.length,
      results: results.map(r => ({
        path: r.path,
        summary: r.summary,
        issues_found: r.issues_found,
        fixed_code: r.fixed_code,
        has_fix: r.has_fix
      }))
    });

  } catch (err) {
    console.error(`❌ /analyze failed: ${err.message}`);
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

// ================= CREATE PR =================

app.post("/create-pr", async (req, res) => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔀 /create-pr called`);

  try {
    if (!LAST_ANALYSIS) return res.status(400).json({ error: "Run analysis first" });

    const token = getGithubToken();
    if (!token) return res.status(401).json({ error: "No GitHub token." });

    const { owner, repo, branch, results } = LAST_ANALYSIS;
    const newBranch = `ai-fix-${Date.now()}`;

    await createBranch(owner, repo, branch, newBranch);

    const committed_files = [];
    const skipped_files = [];
    const failed_files = [];

    for (const file of results) {
      const fixedCode = file.fixed_code;
      if (!file.has_fix || !fixedCode) { skipped_files.push({ path: file.path, reason: "no fix generated" }); continue; }
      if (!file.full_original) { skipped_files.push({ path: file.path, reason: "full_original missing" }); continue; }

      try {
        const commitResult = await commitFile(owner, repo, newBranch, file.path, fixedCode, file.full_original);
        if (commitResult?.skipped) { skipped_files.push({ path: file.path, reason: commitResult.reason }); continue; }
        committed_files.push({ path: file.path, commit_sha: commitResult.commit?.sha || null });
      } catch (fileErr) {
        failed_files.push({ path: file.path, error: fileErr?.response?.data?.message || fileErr.message });
      }
    }

    if (!committed_files.length) {
      return res.status(400).json({
        error: "No commits created. PR not opened.",
        skipped_files,
        failed_files
      });
    }

    const pr = await createPullRequest(owner, repo, branch, newBranch);

    let commit_messages = [];
    try {
      const compare = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/compare/${branch}...${newBranch}`,
        { headers: { Authorization: `token ${getGithubToken()}` } }
      );
      commit_messages = (compare.data?.commits || []).map(c => c.commit?.message).filter(Boolean);
    } catch (err) {
      console.error(`⚠️  Compare fetch failed: ${err.message}`);
    }

    res.json({ message: "PR created successfully", pull_request: pr, committed_files, skipped_files, failed_files, commit_messages });

  } catch (err) {
    console.error(`❌ /create-pr failed: ${err.message}`);
    res.status(500).json({ error: "PR creation failed", details: err.message });
  }
});

// ================= HISTORY =================

// Returns all unique owner/repo pairs that have been analyzed
app.get("/history/repos", async (req, res) => {
  try {
    const repos = await getAvailableRepos();
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/history/repos", async (req, res) => {
  try {
    const repos = await getAvailableRepos();
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/history/:owner/:repo", async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const history = await getRepoHistory(owner, repo);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= START SERVER =================

app.listen(PORT, () => {
  console.log(`🚀 AI Code Reviewer running on http://localhost:${PORT}`);
});