export const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (ms: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
export const shiftMonth = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
export const fmtTime = (ms: number | null | undefined, tz: string) => (ms ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(ms) : "—");
export const hhmm = (ms: number, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
export const fmtDur = (m: number) => `${Math.floor(m / 60)}h ${pad(Math.round(m % 60))}m`;
export const fmtDate = (d: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { ...o, timeZone: "UTC" });
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const hmMinutes = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
export const minutesNow = (tz: string) => hmMinutes(hhmm(Date.now(), tz));

function offset(ms: number, tz: string) {
  const p: Record<string, number> = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(ms).forEach((x) => { if (x.type !== "literal") p[x.type] = Number(x.value); });
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}
/** "2026-11-05" + "09:30" in a timezone -> UTC milliseconds. */
export function zonedToMs(date: string, hm: string, tz: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const t = guess - offset(guess, tz);
  return guess - offset(t, tz);
}

export const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  present: { label: "Present", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  working: { label: "Working", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  half_day: { label: "Half day", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  absent: { label: "Absent", cls: "bg-red-500/15 text-red-700 dark:text-red-300", dot: "bg-red-500" },
  leave: { label: "On leave", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
  holiday: { label: "Holiday", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  weekoff: { label: "Week off", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300", dot: "bg-slate-400" },
  incomplete: { label: "No check-out", cls: "bg-orange-500/15 text-orange-700 dark:text-orange-300", dot: "bg-orange-500" },
  pending: { label: "Not yet in", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300", dot: "bg-slate-400" },
};

export const CODE_CLS: Record<string, string> = {
  P: "bg-emerald-500/25 text-emerald-800 dark:text-emerald-200", PL: "bg-amber-500/25 text-amber-800 dark:text-amber-200", HD: "bg-yellow-500/25 text-yellow-800 dark:text-yellow-200",
  A: "bg-red-500/25 text-red-800 dark:text-red-200", L: "bg-sky-500/25 text-sky-800 dark:text-sky-200", H: "bg-violet-500/25 text-violet-800 dark:text-violet-200",
  W: "bg-slate-500/15 text-slate-500", I: "bg-orange-500/25 text-orange-800 dark:text-orange-200",
};

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MODES = ["Office", "Remote", "On-site"] as const;