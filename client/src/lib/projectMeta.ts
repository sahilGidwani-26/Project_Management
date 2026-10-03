import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { ProjectStatus } from "@/types";

export const PROJECT_STATUSES: ProjectStatus[] = ["Planning", "Active", "On Hold", "Completed", "Cancelled"];
export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export const TASK_STATUSES = ["Backlog", "Todo", "In Progress", "In Review", "Done"] as const;
export const CATEGORIES = ["Development", "Design", "Marketing", "Sales", "Operations", "Support", "Research", "Other"];
export const PROJECT_COLORS = ["#6366F1", "#0F766E", "#2563EB", "#DB2777", "#EA580C", "#CA8A04", "#7C3AED", "#475569"];
export const PROJECT_ICONS = ["📁", "🚀", "🎨", "📣", "🛠️", "📊", "💡", "🌐", "📱", "🧪"];
export const CURRENCIES = ["USD", "INR", "EUR", "GBP"];

export const statusDot: Record<string, string> = {
  Planning: "bg-slate-400",
  Active: "bg-emerald-500",
  "On Hold": "bg-amber-500",
  Completed: "bg-blue-500",
  Cancelled: "bg-red-400",
  Archived: "bg-slate-300",
};

export const taskStatusColor: Record<string, string> = {
  Backlog: "#94A3B8",
  Todo: "#3B82F6",
  "In Progress": "#F59E0B",
  "In Review": "#8B5CF6",
  Done: "#10B981",
};

export const severityCls: Record<string, string> = {
  Low: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  Medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  High: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  Critical: "bg-red-500/15 text-red-700 dark:text-red-300",
};

/** `<input type="date">` value -> ISO string (khaali ho to null). */
export const toISO = (d?: string) => (d ? new Date(d).toISOString() : null);
export const toInput = (d?: string | null) => (d ? d.slice(0, 10) : "");
export const fmtMinutes = (m = 0) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
export const fmtBytes = (b = 0) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const dayMs = 864e5;

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - +new Date(iso)) / 1000));
  const u: [number, string][] = [[31536000, "y"], [2592000, "mo"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [n, l] of u) if (s >= n) return `${Math.floor(s / n)}${l} ago`;
  return "just now";
}

/** API call chalata hai, error toast dikhata hai (aur optional success toast), success par true return. */
export async function attempt(fn: () => Promise<unknown>, ok?: string) {
  try {
    await fn();
    if (ok) toast.success(ok);
    return true;
  } catch (e) {
    toast.error(apiError(e));
    return false;
  }
}

/** Authenticated endpoint (Bearer token ke saath) ko file ki tarah download karta hai. */
export async function downloadFromApi(path: string, fallbackName: string) {
  const res = await api.get(path, { responseType: "blob" });
  const cd = String(res.headers["content-disposition"] || "");
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}