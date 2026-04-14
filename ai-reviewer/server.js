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

const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".exe", ".dll", ".so", ".bin", ".woff", ".woff2", ".ttf", ".eot", ".ico", ".svg"];
const MAX_ANALYZE_FILES = 10;
const MAX_CONTENT_LENGTH = 50000;

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
  const isBinary = BINARY_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));
  return !isBinary;
}

async function fetchFileContent(owner, repo, branch, filePath) {
  console.log(`   📄 Fetching: ${filePath}`);
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  const full = Buffer.from(response.data.content, "base64").toString("utf-8");

  // Create line-numbered version for AI context
  const lines = full.split("\n");
  const numbered = lines.map((line, idx) => `${idx + 1}: ${line}`).join("\n");
  const preview = numbered.substring(0, MAX_CONTENT_LENGTH);

  return { full, preview, totalLines: lines.length };
}

// ================= AI FILE SELECTION =================

async function selectFilesWithAI(fileList, issueToFix) {
  console.log(`   🤖 Asking AI to select relevant files for: "${issueToFix}"`);
  const response = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a senior engineer. Given a list of files in a repository and a user issue, identify which files (up to 10) are most likely to need changes. Return only JSON."
      },
      {
        role: "user",
        content: `User Issue: "${issueToFix}"
        
Files:
${fileList.map(f => f.path).join("\n")}

Return JSON:
{
  "selected_files": ["path/to/file1", "path/to/file2"]
}
`
      }
    ],
    temperature: 0
  });

  const raw = response.choices[0].message.content;
  const parsed = safeParse(raw);
  const selected = parsed?.selected_files || [];
  console.log(`   🤖 AI selected ${selected.length} files: ${selected.join(", ")}`);
  return selected;
}

// ================= AI ANALYSIS =================

async function analyzeWithAI(filePath, content, issueToFix) {
  console.log(`   🤖 Sending to AI: ${filePath} (${content.length} chars)`);
  const response = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a senior engineer. You will receive code with line numbers (e.g., '1: line'). Analyze and fix the code according to the user request. You may also suggest new files that need to be created. Return only JSON."
      },
      {
        role: "user",
        content: `Fix the following code. Use the provided line numbers for context, but do NOT include them in the output.

Priority user request:
${issueToFix ? issueToFix : "No specific issue was provided. Fix the most important defects and code quality issues you can find."}

Return JSON:
{
  "summary": "",
  "issues_found": [],
  "fixed_code": "",
  "new_files": []
}

Rules:
- 'fixed_code' must be the COMPLETE corrected file as plain text (no markdown fences, no line numbers). If no changes needed, return "".
- 'new_files' is an optional array of new files to create. Each item: { "path": "relative/path/to/file.ext", "content": "full file content here" }. Leave as [] if no new files are needed.

File: ${filePath}

Code (with line numbers):
${content}`
      }
    ],
    temperature: 0.2
  });
  const raw = response.choices[0].message.content;
  console.log(`   🤖 AI response for ${filePath} received.`);
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

  const encoded = Buffer.from(fixedContent).toString("base64");
  let sha = null;

  // Try to get the existing file's SHA — if the file is new it won't exist (404)
  try {
    const fileData = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
      { headers: { Authorization: `token ${getGithubToken()}` } }
    );
    sha = fileData.data.sha;
  } catch (err) {
    if (err.response?.status === 404) {
      // File doesn't exist yet — we'll create it (no sha needed)
      console.log(`   📄 New file detected: ${filePath} — will be created.`);
    } else {
      throw err; // Re-throw unexpected errors
    }
  }

  const body = {
    message: sha ? `AI Fix: Updated ${filePath}` : `AI Fix: Created ${filePath}`,
    content: encoded,
    branch,
    ...(sha && { sha }) // only include sha when updating an existing file
  };

  const putResponse = await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    body,
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
    
    if (response.data.error) {
      console.error("❌ GitHub OAuth response error:", response.data.error, response.data.error_description);
      return res.redirect("http://localhost:5173/?github_login=error&error=" + response.data.error);
    }

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

    let allBlobs = tree.filter(f => f.type === "blob");
    let validFiles = allBlobs.filter(f => isValidCodeFile(f.path));

    console.log(`📊 Tree stats: total blobs: ${allBlobs.length}, valid code files: ${validFiles.length}`);

    if (validFiles.length === 0) {
      return res.status(400).json({ error: "No valid code files found in the repository." });
    }

    // If frontend sent specific files, filter to those; 
    // Otherwise use AI to pick the most relevant files from the repo
    if (Array.isArray(selected_files) && selected_files.length > 0) {
      validFiles = validFiles.filter(f => selected_files.includes(f.path));
    } else {
      const aiSelectedPaths = await selectFilesWithAI(validFiles, issue_to_fix);
      if (aiSelectedPaths.length > 0) {
        // Robust matching: trim, remove leading dots/slashes, handle case insensitivity if needed
        const normalizedSelected = aiSelectedPaths.map(p => p.trim().replace(/^\.?\//, ""));
        const filtered = validFiles.filter(f =>
          normalizedSelected.includes(f.path) ||
          normalizedSelected.some(sel => f.path.endsWith(sel))
        );

        if (filtered.length > 0) {
          validFiles = filtered;
        } else {
          console.log(`⚠️  AI selected paths but none matched valid files. Falling back to top ${MAX_ANALYZE_FILES}.`);
          validFiles = validFiles.slice(0, MAX_ANALYZE_FILES);
        }
      } else {
        console.log(`⚠️  AI returned no selections. Falling back to top ${MAX_ANALYZE_FILES}.`);
        validFiles = validFiles.slice(0, MAX_ANALYZE_FILES);
      }
    }

    console.log(`📋 Files selected for analysis: ${validFiles.length} (${validFiles.map(v => v.path).join(", ")})`);

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

        // Collect any new files the AI wants to create
        const newFiles = Array.isArray(parsed.new_files)
          ? parsed.new_files.filter(f => f && f.path && typeof f.content === 'string')
          : [];
        if (newFiles.length) console.log(`   📄 AI wants to create ${newFiles.length} new file(s): ${newFiles.map(f => f.path).join(', ')}`);

        results.push({
          path: file.path,
          summary: parsed.summary,
          issues_found: parsed.issues_found,
          fixed_code: fixedCode,
          full_original: full,
          has_fix: !!fixedCode,
          new_files: newFiles
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

      // Commit any new files the AI suggested creating
      if (Array.isArray(file.new_files)) {
        for (const nf of file.new_files) {
          try {
            console.log(`   📄 Creating new file: ${nf.path}`);
            const nfResult = await commitFile(owner, repo, newBranch, nf.path, nf.content, "__NEW_FILE__");
            if (!nfResult?.skipped) committed_files.push({ path: nf.path, commit_sha: nfResult.commit?.sha || null, created: true });
          } catch (nfErr) {
            failed_files.push({ path: nf.path, error: nfErr?.response?.data?.message || nfErr.message });
          }
        }
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

// ================= CHATBOT =================

app.post("/chat", async (req, res) => {
  const { message, history } = req.body;
  if (!message) return res.status(400).json({ error: "Message required" });

  try {
    let context = "No code analysis context available yet.";
    if (LAST_ANALYSIS) {
      context = `You are "GitFix AI", an expert AI code review assistant.
      Current Repository Context:
      Repository: ${LAST_ANALYSIS.owner}/${LAST_ANALYSIS.repo}
      Branch: ${LAST_ANALYSIS.branch}
      
      Latest Analysis & Automated Fixes:
      ${LAST_ANALYSIS.results.map(r => `[File: ${r.path}]\n- Summary of changes: ${r.summary || "No summary"}\n- Issues identified: ${Array.isArray(r.issues_found) ? r.issues_found.join(", ") : (r.issues_found || "None")}`).join("\n\n")}
      
      Your Role:
      1. If the user asks about the changes, expertly explain the summaries and the reasoning behind the fixes made.
      2. If the user asks general questions about the repository or the defects, answer based on the context above.
      3. Be highly helpful, technical, yet concise. Explain WHY certain issues are flagged and why the fixes address them.
      4. Use Markdown formatting (code blocks, bullet points) to make your explanation readable.`;
    }

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini", // Switching to the same model used for analysis
      messages: [
        { role: "system", content: context },
        ...(history || []),
        { role: "user", content: message }
      ],
      temperature: 0.7
    });

    const reply = response.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error("❌ /chat failed:", err.message);
    res.status(500).json({ error: "Chatbot error", details: err.message });
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

app.get("/history/search", async (req, res) => {
  const { q } = req.query;
  try {
    const results = await searchHistory(q || "");
    res.json({ results });
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