const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const TOKEN_KEY = "thinkai_video_studio_token";

function getToken() {
  return window.localStorage.getItem(TOKEN_KEY) || "";
}

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || response.statusText);
    error.detail = body.detail;
    throw error;
  }
  return body;
}

export const api = {
  base: API_BASE,
  getToken,
  setToken: (token) => window.localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => window.localStorage.removeItem(TOKEN_KEY),
  register: (payload) => request("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  login: (payload) => request("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  me: () => request("/api/auth/me"),
  config: () => request("/api/config"),
  saveConfig: (payload) => request("/api/config", { method: "PUT", body: JSON.stringify(payload) }),
  models: () => request("/api/models"),
  tasks: () => request("/api/tasks"),
  createVideo: (payload) => request("/api/videos", { method: "POST", body: JSON.stringify(payload) }),
  getTask: (taskId) => request(`/api/videos/${taskId}`),
  downloadVideo: (taskId) => request(`/api/videos/${taskId}/download`, { method: "POST" })
};
