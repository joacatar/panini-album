import { getAccessToken } from "./supabase.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.detail || data.message || res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export const api = {
  matches: (filter = "cerca") => apiFetch(`/matches?filter=${filter}`),
  trades: (role = "all") => apiFetch(`/trades?role=${role}`),
  trade: (id) => apiFetch(`/trades/${id}`),
  createTrade: (body) => apiFetch("/trades", { method: "POST", body: JSON.stringify(body) }),
  updateTrade: (id, body) =>
    apiFetch(`/trades/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  postMessage: (id, body) =>
    apiFetch(`/trades/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  createReview: (tradeId, body) =>
    apiFetch(`/reviews/trades/${tradeId}`, { method: "POST", body: JSON.stringify(body) }),
  userReviews: (userId) => apiFetch(`/reviews/users/${userId}`),
  report: (body) => apiFetch("/reviews/reports", { method: "POST", body: JSON.stringify(body) }),
};
