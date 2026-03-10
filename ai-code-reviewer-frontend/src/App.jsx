import { useEffect, useState } from "react"
import axios from "axios"
import { getAuthStatus } from "./services/githubAuth"
import GithubLogin from "./components/GithubLogin"
import GithubLogout from "./components/GithubLogout"

export default function App() {
  const [step, setStep] = useState("landing") // "landing" | "scanner"
  const [repoUrl, setRepoUrl] = useState("")
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState("idle")
  const [result, setResult] = useState(null)
  const [activeFilePath, setActiveFilePath] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [githubUser, setGithubUser] = useState(null)
  const [creatingPr, setCreatingPr] = useState(false)

  const refreshAuth = async () => {
    try {
      setAuthLoading(true)
      const data = await getAuthStatus()
      setAuthenticated(Boolean(data?.authenticated))
      setGithubUser(data?.user || null)
    } catch {
      setAuthenticated(false)
      setGithubUser(null)
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    refreshAuth()
  }, [])

  // after GitHub OAuth redirect back to frontend
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("github_login") === "success") {
      refreshAuth().finally(() => {
        // remove the query param so refresh doesn't re-trigger
        const url = new URL(window.location.href)
        url.searchParams.delete("github_login")
        window.history.replaceState({}, "", url.toString())
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addLog = (message) => {
    setLogs((prev) => [...prev, message])
  }

  const startScan = async (initialUrl) => {
    const url = initialUrl || repoUrl
    if (!url) return
    if (!authenticated) {
      addLog("🔒 Please login with GitHub first.")
      setStatus("error")
      return
    }

    setRepoUrl(url)
    setStatus("running")
    setProgress(0)
    setLogs([])
    setResult(null)
    setActiveFilePath(null)

    addLog("🔍 Fetching repository...")
    setProgress(15)

    await new Promise((r) => setTimeout(r, 800))
    addLog("📂 Scanning files...")
    setProgress(35)

    await new Promise((r) => setTimeout(r, 800))
    addLog("🤖 AI analyzing and fixing code...")
    setProgress(60)

    try {
      const res = await axios.post("http://localhost:5000/analyze", {
        repo_url: url,
      })

      setProgress(85)
      addLog("🚀 Creating Pull Request...")

      await new Promise((r) => setTimeout(r, 800))

      setProgress(100)
      addLog("✅ PR Created Successfully!")

      setResult(res.data)
      setStatus("completed")
    } catch (err) {
      addLog("❌ Error occurred")
      if (err.response?.data?.error) {
        addLog(`Server: ${err.response.data.error}`)
      }
      setStatus("error")
    }
  }

  const handleGetStarted = (e) => {
    e.preventDefault()
    if (!repoUrl) return
    if (!authenticated) return
    setStep("scanner")
    startScan(repoUrl)
  }

  const handleGithubLogin = () => {
    window.location.href = "http://localhost:5000/auth/github/login"
  }

  const handleCreatePr = async () => {
    if (!result || !result.results || !result.results.length) {
      addLog("ℹ️ Run analysis first before creating a PR.")
      return
    }
    const hasIssues = result.results.some(
      (f) => Array.isArray(f.issues_found) && f.issues_found.length > 0,
    )
    if (hasIssues) {
      addLog("⚠️ Security / quality issues still present. Resolve them before creating a PR.")
      return
    }

    try {
      setCreatingPr(true)
      addLog("🛡️ All checks passed. Creating PR...")
      const res = await axios.post("http://localhost:5000/create-pr")
      const prUrl = res.data?.pull_request
      if (prUrl) {
        setResult((prev) => (prev ? { ...prev, pull_request: prUrl } : prev))
        addLog(`✅ PR created: ${prUrl}`)
      } else {
        addLog("⚠️ PR created but no URL returned from server.")
      }
    } catch (err) {
      addLog("❌ PR creation failed")
      if (err.response?.data?.error) {
        addLog(`Server: ${err.response.data.error}`)
      }
      setStatus("error")
    } finally {
      setCreatingPr(false)
    }
  }

  if (step === "landing") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
        <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-xs font-bold">
              AI
            </div>
            <span className="font-semibold tracking-tight">IssueFixer</span>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-sm text-slate-300">
            {authLoading ? (
              <span className="text-xs text-slate-500">Checking GitHub…</span>
            ) : authenticated && githubUser ? (
              <>
                <a
                  href={githubUser.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/40 px-3 py-1.5 hover:border-slate-500 transition"
                >
                  <img
                    src={githubUser.avatar_url}
                    alt="GitHub avatar"
                    className="h-6 w-6 rounded-full"
                  />
                  <span className="text-xs">{githubUser.login}</span>
                </a>
                <GithubLogout
                  refresh={async () => {
                    await refreshAuth()
                    setRepoUrl("")
                    setStep("landing")
                    setStatus("idle")
                    setProgress(0)
                    setLogs([])
                    setResult(null)
                    setActiveFilePath(null)
                  }}
                  className="px-4 py-1.5 rounded-full border border-slate-700 text-xs hover:border-slate-500"
                />
              </>
            ) : (
              <GithubLogin className="px-4 py-1.5 rounded-full border border-slate-700 text-xs hover:border-slate-500" />
            )}
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-6 pt-10 pb-24 text-center">
          <div className="inline-flex px-3 py-1 rounded-full text-[11px] tracking-[0.18em] uppercase bg-sky-900/40 text-sky-400 border border-sky-500/40">
            Now supporting private GitHub repos
          </div>

          <h1 className="mt-6 text-4xl sm:text-5xl font-semibold leading-tight">
            Automate your <span className="text-sky-400">GitHub issue</span>{" "}
            resolution
          </h1>

          <p className="mt-4 text-slate-300 text-sm sm:text-base max-w-2xl mx-auto">
            Paste a repository URL and let the AI agent scan your codebase,
            generate fixes, and open a production‑ready pull request.
          </p>

          <form
            onSubmit={handleGetStarted}
            className="mt-8 flex flex-col sm:flex-row gap-3 justify-center"
          >
            <input
              type="text"
              placeholder="https://github.com/username/repository"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={!authenticated}
              className="w-full sm:w-[420px] px-4 py-3 rounded-full bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="submit"
              disabled={!authenticated || authLoading}
              className="px-6 py-3 rounded-full bg-sky-500 hover:bg-sky-400 text-sm font-semibold shadow-lg shadow-sky-500/30"
            >
              {authenticated ? "Start Fixing" : "Login to Continue"}
            </button>
          </form>

          {!authenticated && !authLoading && (
            <div className="mt-4 text-sm text-slate-300">
              <p className="text-slate-400">
                You must login with GitHub first to access private repos and create PRs.
              </p>
              <GithubLogin
                className="mt-3 px-6 py-3 rounded-full bg-slate-900 border border-slate-700 hover:border-slate-500 text-sm font-semibold"
              />
            </div>
          )}

          <p className="mt-3 text-xs text-slate-500">
            No credit card required. Works great with public repositories.
          </p>
        </main>
      </div>
    )
  }

  // Scanner page
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white flex">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-72 bg-slate-950/70 border-r border-slate-800/80 p-6 flex-col">
        <div className="flex items-center gap-2 mb-10">
          <span className="text-3xl">🚀</span>
          <span className="text-2xl font-bold">AI Fixer</span>
        </div>

        <nav className="space-y-3 text-slate-400 text-sm">
          <div className="text-sky-400 font-semibold flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            Job Dashboard
          </div>
          <button
            onClick={() => setStep("landing")}
            className="hover:text-sky-400 transition flex items-center gap-2"
          >
            ⬅ New Repository
          </button>
        </nav>

        <div className="mt-auto text-xs text-slate-500">
          Built for your resume – showcase automated GitHub fixing with live PRs.
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 lg:p-10 flex justify-center">
        <div className="w-full max-w-6xl space-y-6">
          <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold">
                Job Progress
              </h2>
              <p className="text-slate-400 text-xs md:text-sm">
                Live status for repository:{" "}
                <span className="text-sky-300">
                  {repoUrl || "Waiting for URL…"}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs md:text-sm">
              {authenticated && githubUser && (
                <>
                  <a
                    href={githubUser.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/40 px-3 py-1.5 hover:border-slate-500 transition"
                  >
                    <img
                      src={githubUser.avatar_url}
                      alt="GitHub avatar"
                      className="h-6 w-6 rounded-full"
                    />
                    <span className="text-xs">{githubUser.login}</span>
                  </a>
                  <GithubLogout
                    refresh={async () => {
                      await refreshAuth()
                      setRepoUrl("")
                      setStep("landing")
                      setStatus("idle")
                      setProgress(0)
                      setLogs([])
                      setResult(null)
                      setActiveFilePath(null)
                    }}
                    className="hidden sm:inline-flex px-4 py-1.5 rounded-full border border-slate-700 text-xs hover:border-slate-500"
                  />
                </>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 border ${
                  status === "completed"
                    ? "border-emerald-500/60 text-emerald-300"
                    : status === "error"
                      ? "border-rose-500/60 text-rose-300"
                      : "border-sky-500/60 text-sky-300"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    status === "completed"
                      ? "bg-emerald-400"
                      : status === "error"
                        ? "bg-rose-400"
                        : "bg-sky-400"
                  }`}
                />
                {status === "completed"
                  ? "Completed"
                  : status === "error"
                    ? "Error"
                    : "Running"}
              </span>
            </div>
          </header>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)] gap-6">
            {/* Left: progress + logs */}
            <section className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 md:p-6 shadow-lg shadow-black/40">
              {/* Progress bar */}
              {status !== "idle" && (
                <div className="mb-5">
                  <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-sky-400 to-emerald-400 h-3 transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    {progress}% completed
                  </div>
                </div>
              )}

              {/* Logs */}
              <div className="mt-3 bg-black/80 p-4 rounded-xl h-56 md:h-64 overflow-y-auto text-xs md:text-sm space-y-1.5 border border-slate-800">
                {logs.length === 0 ? (
                  <div className="text-slate-500">
                    Waiting to start… use the field below to run or restart a
                    scan.
                  </div>
                ) : (
                  logs.map((log, index) => <div key={index}>{log}</div>)
                )}
              </div>

              {/* Controls */}
              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="https://github.com/username/repository"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <button
                  onClick={() => startScan()}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-sm font-semibold"
                >
                  Restart Scan
                </button>
              </div>
            </section>

            {/* Right: summary + files + live code */}
            <section className="space-y-4">
              {/* Run summary */}
              {result && (
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 space-y-2">
                  <h3 className="text-lg font-semibold">
                    Run Summary
                  </h3>
                  <p className="text-sm text-slate-300">
                    Repository:{" "}
                    <span className="text-sky-300">{result.repository}</span>
                  </p>
                  <p className="text-sm text-slate-300">
                    Files analyzed: {result.files_analyzed}
                  </p>
                  <p className="text-xs text-slate-400">
                    Security / quality issues must be resolved before creating a PR.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 items-center">
                    <button
                      onClick={handleCreatePr}
                      disabled={
                        creatingPr ||
                        status !== "completed" ||
                        !result.results ||
                        !result.results.length
                      }
                      className={`px-4 py-2 rounded-full text-xs font-semibold ${
                        creatingPr ||
                        status !== "completed" ||
                        !result.results ||
                        !result.results.length
                          ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                          : "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
                      }`}
                    >
                      {creatingPr ? "Creating PR…" : "Create PR"}
                    </button>
                    {result.pull_request && (
                      <a
                        href={result.pull_request}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 text-xs underline-offset-2 hover:underline"
                      >
                        View Pull Request →
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Files & code viewer */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 md:p-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)] gap-4">
                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    Files Modified
                  </h4>
                  <div className="space-y-1 max-h-52 overflow-y-auto text-xs md:text-sm">
                    {!result || !result.results?.length ? (
                      <div className="text-slate-500">
                        No files yet – run a scan to see AI‑generated fixes.
                      </div>
                    ) : (
                      result.results.map((file) => {
                        const isActive = activeFilePath === file.path
                        const issuesCount = Array.isArray(file.issues_found)
                          ? file.issues_found.length
                          : 0
                        return (
                          <button
                            key={file.path}
                            onClick={() => setActiveFilePath(file.path)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left ${
                              isActive
                                ? "border-sky-500 bg-sky-950/40"
                                : "border-slate-800 bg-slate-900/70 hover:border-slate-600"
                            }`}
                          >
                            <span className="truncate mr-3 text-xs md:text-sm">
                              {file.path}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full ${
                                issuesCount
                                  ? "bg-amber-500/20 text-amber-300"
                                  : "bg-emerald-500/20 text-emerald-300"
                              }`}
                            >
                              {issuesCount ? `${issuesCount} issues` : "Clean"}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="flex flex-col">
                  <h4 className="text-sm font-semibold mb-1">
                    Live Fix Preview
                  </h4>
                  <p className="text-xs text-slate-400 mb-2">
                    Updated file content as generated by the AI agent.
                  </p>
                  <pre className="flex-1 bg-black/80 border border-slate-800 rounded-xl p-3 text-[11px] md:text-xs font-mono overflow-auto">
                    {(() => {
                      if (!result || !result.results?.length) {
                        return "// Fixed code will appear here after a successful run."
                      }
                      const active =
                        result.results.find(
                          (f) => f.path === activeFilePath
                        ) || result.results[0]
                      return active.fixed_code || "// No fixed_code returned."
                    })()}
                  </pre>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}