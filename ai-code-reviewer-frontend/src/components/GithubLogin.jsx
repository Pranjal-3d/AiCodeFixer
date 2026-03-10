import { loginGithub } from "../services/githubAuth";

export default function GithubLogin({ className = "", label = "Login with GitHub" }) {
  return (
    <button
      onClick={loginGithub}
      className={className}
      style={{
        padding: "10px 20px",
        background: "#24292e",
        color: "white",
        borderRadius: "999px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}


