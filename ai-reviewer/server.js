require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const OpenAI = require("openai");

console.log("✅ Loaded ai-reviewer/server.js");

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

function extractRepoDetails(repoUrl) {
  const parts = repoUrl.replace(/\/$/, "").split("/");
  return {
    owner: parts[parts.length - 2],
    repo: parts[parts.length - 1]
  };
}

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

  const parts = url.pathname
    .split("/")
    .filter(Boolean);

  if (parts.length < 2) {
    throw new Error("GitHub URL must include owner and repository.");
  }

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

// Returns FULL file content AND a short preview for AI
async function fetchFileContent(owner, repo, branch, filePath) {
  console.log(`   📄 Fetching: ${filePath}`);
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  const full = Buffer.from(response.data.content, "base64").toString("utf-8");
  console.log(`   📄 Full file length: ${full.length} chars`);
  return {
    full,
    preview: full.substring(0, MAX_CONTENT_LENGTH)
  };
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
        content: "You are a senior engineer. Return only JSON."
      },
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
  console.log(`   🤖 AI raw response length: ${raw.length} chars`);
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
    } catch {
      return null;
    }
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
  console.log(`   🌿 Creating branch: ${newBranch} from ${baseBranch}`);
  const sha = await getLatestCommitSha(owner, repo, baseBranch);
  console.log(`   🌿 Base SHA: ${sha}`);
  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    { ref: `refs/heads/${newBranch}`, sha },
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  console.log(`   ✅ Branch created: ${newBranch}`);
}

async function commitFile(owner, repo, branch, filePath, fixedContent, originalFullContent) {
  console.log(`\n   📝 commitFile() called for: ${filePath}`);
  console.log(`   📝 fixedContent length   : ${fixedContent.length}`);
  console.log(`   📝 originalContent length: ${originalFullContent.length}`);
  console.log(`   📝 Are they identical?   : ${fixedContent === originalFullContent}`);
  console.log(`   📝 original (first 200):\n${originalFullContent.substring(0, 200)}`);
  console.log(`   📝 fixed    (first 200):\n${fixedContent.substring(0, 200)}`);

  if (fixedContent === originalFullContent) {
    console.log(`   ⏭️  Skipping — content unchanged`);
    return { skipped: true, reason: "unchanged" };
  }

  // Fetch file SHA for the PUT request
  console.log(`   📝 Fetching file SHA from branch: ${branch}`);
  const fileData = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );
  const sha = fileData.data.sha;
  console.log(`   📝 File SHA: ${sha}`);

  const encoded = Buffer.from(fixedContent).toString("base64");
  console.log(`   📝 Encoded content length: ${encoded.length}`);
  console.log(`   📝 Sending PUT to GitHub for branch: ${branch}`);

  const putResponse = await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    {
      message: `AI Fix: Updated ${filePath}`,
      content: encoded,
      branch,
      sha
    },
    { headers: { Authorization: `token ${getGithubToken()}` } }
  );

  const commit = putResponse.data?.commit;
  console.log(`   ✅ Committed! SHA: ${commit?.sha}`);
  console.log(`   ✅ Commit message: ${commit?.message}`);
  return { skipped: false, commit: commit || null };
}

async function createPullRequest(owner, repo, baseBranch, newBranch) {
  console.log(`\n   🔀 Creating PR: ${newBranch} → ${baseBranch}`);
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
  console.log(`   ✅ PR created: ${response.data.html_url}`);
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
  if (!USER_GITHUB_TOKEN) {
    return res.json({ authenticated: false, user: null });
  }
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

// ================= ROUTES =================

app.get("/", (req, res) => {
  res.send("AI Code Reviewer API running");
});

// ================= ANALYZE =================

app.post("/analyze", async (req, res) => {
  const { repo_url, issue_to_fix } = req.body;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔍 /analyze called — repo_url: ${repo_url}`);
  console.log(`🧾 issue_to_fix: ${issue_to_fix ? issue_to_fix.substring(0, 120) : "NONE"}`);

  if (!repo_url) {
    return res.status(400).json({ error: "repo_url required" });
  }

  const token = getGithubToken();
  console.log(`🔑 Token available: ${!!token} | starts: ${token?.substring(0, 8) || "NONE"}`);

  try {
    const { owner, repo } = extractRepoDetailsFromGithubUrl(repo_url);
    console.log(`📦 Parsed repo: ${owner}/${repo}`);

    const branch = await getDefaultBranch(owner, repo);
    console.log(`🌿 Default branch: ${branch}`);

    const tree = await getRepoTree(owner, repo, branch);
    console.log(`🌳 Total tree entries: ${tree.length}`);

    const validFiles = tree.filter(f => f.type === "blob" && isValidCodeFile(f.path));
    console.log(`✅ Valid code files found: ${validFiles.length}`);
    validFiles.forEach(f => console.log(`   - ${f.path}`));

    const selected = validFiles.slice(0, MAX_ANALYZE_FILES);
    console.log(`📋 Files selected for analysis: ${selected.length}`);

    const results = [];

    for (const file of selected) {
      console.log(`\n${"─".repeat(40)}`);
      console.log(`📄 Processing: ${file.path}`);
      try {
        const { full, preview } = await fetchFileContent(owner, repo, branch, file.path);
        const ai = await analyzeWithAI(file.path, preview, issue_to_fix);
        const parsed = safeParse(ai);

        if (!parsed) {
          console.log(`❌ Could not parse AI JSON for: ${file.path}`);
          continue;
        }

        const fixedCode = normalizeFixedCode(parsed.fixed_code);
        console.log(`📊 summary        : ${String(parsed.summary).substring(0, 100)}`);
        console.log(`📊 issues count   : ${Array.isArray(parsed.issues_found) ? parsed.issues_found.length : "N/A"}`);
        console.log(`📊 fixed_code len : ${fixedCode.length}`);
        console.log(`📊 has_fix        : ${!!fixedCode}`);

        results.push({
          path: file.path,
          summary: parsed.summary,
          issues_found: parsed.issues_found,
          fixed_code: fixedCode,
          full_original: full,   // full original stored for accurate commit comparison
          has_fix: !!fixedCode
        });
      } catch (fileErr) {
        console.error(`❌ Error on ${file.path}: ${fileErr.message}`);
        if (fileErr.response) {
          console.error(`   HTTP ${fileErr.response.status}: ${JSON.stringify(fileErr.response.data)}`);
        }
      }
    }

    LAST_ANALYSIS = { owner, repo, branch, results };
    console.log(`\n✅ Analysis done. Results: ${results.length} | With fixes: ${results.filter(r => r.has_fix).length}`);

    res.json({
      repository: `${owner}/${repo}`,
      files_analyzed: results.length,
      results: results.map(r => ({
        path: r.path,
        summary: r.summary,
        issues_found: r.issues_found,
        fixed_code: r.fixed_code,
        has_fix: r.has_fix
        // full_original intentionally excluded from response (potentially large)
      }))
    });

  } catch (err) {
    console.error(`❌ /analyze failed: ${err.message}`);
    if (err.response) {
      console.error(`   HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    }
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

// ================= CREATE PR =================

app.post("/create-pr", async (req, res) => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔀 /create-pr called`);

  try {
    if (!LAST_ANALYSIS) {
      console.log("❌ LAST_ANALYSIS is null — run /analyze first");
      return res.status(400).json({ error: "Run analysis first" });
    }

    const token = getGithubToken();
    console.log(`🔑 Token available: ${!!token} | starts: ${token?.substring(0, 8) || "NONE"}`);
    if (!token) {
      return res.status(401).json({ error: "No GitHub token. Log in with GitHub first." });
    }

    const { owner, repo, branch, results } = LAST_ANALYSIS;
    console.log(`📦 Repo: ${owner}/${repo} | Branch: ${branch}`);
    console.log(`📋 Files in LAST_ANALYSIS: ${results.length}`);
    results.forEach(r => {
      console.log(`   ${r.path}`);
      console.log(`     has_fix        : ${r.has_fix}`);
      console.log(`     fixed_code len : ${r.fixed_code?.length ?? "undefined"}`);
      console.log(`     full_orig len  : ${r.full_original?.length ?? "MISSING ⚠️"}`);
    });

    const newBranch = `ai-fix-${Date.now()}`;

    await createBranch(owner, repo, branch, newBranch);

    const committed_files = [];
    const skipped_files = [];
    const failed_files = [];

    for (const file of results) {
      console.log(`\n${"─".repeat(40)}`);
      console.log(`📝 PR loop: ${file.path}`);

      const fixedCode = file.fixed_code;

      if (!file.has_fix || !fixedCode) {
        console.log(`⏭️  Skip — has_fix: ${file.has_fix}, fixedCode empty: ${!fixedCode}`);
        skipped_files.push({ path: file.path, reason: "no fix generated by AI" });
        continue;
      }

      if (!file.full_original) {
        console.log(`⚠️  full_original is missing for ${file.path} — skipping`);
        skipped_files.push({ path: file.path, reason: "full_original not available" });
        continue;
      }

      try {
        const commitResult = await commitFile(
          owner,
          repo,
          newBranch,
          file.path,
          fixedCode,
          file.full_original
        );

        if (commitResult?.skipped) {
          console.log(`⏭️  Commit skipped: ${commitResult.reason}`);
          skipped_files.push({ path: file.path, reason: commitResult.reason });
          continue;
        }

        const commit = commitResult?.commit;
        console.log(`✅ Successfully committed: ${commit?.sha}`);
        committed_files.push({
          path: file.path,
          commit_sha: commit?.sha || null,
          commit_message: commit?.message || null
        });

      } catch (fileErr) {
        const errMsg = fileErr?.response?.data?.message || fileErr.message;
        console.error(`❌ commitFile failed for ${file.path}: ${errMsg}`);
        if (fileErr.response) {
          console.error(`   HTTP ${fileErr.response.status}: ${JSON.stringify(fileErr.response.data)}`);
        }
        failed_files.push({ path: file.path, error: errMsg });
      }
    }

    console.log(`\n📊 Summary — committed: ${committed_files.length} | skipped: ${skipped_files.length} | failed: ${failed_files.length}`);

    if (!committed_files.length) {
      console.log("❌ No commits made — not creating PR");
      return res.status(400).json({
        error: "No commits created. PR not opened.",
        details: "AI did not produce changes or GitHub rejected all updates.",
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
      commit_messages = (compare.data?.commits || [])
        .map(c => c.commit?.message)
        .filter(Boolean);
    } catch (err) {
      console.error(`⚠️  Compare fetch failed (non-fatal): ${err.message}`);
    }

    console.log(`✅ PR created: ${pr}`);
    res.json({
      message: "PR created successfully",
      pull_request: pr,
      committed_files,
      skipped_files,
      failed_files,
      commit_messages
    });

  } catch (err) {
    console.error(`❌ /create-pr failed: ${err.message}`);
    if (err.response) {
      console.error(`   HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    }
    res.status(500).json({ error: "PR creation failed", details: err.message });
  }
});

// ================= START SERVER =================

app.listen(PORT, () => {
  console.log(`🚀 AI Code Reviewer running on http://localhost:${PORT}`);
});
