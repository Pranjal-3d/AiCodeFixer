import { logoutGithub } from "../services/githubAuth";

export default function GithubLogout({
  refresh,
  className = "",
  label = "Logout",
}) {
  const handleLogout = async () => {
    await logoutGithub();
    if (refresh) {
      await refresh();
    }
    // Optional but helpful: also log out from GitHub.com so next login can use a different account.
    // GitHub shows a confirmation screen; we open it in a new tab so the user can confirm.
    window.open("https://github.com/logout", "_blank", "noopener,noreferrer");
  };

  return (
    <button
      onClick={handleLogout}
      className={className}
      style={{
        padding: "10px 20px",
        background: "#ff4d4f",
        color: "white",
        borderRadius: "999px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}


