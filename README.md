# gitfix 🔧

> AI-powered GitHub issue resolver — connect your repo, drop in an issue, and let gitfix fetch, scan, fix, commit, and merge automatically.

---

## What is gitfix?

**gitfix** is a CLI tool that automates the entire bug-fix lifecycle on GitHub. You authenticate with your GitHub account, paste an issue number, and gitfix takes over: it pulls the relevant files, scans every line for the problem, applies a fix, commits the change, and opens a pull request — all without you touching the code manually.

---

## How It Works

```
GitHub Login → Paste Issue → Fetch Files → Scan Lines → Apply Fix → Commit → Push → Merge
```

1. **Login** — Authenticate via GitHub OAuth
2. **Issue Input** — Provide the issue number or URL
3. **Fetch** — gitfix pulls all files linked or relevant to the issue
4. **Scan** — Every line is analyzed to identify the root cause
5. **Fix** — The problematic code is patched automatically
6. **Commit** — Changes are committed with a descriptive message referencing the issue
7. **Push & Merge** — The fix is pushed to a new branch and a PR is opened (or auto-merged if configured)

---

## Installation

```bash
npm install -g gitfix
```

Or with `npx` (no install required):

```bash
npx gitfix
```

---

## Getting Started

### 1. Login with GitHub

```bash
gitfix login
```

This opens a browser window for GitHub OAuth. Once authorized, your token is stored locally.

### 2. Run gitfix on an Issue

```bash
gitfix fix --issue 42
```

Or with a full GitHub issue URL:

```bash
gitfix fix --issue https://github.com/your-org/your-repo/issues/42
```

### 3. Review and Merge

gitfix will open a pull request automatically. Review it on GitHub, or enable auto-merge:

```bash
gitfix fix --issue 42 --auto-merge
```

---

## Configuration

Create a `.gitfixrc` file in your project root (optional):

```json
{
  "repo": "your-org/your-repo",
  "branch": "gitfix/auto-fix",
  "autoMerge": false,
  "commitPrefix": "fix",
  "scanDepth": "full"
}
```

| Option         | Default            | Description                                      |
|----------------|--------------------|--------------------------------------------------|
| `repo`         | current git remote | Target GitHub repository                        |
| `branch`       | `gitfix/issue-{n}` | Branch name for the fix                         |
| `autoMerge`    | `false`            | Automatically merge PR after fix                |
| `commitPrefix` | `fix`              | Prefix for commit messages (e.g. `fix:`, `patch:`) |
| `scanDepth`    | `full`             | `full` scans all files, `smart` limits to changed files |

---

## CLI Reference

```
gitfix <command> [options]

Commands:
  login               Authenticate with GitHub
  logout              Remove stored credentials
  fix                 Analyze an issue and apply a fix
  status              Show the current fix status
  history             List past fixes

Options for `fix`:
  --issue, -i         Issue number or URL (required)
  --repo, -r          Target repo (default: current git remote)
  --branch, -b        Branch to push the fix to
  --auto-merge        Auto-merge the PR after fix
  --dry-run           Preview changes without committing
  --verbose           Show detailed scan output
```

---

## Example

```bash
$ gitfix fix --issue 87

🔐 Authenticated as @janedoe
📋 Fetching issue #87: "NullPointerException in UserService.getById()"
📁 Scanning 4 relevant files...
   → src/services/UserService.js       ✅ Issue found on line 34
   → src/models/User.js                ✅ Clean
   → src/controllers/UserController.js ✅ Clean
   → tests/UserService.test.js         ✅ Clean

🔧 Applying fix to UserService.js (line 34)...
💬 Commit: fix: handle null user in getById() — closes #87
🚀 Pushed to branch: gitfix/issue-87
🔀 Pull request opened: https://github.com/janedoe/myapp/pull/112
```

---

## Permissions Required

When you log in, gitfix requests the following GitHub scopes:

| Scope          | Reason                                  |
|----------------|-----------------------------------------|
| `repo`         | Read files and push commits             |
| `issues:read`  | Fetch issue details                     |
| `pull_requests`| Open and merge pull requests            |

gitfix never stores your code — it only reads files temporarily during the scan.

---

## Requirements

- Node.js >= 18
- Git installed and configured
- A GitHub account

---

## Contributing

Pull requests are welcome! Please open an issue first to discuss what you'd like to change.

```bash
git clone https://github.com/your-org/gitfix.git
cd gitfix
npm install
npm run dev
git start //for backened
```

---

## License

MIT © gitfix contributors
