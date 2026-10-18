import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("pm_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("pm_token");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    if (error.response?.data?.code === "PASSWORD_CHANGE_REQUIRED" && window.location.pathname !== "/change-password") {
      window.location.href = "/change-password"; // Part 2 adds this page
    }
    return Promise.reject(error);
  }
);

export function apiError(err: unknown): string {
  const anyErr = err as { response?: { data?: { message?: string } } };
  return anyErr?.response?.data?.message || "Something went wrong. Please try again.";
}
