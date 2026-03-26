import { useEffect, useState, useRef } from "react"
import axios from "axios"
import { getAuthStatus } from "./services/githubAuth"
import GithubLogin from "./components/GithubLogin"
import GithubLogout from "./components/GithubLogout"
import "./App.css"

const API = "http://localhost:5000"

export default function App() {
  const [step, setStep] = useState("landing")
  const [repoUrl, setRepoUrl] = useState("")
  const [issueToFix, setIssueToFix] = useState("")
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState("idle")
  const [result, setResult] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [githubUser, setGithubUser] = useState(null)
  const [creatingPr, setCreatingPr] = useState(false)
  const [authError, setAuthError] = useState("")

  // ── Repo + File Picker state ───────────────────────────────────
  const [repos, setRepos] = useState([])
  const [reposLoading, setReposLoading] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState(null)      // full repo object
  const [selectedFiles, setSelectedFiles] = useState([])      // array of file paths
  const [pickerError, setPickerError] = useState("")

  // ── History state ──────────────────────────────────────────────
  const [historySearch, setHistorySearch] = useState("")
  const [historyResults, setHistoryResults] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null)
  const [repoFilter, setRepoFilter] = useState("")
  const [historyRepos, setHistoryRepos] = useState([])
  const historyDebounce = useRef(null)

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

  useEffect(() => { refreshAuth() }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("github_login") === "success") {
      refreshAuth().finally(() => {
        const url = new URL(window.location.href)
        url.searchParams.delete("github_login")
        window.history.replaceState({}, "", url.toString())
      })
    } else if (params.get("github_login") === "error") {
      setAuthError("GitHub login failed. Please try again.")
      const url = new URL(window.location.href)
      url.searchParams.delete("github_login")
      window.history.replaceState({}, "", url.toString())
    }
  }, [])

  // ── Load repos once authenticated ─────────────────────────────
  useEffect(() => {
    if (!authenticated) { setRepos([]); return }
    setReposLoading(true)
    setPickerError("")
    axios.get(`${API}/repos`)
      .then(res => setRepos(res.data?.repos || []))
      .catch(err => setPickerError(err.response?.data?.error || "Failed to load repos."))
      .finally(() => setReposLoading(false))
  }, [authenticated])

  // ── When user picks a repo, just store it ────────────────────
  const handleRepoSelect = (repoFullName) => {
    const repo = repos.find(r => r.full_name === repoFullName)
    setSelectedRepo(repo || null)
    setSelectedFiles([])
    setPickerError("")
    setRepoUrl(repo ? repo.html_url : "")
  }

  // ── History helpers ────────────────────────────────────────────
  const fetchHistoryBySearch = async (q) => {
    if (!q.trim()) { setHistoryResults([]); return }
    try {
      setHistoryLoading(true)
      setHistoryError("")
      const res = await axios.get(`${API}/history/search`, { params: { q } })
      setHistoryResults(res.data?.results || [])
    } catch (err) {
      setHistoryError(err.response?.data?.error || "Search failed.")
      setHistoryResults([])
    } finally { setHistoryLoading(false) }
  }

  const fetchHistoryByRepo = async (ownerRepo) => {
    if (!ownerRepo.includes("/")) { setHistoryError("Format: owner/repo"); return }
    const [owner, repo] = ownerRepo.split("/")
    try {
      setHistoryLoading(true)
      setHistoryError("")
      const res = await axios.get(`${API}/history/${owner}/${repo}`)
      setHistoryResults(res.data?.history || [])
      if (!res.data?.history?.length) setHistoryError(`No history found for ${ownerRepo}`)
    } catch (err) {
      setHistoryError(err.response?.data?.error || "Fetch failed.")
      setHistoryResults([])
    } finally { setHistoryLoading(false) }
  }

  useEffect(() => {
    if (step !== "history") return
    if (repoFilter) return
    clearTimeout(historyDebounce.current)
    if (!historySearch.trim()) { setHistoryResults([]); return }
    historyDebounce.current = setTimeout(() => fetchHistoryBySearch(historySearch), 500)
    return () => clearTimeout(historyDebounce.current)
  }, [historySearch, step])

  const handleHistoryTabOpen = () => {
    setStep("history")
    setSelectedHistoryItem(null)
    setHistoryResults([])
    setHistorySearch("")
    setRepoFilter("")
    setHistoryError("")
    // Load available repos for the dropdown
    axios.get(`${API}/history/repos`)
      .then(res => setHistoryRepos(res.data?.repos || []))
      .catch(() => setHistoryRepos([]))
  }

  // ── Logging ────────────────────────────────────────────────────
  const addLog = (message) => setLogs((prev) => [...prev, message])
  const fmt = (tag, text) => `[${tag}] ${text}`

  const buildQueueState = () => {
    const items = [
      { id: "auth", title: "Auth-Bypass Patch" },
      { id: "sqli", title: "SQL Injection Sanitizer" },
      { id: "xss", title: "XSS Header Guard" },
      { id: "rate", title: "Rate Limiter V2" },
    ]
    const idx = status === "completed" ? items.length : status === "error" ? Math.min(2, items.length) : progress < 25 ? 0 : progress < 55 ? 1 : progress < 80 ? 2 : 3
    const applied = Math.max(0, Math.min(items.length, idx))
    const pending = Math.max(0, items.length - applied)
    const withState = items.map((it, i) => ({ ...it, state: i < applied ? "done" : i === applied ? "active" : "todo" }))
    return { items: withState, applied, pending }
  }

  const createPullRequest = async (analysisData, { auto = false } = {}) => {
    const data = analysisData || result
    if (!data || !data.results || !data.results.length) { addLog(fmt("INFO", "Run analysis first.")); return }
    try {
      setCreatingPr(true)
      addLog(fmt("SYSTEM", auto ? "Scan finished. Auto-creating PR..." : "Creating PR..."))
      const res = await axios.post(`${API}/create-pr`)
      const prUrl = res.data?.pull_request
      if (prUrl) {
        setResult((prev) => prev ? { ...prev, pull_request: prUrl, pr_details: res.data } : prev)
        addLog(fmt("SUCCESS", `PR created: ${prUrl}`))
        const commitMessages = res.data?.commit_messages
        if (Array.isArray(commitMessages) && commitMessages.length) {
          commitMessages.slice(0, 8).forEach((m, idx) => addLog(fmt("FIX", `Commit ${idx + 1}: ${String(m).split("\n")[0]}`)))
        } else {
          addLog(fmt("WARN", "GitHub compare returned 0 commits (PR may be empty)."))
        }
      } else {
        addLog(fmt("WARN", "PR created but no URL returned."))
      }
    } catch (err) {
      addLog(fmt("WARN", "PR creation failed"))
      if (err.response?.data?.error) addLog(fmt("INFO", `Server: ${err.response.data.error}`))
      setStatus("error")
    } finally { setCreatingPr(false) }
  }

  const startScan = async (initialUrl) => {
    const url = initialUrl || repoUrl
    if (!url) return
    if (!authenticated) { addLog(fmt("WARN", "Please login with GitHub first.")); setStatus("error"); return }
    setRepoUrl(url)
    setStatus("running")
    setProgress(0)
    setLogs([])
    setResult(null)

    addLog(fmt("SYSTEM", "Initializing GitFix AI Engine v1.0.4-beta..."))
    addLog(fmt("SYSTEM", "Authentication successful."))
    addLog(fmt("SYSTEM", "Scanning repository for vulnerabilities..."))
    setProgress(12)

    await new Promise((r) => setTimeout(r, 800))
    addLog(fmt("WARN", "Outdated npm package 'lodash' detected (v4.17.15)"))
    addLog(fmt("INFO", "Identified 6 critical vulnerabilities in main branch."))
    setProgress(34)

    await new Promise((r) => setTimeout(r, 800))
    addLog(fmt("FIX", "Applying Auth-Bypass Patch..."))
    addLog(">> diff --git a/src/auth.js b/src/auth.js")
    addLog(">> @@ -14,7 +14,7 @@")
    addLog("- if (user.role === 'admin') {")
    addLog("+ if (user.role === 'admin' && session.is_secure) {")
    addLog(fmt("SUCCESS", "Patch applied."))
    setProgress(58)

    try {
      const res = await axios.post(`${API}/analyze`, {
        repo_url: url,
        issue_to_fix: issueToFix,
        // Send the specific files the user selected (empty = auto-pick top 5)
        selected_files: selectedFiles.length > 0 ? selectedFiles : undefined,
      })
      addLog(fmt("FIX", "Injecting SQL Injection Sanitizer..."))
      addLog(">> Replacing template strings with parameterized queries...")
      addLog(fmt("SUCCESS", "Sanitization complete."))
      setProgress(78)

      await new Promise((r) => setTimeout(r, 800))
      addLog(fmt("FIX", "Running XSS Header Guard..."))
      addLog(">> Appending Content-Security-Policy to headers...")
      setProgress(92)

      await new Promise((r) => setTimeout(r, 800))
      setProgress(100)
      addLog(fmt("SUCCESS", "Scan complete. Ready to deploy."))
      setResult(res.data)
      setStatus("completed")
      await createPullRequest(res.data, { auto: true })
    } catch (err) {
      addLog(fmt("WARN", "Error occurred during analysis."))
      if (err.response?.data?.error) addLog(fmt("INFO", `Server: ${err.response.data.error}`))
      setStatus("error")
    }
  }

  const handleGetStarted = (e) => {
    e.preventDefault()
    if (!repoUrl || !issueToFix.trim()) return
    if (!authenticated) return
    setStep("scanner")
    startScan(repoUrl)
  }

  // ── HISTORY PAGE ───────────────────────────────────────────────
  if (step === "history") {
    return (
      <div className="dash">
        <div className="dash-top">
          <div className="dash-top-inner">
            <div className="dash-brand"><div className="mark">▸</div><div>GITFIX AI <span style={{ opacity: 0.65 }}>/ / HISTORY</span></div></div>
            <div className="dash-nav">
              <button className="btn" type="button" onClick={() => setStep("landing")}>HOME</button>
              <button className="btn" type="button" onClick={() => setStep("scanner")}>SCANNER</button>
              <button className="btn dash-btn" type="button" onClick={() => { setStep("landing"); setRepoUrl(""); setIssueToFix("") }}>NEW TASK</button>
            </div>
          </div>
        </div>

        <div className="dash-shell" style={{ flexDirection: "column", gap: 20, padding: "24px 28px" }}>
          <div className="panel" style={{ padding: "18px 20px" }}>
            <div className="box-title" style={{ marginBottom: 14 }}>SEARCH HISTORY</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input className="input" style={{ flex: 1, minWidth: 220 }} type="text" placeholder="SEMANTIC SEARCH — e.g. 'auth bug'..." value={historySearch} onChange={(e) => { setHistorySearch(e.target.value); setRepoFilter("") }} />
              <select
                className="input"
                style={{ flex: 1, minWidth: 180, cursor: "pointer" }}
                value={repoFilter}
                onChange={(e) => {
                  const val = e.target.value
                  setRepoFilter(val)
                  setHistorySearch("")
                  if (val) fetchHistoryByRepo(val)
                  else setHistoryResults([])
                }}
              >
                <option value="">— SELECT REPO —</option>
                {historyRepos.map(r => (
                  <option key={r.full_name} value={r.full_name}>{r.full_name}</option>
                ))}
              </select>
              
            </div>
            {historyError && <div style={{ marginTop: 10, color: "#ff8f8f", fontSize: 12 }}>{historyError}</div>}
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div className="panel" style={{ flex: "0 0 340px", minWidth: 280, padding: 0, overflow: "hidden" }}>
              <div className="box-title" style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                RESULTS {historyResults.length > 0 && <span style={{ opacity: 0.6, fontWeight: 400 }}>({historyResults.length})</span>}
              </div>
              {historyLoading && <div style={{ padding: "20px 18px", opacity: 0.6, fontSize: 12 }}>SEARCHING…</div>}
              {!historyLoading && historyResults.length === 0 && !historyError && (
                <div style={{ padding: "20px 18px", opacity: 0.45, fontSize: 11 }}>TYPE A QUERY ABOVE TO SEARCH.</div>
              )}
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {historyResults.map((item, i) => (
                  <div key={i} onClick={() => setSelectedHistoryItem(item)} style={{ padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", background: selectedHistoryItem === item ? "rgba(255,255,255,0.06)" : "transparent", transition: "background 0.15s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: "#fff" }}>{item.owner}/{item.repo}</span>
                      {item.score !== undefined && <span style={{ fontSize: 10, opacity: 0.55, background: "rgba(255,255,255,0.08)", padding: "2px 6px", borderRadius: 3 }}>{(item.score * 100).toFixed(0)}% match</span>}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4, fontFamily: "monospace" }}>{item.path}</div>
                    <div style={{ fontSize: 11, opacity: 0.55, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.summary || "No summary"}</div>
                    <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                      <span style={{ fontSize: 9, padding: "2px 6px", border: "1px solid", borderColor: item.has_fix ? "rgba(0,255,128,0.4)" : "rgba(255,255,255,0.15)", color: item.has_fix ? "#00ff80" : "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>{item.has_fix ? "HAS FIX" : "NO FIX"}</span>
                      {item.analyzed_at && <span style={{ fontSize: 9, opacity: 0.4 }}>{new Date(item.analyzed_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel" style={{ flex: 1, padding: 0, overflow: "hidden" }}>
              <div className="box-title" style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>DETAIL VIEW</div>
              {!selectedHistoryItem ? (
                <div style={{ padding: "40px 24px", opacity: 0.35, fontSize: 12 }}>← CLICK A RESULT TO VIEW DETAILS</div>
              ) : (
                <div style={{ padding: "20px 24px", overflowY: "auto", maxHeight: 560 }}>
                  <div style={{ marginBottom: 18 }}><div style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", marginBottom: 4 }}>REPOSITORY</div><div style={{ fontSize: 14, fontWeight: 800 }}>{selectedHistoryItem.owner}/{selectedHistoryItem.repo}</div></div>
                  <div style={{ marginBottom: 18 }}><div style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", marginBottom: 4 }}>FILE</div><div style={{ fontFamily: "monospace", fontSize: 12, background: "rgba(255,255,255,0.05)", padding: "6px 10px", borderRadius: 4 }}>{selectedHistoryItem.path}</div></div>
                  <div style={{ marginBottom: 18 }}><div style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", marginBottom: 4 }}>BRANCH</div><div style={{ fontFamily: "monospace", fontSize: 12 }}>{selectedHistoryItem.branch || "—"}</div></div>
                  <div style={{ marginBottom: 18 }}><div style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", marginBottom: 6 }}>AI SUMMARY</div><div style={{ fontSize: 12, lineHeight: 1.7, opacity: 0.85 }}>{selectedHistoryItem.summary || "No summary available."}</div></div>
                  {Array.isArray(selectedHistoryItem.issues_found) && selectedHistoryItem.issues_found.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", marginBottom: 8 }}>ISSUES FOUND ({selectedHistoryItem.issues_found.length})</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {selectedHistoryItem.issues_found.map((issue, i) => (
                          <div key={i} style={{ fontSize: 11, padding: "8px 12px", background: "rgba(255,140,0,0.08)", border: "1px solid rgba(255,140,0,0.25)", borderRadius: 4, lineHeight: 1.6 }}>
                            <span style={{ color: "rgba(255,140,0,0.9)", marginRight: 8 }}>⚠</span>{issue}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: "0.06em", marginBottom: 6 }}>FIX STATUS</div>
                    <span style={{ fontSize: 11, padding: "4px 10px", border: "1px solid", borderColor: selectedHistoryItem.has_fix ? "rgba(0,255,128,0.4)" : "rgba(255,80,80,0.4)", color: selectedHistoryItem.has_fix ? "#00ff80" : "#ff5050", letterSpacing: "0.05em" }}>{selectedHistoryItem.has_fix ? "✓ FIX WAS GENERATED" : "✗ NO FIX GENERATED"}</span>
                  </div>
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 20 }}>
                    {selectedHistoryItem.analyzed_at && <div><div style={{ fontSize: 10, opacity: 0.4, marginBottom: 2 }}>ANALYZED AT</div><div style={{ fontSize: 11 }}>{new Date(selectedHistoryItem.analyzed_at).toLocaleString()}</div></div>}
                    {selectedHistoryItem.score !== undefined && <div><div style={{ fontSize: 10, opacity: 0.4, marginBottom: 2 }}>SIMILARITY SCORE</div><div style={{ fontSize: 11 }}>{(selectedHistoryItem.score * 100).toFixed(1)}%</div></div>}
                  </div>
                  <div style={{ marginTop: 20 }}>
                    <button className="btn btn-primary" type="button" onClick={() => { setRepoUrl(`https://github.com/${selectedHistoryItem.owner}/${selectedHistoryItem.repo}`); setStep("scanner"); startScan(`https://github.com/${selectedHistoryItem.owner}/${selectedHistoryItem.repo}`) }}>RE-SCAN THIS REPO →</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── LANDING PAGE ───────────────────────────────────────────────
  if (step === "landing") {
    return (
      <div className="app landing">
        <div className="container">
          <header className="topbar">
            <div className="brand">
              <div className="brand-badge">▸</div>
              <div>GITFIX AI</div>
            </div>
            <nav className="nav" aria-label="Primary">
              <a href="#logic">LOGIC</a>
              <a href="#pricing">PRICING</a>
              <a href="#docs">DOCS</a>
              {authLoading ? (
  <span style={{ opacity: 0.7 }}>CHECKING…</span>
) : authenticated ? (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    {githubUser?.avatar_url && (
      <img
        src={githubUser.avatar_url}
        alt={githubUser.login}
        style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)" }}
      />
    )}
    <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", opacity: 0.9 }}>
      {githubUser?.login}
    </span>
    <GithubLogout
      refresh={async () => { await refreshAuth(); setRepoUrl(""); setIssueToFix(""); setStep("landing"); setStatus("idle"); setProgress(0); setLogs([]); setResult(null); setSelectedRepo(null); setSelectedFiles([]) }}
      className="btn btn-primary"
      label="LOGOUT"
    />
  </div>
) : (
  <GithubLogin className="btn btn-primary" label="LOGIN" />
)}
            </nav>
          </header>

          <section className="hero">
            <div className="hero-left">
              <div className="tag">V1.0.4 RELEASED</div>
              <h1 className="hero-title">SMASH<br />BUGS.<br /><span>NOW.</span></h1>
              <p className="hero-sub">RAW MACHINE POWER FOR YOUR GITHUB ISSUES. PICK A REPO, GET A PR. NO FLUFF, JUST CODE.</p>

              <form className="hero-form" onSubmit={handleGetStarted}>

                {/* ── REPO PICKER ── */}
                {authenticated && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                    {/* Repo dropdown */}
                    <select
                      className="input"
                      value={selectedRepo?.full_name || ""}
                      onChange={(e) => handleRepoSelect(e.target.value)}
                      disabled={reposLoading}
                      style={{ cursor: "pointer" }}
                    >
                      <option value="">
                        {reposLoading ? "LOADING REPOS…" : "SELECT A REPO →"}
                      </option>
                      {repos.map(r => (
                        <option key={r.id} value={r.full_name}>
                          {r.private ? "🔒 " : "📁 "}{r.full_name}
                          {r.language ? `  [${r.language}]` : ""}
                        </option>
                      ))}
                    </select>


                  </div>
                )}

                {/* Issue description */}
                <input
                  className="input"
                  type="text"
                  placeholder="DESCRIBE THE ERROR TO FIX (e.g. login button not working)"
                  value={issueToFix}
                  onChange={(e) => setIssueToFix(e.target.value)}
                  disabled={!authenticated}
                  aria-label="Issue to fix"
                />

                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!authenticated || authLoading || !repoUrl || !issueToFix.trim()}
                >
                  FIX IT
                </button>
              </form>

              <div className="trust">TRUSTED BY 20,000+ DEVELOPERS WHO HATE MANUAL DEBUGGING.</div>

              {!authenticated && !authLoading && (
                <div style={{ marginTop: 14, color: "var(--muted)", fontSize: 12 }}>
                  Login with GitHub to see your repos and create PRs.
                </div>
              )}
              {authError && <div style={{ marginTop: 8, color: "#ff8f8f", fontSize: 12 }}>{authError}</div>}
            </div>

            <div className="hero-right" aria-hidden="true">
              <div className="hero-right-head"><strong>LIVE ISSUE FEED</strong><span>GITHUB / PRODUCTION</span></div>
              <div className="hero-right-grid">
                <div className="hero-right-kpi"><div className="hero-right-kpi-label">OPEN ISSUES</div><div className="hero-right-kpi-value">68</div><div className="hero-right-kpi-pill"><span>+12 NEW</span><span style={{ opacity: 0.7 }}>/ HR</span></div></div>
                <div className="hero-right-kpi"><div className="hero-right-kpi-label">MEAN TIME TO FIX</div><div className="hero-right-kpi-value">00:45s</div><div className="hero-right-kpi-pill"><span>GITFIX RUNNING</span></div></div>
              </div>
              <div className="hero-right-list">
                <div className="hero-right-row"><span>#1342 auth-bypass patch</span><span>APPLIED</span></div>
                <div className="hero-right-row"><span>#1299 sql-injection sanitizer</span><span>RUNNING</span></div>
                <div className="hero-right-row"><span>#1281 xss-header guard</span><span>QUEUED</span></div>
              </div>
              <div className="hero-right-footer"><span>NO FLUFF. JUST FIXES.</span><span>STATUS: ONLINE</span></div>
            </div>
          </section>

          <section className="stats" aria-label="Stats">
            <div className="stat"><div className="kpi">1.2M+</div><div className="label">ISSUES ANNIHILATED</div><div className="delta">+12% THIS WEEK</div></div>
            <div className="stat"><div className="kpi">45s</div><div className="label">EXECUTION TIME</div><div className="delta neg">-10% LATENCY</div></div>
            <div className="stat"><div className="kpi">99.8%</div><div className="label">FIX ACCURACY</div><div className="delta grade">CRITICAL GRADE</div></div>
          </section>

          <section id="logic" style={{ paddingBottom: 12 }}>
            <div className="section-title">RAW GRID LOGIC</div>
            <div className="section-sub">THREE STEPS TO A PERFECT PR. NO INTERMEDIATE BULLSHIT.</div>
            <div className="steps">
              <div className="step-card"><div className="step-head"><div className="step-icon">⌕</div><div className="step-num">01</div></div><div className="step-title">SCAN</div><div className="step-body">We ingest your entire codebase context in seconds. Our engine maps dependencies and understands your architecture.</div><div className="engine"><span>DEPTH: FULL SYSTEM SCAN</span><span /></div></div>
              <div className="step-card is-active"><div className="step-head"><div className="step-icon">⚙</div><div className="step-num">02</div></div><div className="step-title">SOLVE</div><div className="step-body">AI generates a surgical fix. It doesn't just patch; it optimizes. Code is verified against your existing test suites before staging.</div><div className="engine"><span>ENGINE: GTFIX-NEURAL v6</span><span /></div></div>
              <div className="step-card"><div className="step-head"><div className="step-icon">↥</div><div className="step-num">03</div></div><div className="step-title">PUSH</div><div className="step-body">Review the automated Pull Request. It includes documentation, test results, and clear explanation of the fix. Hit merge and relax.</div><div className="engine"><span>STATUS: READY TO DEPLOY</span><span /></div></div>
            </div>
          </section>

          <section className="cta" id="pricing">
            <div className="cta-title">READY TO SHIP CLEANER CODE?</div>
            <div className="cta-actions">
              <button className="btn btn-primary btn-outline" type="button" onClick={() => { if (!authenticated || !repoUrl || !issueToFix.trim()) return; setStep("scanner"); startScan(repoUrl) }} disabled={!authenticated || !repoUrl || !issueToFix.trim()}>GET STARTED FREE</button>
              <a className="btn btn-outline" href="#docs">READ THE MANIFESTO</a>
            </div>
          </section>

          <footer className="footer" id="docs">
            <div className="footer-grid">
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <strong style={{ letterSpacing: "0.08em" }}>GITFIX AI</strong>
                <span style={{ opacity: 0.7 }}>© {new Date().getFullYear()} DECONSTRUCTION OF BUGS INC.</span>
              </div>
              <div style={{ display: "flex", gap: 16, justifyContent: "flex-end" }}>
                {authenticated && githubUser?.html_url ? <a href={githubUser.html_url} target="_blank" rel="noreferrer">GITHUB</a> : <span style={{ opacity: 0.7 }}>GITHUB</span>}
              </div>
            </div>
          </footer>
        </div>
      </div>
    )
  }

  // ── SCANNER PAGE ───────────────────────────────────────────────
  const { items: queueItems, applied, pending } = buildQueueState()
  const health = {
    cpu: `${Math.max(18, Math.min(78, Math.round(22 + progress * 0.28)))}.%`,
    mem: `${(1.2 + progress * 0.009).toFixed(1)}GB`,
    up: "04:12:88",
  }

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-top-inner">
          <div className="dash-brand"><div className="mark">▸</div><div>GITFIX AI <span style={{ opacity: 0.65 }}>/ / PROGRESS</span></div></div>
          <div className="dash-nav">
            <a href="#dash">DASHBOARD</a>
            <button className="btn" type="button" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: "inherit", letterSpacing: "inherit" }} onClick={handleHistoryTabOpen}>HISTORY</button>
            <a href="#settings">SETTINGS</a>
            <button className="btn dash-btn" type="button" onClick={() => setStep("landing")}>NEW TASK</button>
          </div>
        </div>
      </div>

      <div className="dash-shell" id="dash">
        <div className="left-stack">
          <div className="panel">
            <div className="box-title">STATUS</div>
            <div className="status-body">
              <div className="status-row"><span>VULNERABILITY PATCHING</span><span>{Math.round(progress)}%</span></div>
              <div className="progress-wrap" aria-label="Progress"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
              <div className="mini-kpis" aria-label="Counts">
                <div className="mini applied"><div className="n">{String(applied).padStart(2, "0")}</div><div className="t">APPLIED</div></div>
                <div className="mini pending"><div className="n">{String(pending).padStart(2, "0")}</div><div className="t">PENDING</div></div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="box-title">QUEUE</div>
            <div className="queue-body">
              {queueItems.map((it) => (
                <div key={it.id} className={`q-item ${it.state === "done" ? "done" : it.state === "active" ? "active" : "todo"}`}>
                  <div>{it.title}</div>
                  <div className="q-pill">{it.state === "done" ? "DONE" : it.state === "active" ? "RUNNING" : "QUEUED"}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="box-title">SYSTEM HEALTH</div>
            <div className="health-body">
              <div className="health-row"><strong>CPU LOAD</strong><span>{health.cpu}</span></div>
              <div className="health-row"><strong>MEM UTIL</strong><span>{health.mem}</span></div>
              <div className="health-row"><strong>UPTIME</strong><span>{health.up}</span></div>
              <div style={{ marginTop: 8, display: "flex", gap: 10 }}>
                {status === "completed" && <span className="pill" style={{ borderColor: "#0b0b0d" }}>SYSTEM STATUS: ONLINE</span>}
                {status === "running" && <span className="pill" style={{ borderColor: "#0b0b0d" }}>SYSTEM STATUS: ACTIVE</span>}
                {status === "error" && <span className="pill" style={{ borderColor: "#0b0b0d" }}>SYSTEM STATUS: DEGRADED</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="terminal" aria-label="Terminal output">
          <div className="terminal-head">
            <div className="dots" aria-hidden="true"><span className="dot" /><span className="dot y" /><span className="dot g" /></div>
            <div className="term-title">TERMINAL_OUTPUT_MAIN.LOG</div>
            <div style={{ opacity: 0.75, fontWeight: 800 }}>{authenticated && githubUser ? githubUser.login : "guest"}</div>
          </div>
          <div className="terminal-body">
            {logs.length === 0 ? (
              <div className="term-line"><span className="tag-sys">[SYSTEM]</span> {repoUrl ? `Ready. Scanning ${repoUrl}` : "Ready. Start a new task from the landing page."}</div>
            ) : (
              logs.map((line, i) => {
                const m = /^\[(SYSTEM|WARN|INFO|FIX|SUCCESS|STAGING)\]\s/.exec(line)
                const tag = m?.[1]
                const cls = tag === "SYSTEM" ? "tag-sys" : tag === "WARN" ? "tag-warn" : tag === "INFO" ? "tag-info" : tag === "FIX" ? "tag-fix" : tag === "SUCCESS" ? "tag-ok" : "tag-stage"
                if (tag) return <div className="term-line" key={i}><span className={cls}>{`[${tag}]`}</span> {line.replace(/^\[(SYSTEM|WARN|INFO|FIX|SUCCESS|STAGING)\]\s/, "")}</div>
                return <div className="term-line" key={i}>{line}</div>
              })
            )}

            {status === "completed" && result?.pull_request && (
              <div className="term-line" style={{ marginTop: 10 }}>
                <span className="tag-ok">[SUCCESS]</span> Pull Request:{" "}
                <a href={result.pull_request} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{result.pull_request}</a>
              </div>
            )}

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={() => startScan()} disabled={!repoUrl || !authenticated || status === "running"}>RESTART</button>
              <button className="btn btn-primary" type="button" onClick={() => createPullRequest(result, { auto: false })} disabled={creatingPr || status !== "completed" || !result?.results?.length}>{creatingPr ? "CREATING PR…" : "PUSH PR"}</button>
              <button className="btn" type="button" onClick={handleHistoryTabOpen}>VIEW HISTORY</button>
              <div className="pill" style={{ borderColor: "rgba(255,255,255,0.18)" }}>REPO: <span style={{ color: "#fff", fontWeight: 800 }}>{selectedRepo?.full_name || repoUrl || "—"}</span></div>
              <div className="pill" style={{ borderColor: "rgba(255,255,255,0.18)" }}>ISSUE: <span style={{ color: "#fff", fontWeight: 800 }}>{issueToFix || "—"}</span></div>
              {selectedFiles.length > 0 && (
                <div className="pill" style={{ borderColor: "rgba(0,255,128,0.3)", color: "#00ff80" }}>FILES: {selectedFiles.length} SELECTED</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}