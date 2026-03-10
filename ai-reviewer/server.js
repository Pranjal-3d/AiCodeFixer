require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const OpenAI = require("openai");

console.log("✅ Loaded ai-reviewer/server.js (API routes: GET /, POST /analyze)");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5000;

// ================= CONFIG =================

const ALLOWED_EXTENSIONS = [".js", ".ts", ".tsx", ".py", ".jsx"];
const MAX_ANALYZE_FILES = 5;
const MAX_CONTENT_LENGTH = 1500;

let USER_GITHUB_TOKEN = null;
let LAST_ANALYSIS = null; // NEW: store analysis for PR later

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

async function getDefaultBranch(owner, repo) {

  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );

  return response.data.default_branch;
}

async function getRepoTree(owner, repo, branch) {

  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );

  return response.data.tree;
}

function isValidCodeFile(path) {

  if (path.startsWith(".")) return false;
  if (path.includes("/.")) return false;
  if (path.includes("node_modules")) return false;

  return ALLOWED_EXTENSIONS.some(ext =>
    path.toLowerCase().endsWith(ext)
  );
}

async function fetchFileContent(owner, repo, branch, filePath) {

  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );

  const decoded = Buffer.from(
    response.data.content,
    "base64"
  ).toString("utf-8");

  return decoded.substring(0, MAX_CONTENT_LENGTH);
}

// ================= AI ANALYSIS =================

async function analyzeWithAI(filePath, content) {

  const response = await openai.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a senior engineer. Return only JSON."
      },
      {
        role: "user",
        content: `
Fix the following code.

Return JSON:

{
"summary": "",
"issues_found": [],
"fixed_code": ""
}

File: ${filePath}

Code:
${content}
`
      }
    ],
    temperature: 0.2
  });

  return response.choices[0].message.content;
}

function safeParse(raw) {

  try {

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");

    if (first === -1 || last === -1) {
      return JSON.parse(raw);
    }

    return JSON.parse(raw.slice(first, last + 1));

  } catch {

    return null;

  }
}

// ================= GITHUB AUTOMATION =================

async function getLatestCommitSha(owner, repo, branch) {

  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );

  return response.data.object.sha;
}

async function createBranch(owner, repo, baseBranch, newBranch) {

  const sha = await getLatestCommitSha(owner, repo, baseBranch);

  await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      ref: `refs/heads/${newBranch}`,
      sha
    },
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );
}

async function commitFile(owner, repo, branch, path, content) {

  const fileData = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );

  const sha = fileData.data.sha;

  await axios.put(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    {
      message: `AI Fix: Updated ${path}`,
      content: Buffer.from(content).toString("base64"),
      branch,
      sha
    },
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );
}

async function createPullRequest(owner, repo, baseBranch, newBranch) {

  const response = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      title: "AI Auto Fix",
      head: newBranch,
      base: baseBranch,
      body: "Automated fixes generated by AI"
    },
    {
      headers: {
        Authorization: `token ${getGithubToken({ includeEnv: true })}`
      }
    }
  );

  return response.data.html_url;
}

// ================= GITHUB LOGIN =================

app.get("/auth/github/login", (req, res) => {

  const url =
    "https://github.com/login/oauth/authorize" +
    "?client_id=" +
    process.env.GITHUB_CLIENT_ID +
    "&scope=repo";

  res.redirect(url);

});

app.get("/auth/github/callback", async (req, res) => {

  const code = req.query.code;

  const response = await axios.post(
    "https://github.com/login/oauth/access_token",
    {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code
    },
    {
      headers: { Accept: "application/json" }
    }
  );

  USER_GITHUB_TOKEN = response.data.access_token;

  res.redirect("http://localhost:5173");

});

// ================= ROUTES =================

app.get("/", (req, res) => {
  res.send("AI Code Reviewer API running");
});

// ================= ANALYZE =================

app.post("/analyze", async (req, res) => {

  const { repo_url } = req.body;

  if (!repo_url) {
    return res.status(400).json({ error: "repo_url required" });
  }

  try {

    const { owner, repo } = extractRepoDetails(repo_url);

    const branch = await getDefaultBranch(owner, repo);

    const tree = await getRepoTree(owner, repo, branch);

    const validFiles = tree.filter(
      f => f.type === "blob" && isValidCodeFile(f.path)
    );

    const selected = validFiles.slice(0, MAX_ANALYZE_FILES);

    const results = [];

    for (const file of selected) {

      const content = await fetchFileContent(
        owner,
        repo,
        branch,
        file.path
      );

      const ai = await analyzeWithAI(file.path, content);

      const parsed = safeParse(ai);

      if (!parsed) continue;

      results.push({
        path: file.path,
        summary: parsed.summary,
        issues_found: parsed.issues_found,
        fixed_code: parsed.fixed_code
      });

    }

    // store analysis
    LAST_ANALYSIS = {
      owner,
      repo,
      branch,
      results
    };

    res.json({
      repository: `${owner}/${repo}`,
      files_analyzed: results.length,
      results
    });

  } catch (err) {

    res.status(500).json({
      error: "Analysis failed",
      details: err.message
    });

  }

});

// ================= CREATE PR =================

app.post("/create-pr", async (req, res) => {

  try {

    if (!LAST_ANALYSIS) {
      return res.status(400).json({
        error: "Run analysis first"
      });
    }

    const { owner, repo, branch, results } = LAST_ANALYSIS;

    const newBranch = `ai-fix-${Date.now()}`;

    await createBranch(owner, repo, branch, newBranch);

    for (const file of results) {

      if (file.fixed_code) {

        await commitFile(
          owner,
          repo,
          newBranch,
          file.path,
          file.fixed_code
        );

      }

    }

    const pr = await createPullRequest(owner, repo, branch, newBranch);

    res.json({
      message: "PR created successfully",
      pull_request: pr
    });

  } catch (err) {

    res.status(500).json({
      error: "PR creation failed",
      details: err.message
    });

  }

});

// ================= START SERVER =================

app.listen(PORT, () => {
  console.log(`🚀 AI Code Reviewer running on http://localhost:${PORT}`);
});