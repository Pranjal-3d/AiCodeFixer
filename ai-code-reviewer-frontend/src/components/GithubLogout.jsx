import { logoutGithub } from "../services/githubAuth";

export default function GithubLogout({ refresh, className = "" }) {
  const handleLogout = async () => {
    await logoutGithub();
    if (refresh) await refresh();
  };

  return (
    <button
      onClick={handleLogout}
      className={`text-slate-300 hover:text-white transition ${className}`}
    >
      Logout
    </button>
  );
}