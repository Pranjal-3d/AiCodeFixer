import { logoutGithub } from "../services/githubAuth"

export default function GithubLogout({ refresh, className = "" }) {
  const handleLogout = async () => {
    await logoutGithub()
    if (refresh) await refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className={`text-blue-500 hover:text-blue-700 transition ${className}`}
    >
      Logout
    </button>
  )
}