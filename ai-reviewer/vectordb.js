const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "history.json");

function loadHistory() {
  try {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch (error) {
    console.error("Error loading history:", error);
    return [];
  }
}

function saveHistory(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function initCollection() {
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, "[]", "utf-8");
  }
  console.log("✅ Local JSON history store ready");
}

async function saveAnalysis({ owner, repo, branch, results }) {
  const history = loadHistory();
  const entries = results.map(r => ({
    owner, repo, branch,
    path: r.path,
    summary: r.summary,
    issues_found: r.issues_found,
    has_fix: r.has_fix,
    analyzed_at: new Date().toISOString()
  }));
  history.unshift(...entries);
  saveHistory(history.slice(0, 500));
  console.log(`✅ Saved ${entries.length} records to history.json`);
}

async function searchHistory(query, limit = 10) {
  const history = loadHistory();
  const q = query.toLowerCase();
  return history
    .filter(r =>
      (r.summary || "").toLowerCase().includes(q) ||
      (r.path || "").toLowerCase().includes(q) ||
      (Array.isArray(r.issues_found) ? r.issues_found : [])
        .some(i => String(i).toLowerCase().includes(q)) ||
      `${r.owner}/${r.repo}`.toLowerCase().includes(q)
    )
    .slice(0, limit);
}

// Case-insensitive exact match on owner/repo
async function getRepoHistory(owner, repo, limit = 20) {
  const history = loadHistory();
  const o = owner.toLowerCase();
  const r = repo.toLowerCase();
  return history
    .filter(entry =>
      entry.owner.toLowerCase() === o &&
      entry.repo.toLowerCase() === r
    )
    .slice(0, limit);
}

// Returns unique owner/repo pairs that exist in history
// Used by the frontend to populate the repo filter dropdown
async function getAvailableRepos() {
  const history = loadHistory();
  console.log(`[getAvailableRepos] total history entries: ${history.length}`);
  const seen = new Set();
  const repos = [];
  for (const entry of history) {
    const key = `${entry.owner}/${entry.repo}`;
    if (!seen.has(key)) {
      seen.add(key);
      repos.push({
        owner: entry.owner,
        repo: entry.repo,
        full_name: key,
        latest_at: entry.analyzed_at
      });
    }
  }
  return repos;
}

module.exports = { initCollection, saveAnalysis, searchHistory, getRepoHistory, getAvailableRepos };