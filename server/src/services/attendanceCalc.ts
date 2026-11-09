import { Types } from "mongoose";
import { AttendanceRecord, AttendanceSettings, Holiday, LeaveRequest, LeaveType } from "../models/Attendance";
import { User } from "../models/User";

export const DAY = 864e5;
export const MODES = ["Office", "Remote", "On-site"];

/* ------------------------------ date helpers ------------------------------ */

export const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
export const safeTz = (tz?: string) => (tz && validTz(tz) ? tz : "UTC");

function parts(ms: number, tz: string) {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(ms)
    .forEach((x) => (p[x.type] = x.value));
  return p;
}
export const dayKeyIn = (ms: number, tz: string) => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}`; };
export const minutesOfDay = (ms: number, tz: string) => { const p = parts(ms, tz); return Number(p.hour) * 60 + Number(p.minute); };
export const hmIn = (ms: number, tz: string) => { const p = parts(ms, tz); return `${p.hour}:${p.minute}`; };

export const hmToMin = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
};
export const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export function eachDay(from: string, to: string, max = 400) {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}
export function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/* -------------------------------- settings -------------------------------- */

const DEFAULT_LEAVE = [
  { name: "Casual Leave", code: "CL", color: "#2563EB", yearlyQuota: 12, paid: true },
  { name: "Sick Leave", code: "SL", color: "#DC2626", yearlyQuota: 8, paid: true },
  { name: "Earned Leave", code: "EL", color: "#16A34A", yearlyQuota: 10, paid: true },
  { name: "Unpaid Leave", code: "UL", color: "#64748B", yearlyQuota: 0, paid: false },
];

export async function seedLeaveTypes(workspaceId: string) {
  if (await LeaveType.exists({ workspaceId })) return;
  try {
    await LeaveType.insertMany(DEFAULT_LEAVE.map((t, i) => ({ ...t, workspaceId, nameLower: t.name.toLowerCase(), order: i })), { ordered: false });
  } catch {
    /* another request seeded them */
  }
}

/** Settings of a workspace. Created with sensible defaults the first time (timezone taken from the person who opens it). */
export async function getSettings(workspaceId: string, userId?: string): Promise<any> {
  const found = await AttendanceSettings.findOne({ workspaceId }).lean();
  if (found) return found;
  const u: any = userId ? await User.findById(userId).select("timezone").lean() : null;
  const tz = safeTz(u?.timezone);
  let s: any;
  try {
    s = await AttendanceSettings.findOneAndUpdate(
      { workspaceId },
      { $setOnInsert: { workspaceId, timezone: tz, trackingStartDate: dayKeyIn(Date.now(), tz) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (e: any) {
    if (e?.code !== 11000) throw e;
    s = await AttendanceSettings.findOne({ workspaceId }).lean();
  }
  await seedLeaveTypes(workspaceId);
  return s;
}

export function isWorkingDay(d: string, s: any) {
  const w = dow(d);
  if (!(s.workingDays || []).includes(w)) return false;
  if (w === 6 && (s.offSaturdays || []).includes(Math.ceil(Number(d.slice(8)) / 7))) return false;
  return true;
}

/** Number of leave days in a range (holidays and week-offs inside the range are not counted). */
export function leaveDaysCount(s: any, holidays: Set<string>, from: string, to: string, half: string) {
  let n = 0;
  for (const d of eachDay(from, to, 400)) if (isWorkingDay(d, s) && !holidays.has(d)) n++;
  return half !== "none" && from === to ? (n ? 0.5 : 0) : n;
}

/* --------------------------------- context --------------------------------- */

export interface LeaveMark { name: string; code: string; paid: boolean; half: string }
export interface Ctx {
  s: any;
  tz: string;
  today: string;
  nowMs: number;
  startMin: number;
  endMin: number;
  holidays: Map<string, string>;
  records: Map<string, any>;
  leaves: Map<string, LeaveMark[]>;
}

/** Loads everything needed to work out the days of some people between two dates (one query each, not one per day). */
export async function buildContext(s: any, workspaceId: string, from: string, to: string, userIds: string[]): Promise<Ctx> {
  const tz = s.timezone || "UTC";
  const nowMs = Date.now();
  const wid = new Types.ObjectId(workspaceId);
  const uids = userIds.map((i) => new Types.ObjectId(i));

  const [hol, recs, reqs, types]: [any[], any[], any[], any[]] = await Promise.all([
    Holiday.find({ workspaceId: wid, date: { $gte: from, $lte: to } }).lean(),
    uids.length ? AttendanceRecord.find({ workspaceId: wid, userId: { $in: uids }, date: { $gte: from, $lte: to } }).lean() : Promise.resolve([]),
    uids.length ? LeaveRequest.find({ workspaceId: wid, userId: { $in: uids }, status: "approved", from: { $lte: to }, to: { $gte: from } }).lean() : Promise.resolve([]),
    LeaveType.find({ workspaceId: wid }).lean(),
  ]);

  const holidays = new Map<string, string>(hol.map((h) => [h.date, h.name]));
  const records = new Map<string, any>(recs.map((r) => [`${r.userId}|${r.date}`, r]));
  const typeMap = new Map<string, any>(types.map((t) => [String(t._id), t]));
  const leaves = new Map<string, LeaveMark[]>();
  for (const r of reqs) {
    const t = typeMap.get(String(r.typeId));
    const lo = r.from > from ? r.from : from;
    const hi = r.to < to ? r.to : to;
    for (const d of eachDay(lo, hi, 400)) {
      if (!isWorkingDay(d, s) || holidays.has(d)) continue;
      const k = `${r.userId}|${d}`;
      leaves.set(k, [...(leaves.get(k) || []), { name: t?.name || "Leave", code: t?.code || "L", paid: t ? !!t.paid : true, half: r.half || "none" }]);
    }
  }

  return { s, tz, today: dayKeyIn(nowMs, tz), nowMs, startMin: hmToMin(s.workStart), endMin: hmToMin(s.workEnd), holidays, records, leaves };
}

/** First day that counts for a person: the workspace's tracking start, or the day they joined, whichever is later. */
export function personStart(ctx: Ctx, joinedAt?: Date | string | null) {
  const a = ctx.s.trackingStartDate || "0000-00-00";
  const b = joinedAt ? dayKeyIn(+new Date(joinedAt), ctx.tz) : "0000-00-00";
  return a > b ? a : b;
}

/* ---------------------------------- a day ---------------------------------- */

export interface DaySession { in: number; out: number | null; mode: string }
export interface DayInfo {
  date: string;
  status: "na" | "future" | "holiday" | "weekoff" | "leave" | "present" | "half_day" | "absent" | "incomplete" | "working" | "pending";
  expected: number;
  credit: number;
  worked: number;
  firstIn: number | null;
  lastOut: number | null;
  late: boolean;
  earlyLeave: boolean;
  overtime: number;
  short: boolean;
  workedOff: boolean;
  mode: string | null;
  sessions: DaySession[];
  holiday: string | null;
  leave: LeaveMark[] | null;
  paidLeave: number;
  unpaidLeave: number;
  manual: string | null;
  manualNote: string | null;
}

const blank = (date: string, status: DayInfo["status"]): DayInfo => ({
  date, status, expected: 0, credit: 0, worked: 0, firstIn: null, lastOut: null, late: false, earlyLeave: false, overtime: 0, short: false, workedOff: false,
  mode: null, sessions: [], holiday: null, leave: null, paidLeave: 0, unpaidLeave: 0, manual: null, manualNote: null,
});

export function dayInfo(ctx: Ctx, userId: string, date: string, startFrom: string): DayInfo {
  if (date < startFrom) return blank(date, "na");
  if (date > ctx.today) return blank(date, "future");

  const { s, tz } = ctx;
  const holiday = ctx.holidays.get(date) ?? null;
  const working = isWorkingDay(date, s);
  const rec = ctx.records.get(`${userId}|${date}`);
  const isToday = date === ctx.today;
  const full = s.fullDayMinutes;
  const half = s.halfDayMinutes;

  const sessions: DaySession[] = (rec?.sessions || []).map((x: any) => ({ in: +new Date(x.in), out: x.out ? +new Date(x.out) : null, mode: x.mode || "Office" }));
  const open = sessions.some((x) => x.out == null);
  let worked = 0;
  for (const x of sessions) {
    const end = x.out ?? (isToday ? ctx.nowMs : x.in); // a forgotten check-out of an earlier day counts as 0 until it is corrected
    worked += Math.max(0, end - x.in) / 60000;
  }
  worked = Math.floor(worked);
  const firstIn = sessions.length ? Math.min(...sessions.map((x) => x.in)) : null;
  const outs = sessions.filter((x) => x.out != null).map((x) => x.out as number);
  const lastOut = outs.length ? Math.max(...outs) : null;
  const manual: string | null = rec?.manualStatus || null;

  const d = blank(date, "absent");
  Object.assign(d, { worked, firstIn, lastOut, sessions, holiday, manual, manualNote: rec?.manualNote || null, mode: sessions[0]?.mode || null });

  // not a scheduled day: nothing is expected (anything worked is bonus time)
  if (holiday || !working) {
    d.status = holiday ? "holiday" : "weekoff";
    d.workedOff = sessions.length > 0 && worked > 0;
    d.overtime = d.workedOff ? worked : 0;
    return d;
  }

  const lv = ctx.leaves.get(`${userId}|${date}`) || null;
  d.leave = lv;
  if (lv) {
    const units = (l: LeaveMark) => (l.half === "none" ? 1 : 0.5);
    const total = Math.min(1, lv.reduce((a, l) => a + units(l), 0));
    d.paidLeave = Math.min(total, lv.filter((l) => l.paid).reduce((a, l) => a + units(l), 0));
    d.unpaidLeave = Math.max(0, total - d.paidLeave);
    if (total >= 1) {
      d.status = "leave";
      d.expected = d.paidLeave >= 1 ? 0 : 1; // paid leave is not expected work, unpaid leave counts against the rate
      return d;
    }
  }
  const expected = 1 - d.paidLeave;

  d.late = firstIn != null && minutesOfDay(firstIn, tz) > ctx.startMin + s.graceMinutes;
  d.earlyLeave = lastOut != null && minutesOfDay(lastOut, tz) < ctx.endMin - s.graceMinutes;

  // today, nothing finished yet: no verdict until the day is over
  if (isToday && !manual) {
    if (!sessions.length) {
      d.status = minutesOfDay(ctx.nowMs, tz) >= ctx.endMin ? "absent" : "pending";
      d.expected = d.status === "absent" ? expected : 0;
      return d;
    }
    if (open) {
      d.status = "working";
      return d;
    }
  }

  let creditWork = 0;
  if (manual) creditWork = manual === "present" ? 1 : manual === "half_day" ? 0.5 : 0;
  else if (sessions.length) creditWork = open ? 0.5 : worked >= full ? 1 : worked >= half ? 0.5 : 0; // forgotten check-out = half day until corrected

  d.expected = expected;
  d.credit = Math.min(expected, creditWork);
  d.short = sessions.length > 0 && !manual && !open && creditWork === 0;
  d.overtime = !open && sessions.length ? Math.max(0, Math.floor(worked - full * expected)) : 0;

  if (!sessions.length && !manual) d.status = "absent";
  else if (open && !manual) d.status = "incomplete";
  else if (d.credit >= expected - 1e-9) d.status = "present";
  else if (d.credit > 0) d.status = "half_day";
  else d.status = "absent";
  return d;
}

/* -------------------------------- summary -------------------------------- */

export function rating(score: number | null) {
  if (score == null) return { stars: null as number | null, label: "Not enough data" };
  if (score >= 95) return { stars: 5, label: "Excellent" };
  if (score >= 85) return { stars: 4, label: "Very good" };
  if (score >= 70) return { stars: 3, label: "Good" };
  if (score >= 50) return { stars: 2, label: "Needs improvement" };
  return { stars: 1, label: "Poor" };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(days: DayInfo[], ctx: Ctx) {
  const full = ctx.s.fullDayMinutes;
  const t = { workingDays: 0, present: 0, halfDays: 0, absent: 0, incomplete: 0, paidLeave: 0, unpaidLeave: 0, late: 0, earlyLeave: 0, holidays: 0, weekOffs: 0, workedMinutes: 0, overtimeMinutes: 0, daysWorked: 0 };
  let expected = 0, credit = 0, checkins = 0, hoursNum = 0, hoursDen = 0;

  for (const d of days) {
    if (d.status === "na" || d.status === "future") continue;
    if (d.status === "holiday" || d.status === "weekoff") {
      d.status === "holiday" ? t.holidays++ : t.weekOffs++;
      if (d.workedOff) { t.workedMinutes += d.worked; t.overtimeMinutes += d.overtime; }
      continue;
    }
    if (d.expected > 0 || d.status === "leave") t.workingDays++;
    if (d.status === "present") t.present++;
    else if (d.status === "half_day") t.halfDays++;
    else if (d.status === "absent") t.absent++;
    else if (d.status === "incomplete") t.incomplete++;
    t.paidLeave += d.paidLeave;
    t.unpaidLeave += d.unpaidLeave;
    expected += d.expected;
    credit += d.credit;
    if (d.firstIn != null) {
      checkins++;
      if (d.late) t.late++;
    }
    if (d.earlyLeave) t.earlyLeave++;
    if (d.worked > 0) { t.workedMinutes += d.worked; t.daysWorked++; }
    t.overtimeMinutes += d.overtime;
    if (d.sessions.length && d.expected > 0 && d.status !== "working" && d.status !== "incomplete") {
      hoursNum += Math.min(d.worked, full * d.expected);
      hoursDen += full * d.expected;
    }
  }

  const rate = expected > 0 ? (credit / expected) * 100 : null;
  const punctuality = checkins > 0 ? ((checkins - t.late) / checkins) * 100 : 100;
  const hoursScore = hoursDen > 0 ? (hoursNum / hoursDen) * 100 : 100;
  const score = rate == null ? null : Math.round(0.6 * rate + 0.25 * punctuality + 0.15 * hoursScore);

  return {
    ...t,
    paidLeave: r1(t.paidLeave),
    unpaidLeave: r1(t.unpaidLeave),
    avgMinutes: t.daysWorked ? Math.round(t.workedMinutes / t.daysWorked) : 0,
    attendanceRate: rate == null ? null : Math.round(rate),
    punctuality: Math.round(punctuality),
    hoursScore: Math.round(hoursScore),
    score,
  };
}

/** Same numbers, safe to send to the browser. */
export const dayView = (d: DayInfo) => ({
  date: d.date, status: d.status, worked: d.worked, firstIn: d.firstIn, lastOut: d.lastOut, late: d.late, earlyLeave: d.earlyLeave, overtime: d.overtime,
  short: d.short, workedOff: d.workedOff, mode: d.mode, sessions: d.sessions, holiday: d.holiday, leave: d.leave, manual: d.manual, manualNote: d.manualNote,
});