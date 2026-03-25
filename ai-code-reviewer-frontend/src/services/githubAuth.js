const API = "http://localhost:5000";

export const loginGithub = () => {
  window.location.href = `${API}/auth/github/login`;
};

export const logoutGithub = async () => {
  await fetch(`${API}/auth/logout`, {
    method: "POST",
    credentials: "include",   // ← FIXED
  });
};

export const getAuthStatus = async () => {
  const res = await fetch(`${API}/auth/status`, {
    credentials: "include",   // ← FIXED
  });
  return res.json();
};