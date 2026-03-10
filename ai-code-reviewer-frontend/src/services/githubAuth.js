const API = "http://localhost:5000";

export const loginGithub = () => {
  window.location.href = `${API}/auth/github/login`;
};

export const logoutGithub = async () => {
  await fetch(`${API}/auth/logout`, {
    method: "POST",
  });
};

export const getAuthStatus = async () => {
  const res = await fetch(`${API}/auth/status`);
  return res.json();
};


