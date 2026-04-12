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

  useEffect(() => {
    document.body.style.backgroundColor = "#f0f0f0"; // Change to any color you want
  }, []);

  return (
    <div>
      <h1>AI Code Reviewer</h1>
      {/* Other components and JSX go here */}
    </div>
  )
}