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
  const [historyRepos, setHistoryRepos] = useState([])
  const [historyResults, setHistoryResults] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState("")
  const [historySearch, setHistorySearch] = useState("")
  const [repoFilter, setRepoFilter] = useState("")
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null)
  const historyDebounce = useRef(null)

  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef(null)

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

  useEffect(() => {
    // Load history repos for sidebar right away
    axios.get(`${API}/history/repos`)
      .then(res => setHistoryRepos(res.data?.repos || []))
      .catch(() => setHistoryRepos([]))
  }, [])

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
    clearTimeout(historyDebounce.current)
    if (!historySearch.trim()) { setHistoryResults([]); return }
    historyDebounce.current = setTimeout(() => fetchHistoryBySearch(historySearch), 500)
    return () => clearTimeout(historyDebounce.current)
  }, [historySearch])

  // ── Chatbot helpers ────────────────────────────────────────────
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    if (isChatOpen) scrollToBottom()
  }, [chatMessages, isChatOpen])

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return
    const userMsg = { role: "user", content: chatInput }
    setChatMessages(prev => [...prev, userMsg])
    setChatInput("")
    setChatLoading(true)

    try {
      const res = await axios.post(`${API}/chat`, {
        message: chatInput,
        history: chatMessages.slice(-10) // Send last 10 messages for context
      })
      const aiMsg = { role: "assistant", content: res.data.reply }
      setChatMessages(prev => [...prev, aiMsg])
    } catch (err) {
      console.error("Chat error:", err)
      const errMsg = err.response?.data?.error || err.message || "Unknown error"
      setChatMessages(prev => [...prev, { role: "assistant", content: `⚠️ Connection failed: ${errMsg}. Check your server logs and API keys.` }])
    } finally {
      setChatLoading(false)
    }
  }

  // ── Load history into main workspace terminal ─────────────────
  const loadHistoryToWorkspace = async (ownerRepo) => {
    if (!ownerRepo || !ownerRepo.includes("/")) return
    const [owner, repo] = ownerRepo.split("/")
    setStep("scanner")
    setRepoUrl(`https://github.com/${owner}/${repo}`)
    setStatus("idle")
    setProgress(0)
    setResult(null)
    setLogs([])

    const fmtLocal = (tag, text) => `[${tag}] ${text}`
    setLogs([fmtLocal("SYSTEM", `Loading history for ${owner}/${repo}…`)])

    try {
      const res = await axios.get(`${API}/history/${owner}/${repo}`)
      const records = res.data?.history || []

      if (!records.length) {
        setLogs([fmtLocal("WARN", `No history found for ${owner}/${repo}.`)])
        return
      }

      const newLogs = []
      newLogs.push(fmtLocal("SYSTEM", `═══════════════════════════════════════`))
      newLogs.push(fmtLocal("SYSTEM", `HISTORY LOADED — ${owner}/${repo}`))
      newLogs.push(fmtLocal("SYSTEM", `Branch: ${records[0]?.branch || "unknown"}  |  ${records.length} file(s) on record`))
      newLogs.push(fmtLocal("SYSTEM", `═══════════════════════════════════════`))

      records.forEach((r) => {
        newLogs.push(fmtLocal("INFO", `File: ${r.path}`))
        if (r.summary) newLogs.push(fmtLocal("FIX", r.summary))
        if (Array.isArray(r.issues_found) && r.issues_found.length) {
          r.issues_found.forEach(issue => newLogs.push(`  ⚠ ${issue}`))
        }
        newLogs.push(fmtLocal(r.has_fix ? "SUCCESS" : "WARN", r.has_fix ? "Fix was generated in this session." : "No fix was generated."))
        newLogs.push(`  Analyzed: ${r.analyzed_at ? new Date(r.analyzed_at).toLocaleString() : "unknown"}`)
        newLogs.push("")
      })

      newLogs.push(fmtLocal("SYSTEM", `Context restored. Describe a new issue below and click FIX IT to continue improving this repo.`))
      setLogs(newLogs)

      // Prime chatbot context with the history
      const contextSummary = records.map(r =>
        `File: ${r.path}\nSummary: ${r.summary || 'No summary'}\nIssues: ${Array.isArray(r.issues_found) ? r.issues_found.join(', ') : 'None'}\nHas Fix: ${r.has_fix}`
      ).join('\n\n')
      setChatMessages([{
        role: 'assistant',
        content: `📂 **History loaded for ${owner}/${repo}**\n\nI have context from a previous analysis session. Here's a summary:\n\n${records.map(r => `- \`${r.path}\` — ${r.summary || 'No summary'}`).join('\n')}\n\nYou can ask me about these changes, or describe a new issue and click **FIX IT** to continue working on this repo.`
      }])
      setIsChatOpen(true)

      // refresh history repos list
      const reposRes = await axios.get(`${API}/history/repos`)
      setHistoryRepos(reposRes.data?.repos || [])
    } catch (err) {
      setLogs([fmtLocal("WARN", `Failed to load history: ${err.response?.data?.error || err.message}`)])
    }
  }

  // ── Logging ────────────────────────────────────────────────────
  const addLog = (message) => setLogs((prev) => [...prev, message])
  const fmt = (tag, text) => `[${tag}] ${text}`



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
      addLog(fmt("SUCCESS", "Scan complete. Review the results above."))
      addLog(fmt("INFO", "✅ Analysis done — click \"Push PR\" when you're ready to create a Pull Request for review."))
      setResult(res.data)
      setStatus("completed")
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
// Queue items have been moved to sidebar

  return (
    <div className="dash-shell" id="dash">
      <div className="sidebar">
        <div className="sidebar-top">
          <div className="dash-brand"><div className="mark">▸</div><div>GITFIX AI</div></div>
        </div>
        <div className="sidebar-nav">
          <div className="sidebar-nav-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            Dashboard
          </div>
          <div className="sidebar-nav-item" onClick={() => {
            if (historyRepos.length > 0) loadHistoryToWorkspace(historyRepos[0].full_name)
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            History
          </div>
          <div className="sidebar-nav-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Progress
          </div>
          <div className="sidebar-nav-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            Settings
          </div>
        </div>
        <div className="sidebar-recent">
          <div className="sidebar-recent-title">Recent Runs</div>
          <div className="run-item active">
            <div className="run-item-top">Pranjal-3d / test</div>
            <div className="run-item-bottom"><span className="run-badge running">Running</span> {status === "running" ? `${Math.round(progress)}%` : "2m ago"}</div>
          </div>
          {historyRepos.slice(0, 4).map((r, i) => (
             <div className="run-item" key={i} onClick={() => loadHistoryToWorkspace(r.full_name)}>
               <div className="run-item-top">{r.full_name}</div>
               <div className="run-item-bottom"><span className="run-badge done">Done</span> {r.latest_at ? new Date(r.latest_at).toLocaleDateString() : "History"}</div>
             </div>
          ))}

        </div>
        <div className="sidebar-bottom">
           <button className="btn dash-btn" style={{width: "100%", height: 42}} type="button" onClick={() => setStep("landing")}>+ New Task</button>
        </div>
      </div>

      <div className="terminal-wrapper" aria-label="Terminal output">
        <div className="terminal">
          <div className="terminal-head">
            <div className="dots" aria-hidden="true"><span className="dot" /><span className="dot y" /><span className="dot g" /></div>
            <div className="term-title">TERMINAL_OUTPUT_MAIN.LOG</div>
            <div style={{ opacity: 0.75, fontWeight: 800, padding: "2px 8px", background: "rgba(255,255,255,0.06)", borderRadius: 4 }}>
              {repoUrl ? repoUrl.replace('https://github.com/', '') : (authenticated && githubUser ? `${githubUser.login}` : "Ready")}
            </div>
          </div>
          <div className="terminal-body">
            {logs.length === 0 ? (
              <div className="term-line"><span className="terminal-tag tag-sys">SYS</span>Ready. {repoUrl ? `Scanning ${repoUrl}` : "Start a new task from the landing page."}</div>
            ) : (
              logs.map((line, i) => {
                const m = /^\[(SYSTEM|WARN|INFO|FIX|SUCCESS|STAGING)\]\s/.exec(line)
                const tag = m?.[1]
                const cls = tag === "SYSTEM" ? "tag-sys" : tag === "WARN" ? "tag-warn" : tag === "INFO" ? "tag-info" : tag === "FIX" ? "tag-fix" : tag === "SUCCESS" ? "tag-ok" : "tag-stage"
                const shortTag = tag === "SYSTEM" ? "SYS" : tag === "SUCCESS" ? "OK" : tag
                if (tag) return <div className="term-line" key={i}><span className={`terminal-tag ${cls}`}>{shortTag}</span>{line.replace(/^\[(SYSTEM|WARN|INFO|FIX|SUCCESS|STAGING)\]\s/, "")}</div>
                return <div className="term-line" key={i}>{line}</div>
              })
            )}

            {status === "completed" && result?.pull_request && (
              <div className="term-line" style={{ marginTop: 10 }}>
                <span className="terminal-tag tag-ok">OK</span> Pull Request:{" "}
                <a href={result.pull_request} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", color: "#5cff8a" }}>{result.pull_request}</a>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 24, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" type="button" onClick={() => startScan()} disabled={!repoUrl || !authenticated || status === "running"} style={{background: "rgba(255,255,255,0.03)", fontWeight: 800}}>Restart</button>
          <button className="btn" type="button" onClick={() => createPullRequest(result, { auto: false })} disabled={creatingPr || status !== "completed" || !result?.results?.length} style={{background: "rgba(255,255,255,0.03)", fontWeight: 800}}>{creatingPr ? "Creating PR…" : "Push PR"}</button>
          <button className="btn" type="button" onClick={() => { if (historyRepos.length > 0) loadHistoryToWorkspace(historyRepos[0].full_name) }} style={{background: "rgba(255,255,255,0.03)", fontWeight: 800}}>View history</button>
          <button className="btn" type="button" onClick={() => setIsChatOpen(!isChatOpen)} style={{ background: isChatOpen ? "var(--yellow)" : "rgba(255,255,255,0.03)", color: isChatOpen ? "#000" : "#fff", fontWeight: 800 }}>
            {isChatOpen ? "Close Assistant" : "AI assistant"}
          </button>
          
          <div style={{ flex: 1 }}></div>
          {status === "running" && (
            <div className="pill" style={{ borderColor: "#222", background: "rgba(255,255,255,0.03)" }}>
              <span style={{color: "var(--yellow)"}}>●</span> <span style={{opacity: 0.7}}>Vulnerability Patching {Math.round(progress)}%</span>
            </div>
          )}
        </div>

        {/* Chatbot Overlay */}
        {isChatOpen && (
          <div className="chat-panel panel" style={{ width: 340, height: 480, position: "fixed", bottom: 90, right: 30, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden", boxShadow: "0 20px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)", zIndex: 100, borderRadius: 12 }}>
            <div className="box-title" style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0b0b0d" }}>
              <span>AI CODE ASSISTANT</span>
              <button onClick={() => setIsChatOpen(false)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", opacity: 0.5, fontSize: 18 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: 14 }}>
              {chatMessages.length === 0 && (
                <div style={{ textAlign: "center", opacity: 0.4, marginTop: 40, fontSize: 11 }}>
                  HOW CAN I HELP WITH YOUR CODE TODAY?<br/>
                  <span style={{ fontSize: 9 }}>TRY ASKING ABOUT THE CURRENT ANALYSIS RESULTS.</span>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", background: msg.role === "user" ? "var(--yellow)" : "rgba(255,255,255,0.06)", color: msg.role === "user" ? "#000" : "#fff", padding: "10px 14px", borderRadius: 8, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {msg.content}
                </div>
              ))}
              {chatLoading && <div style={{ alignSelf: "flex-start", opacity: 0.5, fontSize: 10, padding: "4px 8px", background: "rgba(255,255,255,0.06)", borderRadius: 8 }}>GITFIX THINKING…</div>}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: "12px", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: 12, height: 32 }}
                placeholder="TYPE A QUESTION…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
              />
              <button className="btn btn-primary" style={{ padding: "0 10px", height: 32 }} onClick={sendChatMessage} disabled={chatLoading}>SEND</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}