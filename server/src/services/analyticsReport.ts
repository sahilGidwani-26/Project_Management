import { Request } from "express";
import { Types } from "mongoose";
import { ApiError } from "../utils/ApiError";
import { Project } from "../models/Project";
import { Task } from "../models/Task";
import { User } from "../models/User";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { TaskStatusEvent } from "../models/TaskStatusEvent";
import { TimeEntry } from "../models/ProjectExtras";
import { Meeting, MeetingJoin } from "../models/Meeting";
import { isManagerLevel } from "./permissions";
import { addDays, buildContext, dayInfo, dayKeyIn, daysBetween, dow, eachDay, getSettings, isDate, personStart, rating, safeTz, summarize } from "./attendanceCalc";
import { trackedPeople } from "./attendanceMembers";

/* ---------------------------------- model ---------------------------------- */

export interface Kpi { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" | "info" }
export interface ChartDef {
  id: string; title: string; type: "bar" | "hbar" | "hstacked" | "line" | "donut"; note?: string; unit?: string;
  data?: { name: string; value: number; color?: string }[];
  x?: string[]; series?: { name: string; color: string; values: number[] }[];
}
export interface TableDef {
  id: string; title: string; note?: string;
  columns: { key: string; label: string; fmt?: "text" | "int" | "pct" | "dur" | "date" | "dec1"; w?: number }[];
  rows: Record<string, any>[];
}
export interface SectionDef { key: string; title: string; kpis: Kpi[]; charts: ChartDef[]; tables: TableDef[]; notes: string[] }
export interface ReportMeta { workspaceName: string; from: string; to: string; days: number; tz: string; project: string | null; generatedAt: string; generatedBy: string }

export const SECTION_LIST = [
  { key: "overview", label: "Overview", needs: [] as string[] },
  { key: "projects", label: "Projects", needs: ["projects.view"] },
  { key: "tasks", label: "Tasks", needs: ["tasks.view"] },
  { key: "bugs", label: "Bugs", needs: ["bugs.view"] },
  { key: "team", label: "Team", needs: ["people.view"] },
  { key: "time", label: "Time", needs: ["time.view"] },
  { key: "attendance", label: "Attendance", needs: ["attendance.team"] },
];
export const availableSections = (perms: Set<string>) =>
  SECTION_LIST.filter((s) => (s.key === "attendance" ? perms.has("attendance.team") : perms.has("analytics.view") && s.needs.every((p) => perms.has(p)))).map(({ key, label }) => ({ key, label }));

/* --------------------------------- helpers --------------------------------- */

const ID = /^[a-f\d]{24}$/i;
const DAY = 864e5;
const FINISHED = /^(completed|complete|done|archived|cancelled|canceled|closed)$/i;
const DONE_P = /complet|done/i;
const PAL = ["#14B8A6", "#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899", "#10B981", "#EF4444", "#06B6D4"];
const STATUS_COL: Record<string, string> = { Backlog: "#94A3B8", Todo: "#3B82F6", "In Progress": "#F59E0B", "In Review": "#8B5CF6", Done: "#10B981" };
const PRIO_COL: Record<string, string> = { Low: "#94A3B8", Medium: "#3B82F6", High: "#F59E0B", Urgent: "#EF4444", Critical: "#EF4444" };
const SEV_COL: Record<string, string> = { Critical: "#EF4444", High: "#F97316", Medium: "#F59E0B", Low: "#94A3B8", Unrated: "#CBD5E1" };

export const fmtDur = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pc = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const med = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const lbl = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const sumIf = (cond: any) => ({ $sum: { $cond: [cond, 1, 0] } });
const dayKeyExpr = (field: string, tz: string) => ({ $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: tz } });
const dMap = (rows: any[]) => new Map<string, number>(rows.map((r) => [r._id, r.count]));

function offsetMs(ms: number, tz: string) {
  const p: Record<string, number> = {};
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(ms).forEach((x) => { if (x.type !== "literal") p[x.type] = Number(x.value); });
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}
/** Midnight of a date in a timezone, in milliseconds. */
export function zonedStart(date: string, tz: string) {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const t = guess - offsetMs(guess, tz);
  return guess - offsetMs(t, tz);
}

/* ---------------------------------- scope ---------------------------------- */

export interface Scope {
  workspaceId: string; wid: Types.ObjectId; uid: string; tz: string; today: string; todayUtc: Date;
  range: { from: string; to: string; days: number; fromMs: number; toMs: number; prevFromMs: number; prevToMs: number };
  projects: any[]; ids: Types.ObjectId[]; projectId: string | null; pn: Map<string, string>;
  taskFilter: any; canTasks: boolean; canBugs: boolean; canTime: boolean; canPeople: boolean; canProjects: boolean; canMeet: boolean; userName: string;
}

/** Works out the dates and which projects and tasks THIS person may see (private projects, "only my projects" roles, bug and task permissions). */
export async function buildScope(req: Request): Promise<Scope> {
  const a = req.access!;
  const q = req.query as Record<string, string>;
  const workspaceId = req.params.workspaceId;
  const uid = req.user!.id;
  const u: any = await User.findById(uid).select("timezone name").lean();
  const tz = safeTz(u?.timezone);
  const today = dayKeyIn(Date.now(), tz);

  let to = isDate(q.to) ? q.to : today;
  if (to > today) to = today;
  const from = isDate(q.from) ? q.from : addDays(to, -29);
  if (from > to) throw ApiError.badRequest("The start date is after the end date");
  if (daysBetween(from, to) > 365) throw ApiError.badRequest("Choose a range of at most one year");
  const fromMs = zonedStart(from, tz);
  const toMs = zonedStart(addDays(to, 1), tz);
  const range = { from, to, days: daysBetween(from, to) + 1, fromMs, toMs, prevFromMs: fromMs - (toMs - fromMs), prevToMs: fromMs };

  const me = new Types.ObjectId(uid);
  const wid = new Types.ObjectId(workspaceId);
  const mine = [{ members: me }, { managerId: me }, { createdBy: me }];
  const limited = a.scope === "member" && !a.isOwner;
  const vis: any = { workspaceId: wid };
  if (limited) vis.$or = mine;
  else if (!isManagerLevel(a)) vis.$or = [{ visibility: { $ne: "private" } }, ...mine];

  let projects: any[] = await Project.find(vis).select("name color icon status priority startDate endDate").limit(300).lean();
  let projectId: string | null = null;
  if (ID.test(q.projectId || "")) {
    const p = projects.find((x) => String(x._id) === q.projectId);
    if (!p) throw ApiError.forbidden("You cannot open that project");
    projects = [p];
    projectId = q.projectId;
  }
  const ids = projects.map((p) => p._id as Types.ObjectId);

  const canTasks = a.perms.has("tasks.view");
  const canBugs = a.perms.has("bugs.view");
  const and: any[] = [];
  if (projectId) and.push({ projectId: ids[0] });
  else {
    const orphan: any = { projectId: { $exists: false } };
    if (limited) orphan.$or = [{ assigneeIds: me }, { createdBy: me }];
    and.push({ $or: [{ projectId: { $in: ids } }, orphan] });
  }
  if (!canBugs) and.push({ type: { $ne: "Bug" } });
  if (!canTasks) and.push({ type: "Bug" });

  return {
    workspaceId, wid, uid, tz, today, todayUtc: new Date(`${today}T00:00:00Z`), range, projects, ids, projectId,
    pn: new Map(projects.map((p) => [String(p._id), p.name])),
    taskFilter: { workspaceId: wid, parentTaskId: { $exists: false }, $and: and },
    canTasks, canBugs, canTime: a.perms.has("time.view"), canPeople: a.perms.has("people.view"), canProjects: a.perms.has("projects.view"), canMeet: a.perms.has("meetings.view"),
    userName: u?.name || "",
  };
}

const tf = (s: Scope, ...extra: any[]) => ({ ...s.taskFilter, $and: [...s.taskFilter.$and, ...extra] });
const inR = (s: Scope) => ({ $gte: new Date(s.range.fromMs), $lt: new Date(s.range.toMs) });
const inPrev = (s: Scope) => ({ $gte: new Date(s.range.prevFromMs), $lt: new Date(s.range.prevToMs) });
const timeF = (s: Scope, r: any) => ({ workspaceId: s.wid, date: r, projectId: { $in: s.ids } });
const overdueExpr = (s: Scope) => ({ $and: [{ $ne: ["$status", "Done"] }, { $gt: ["$dueDate", null] }, { $lt: ["$dueDate", s.todayUtc] }] });
const empty = (key: string, title: string): SectionDef => ({ key, title, kpis: [], charts: [], tables: [], notes: [] });

function delta(cur: number, prev: number, days: number) {
  if (!prev) return cur ? "new activity" : "no change";
  return `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}% vs previous ${days} days`;
}

/** Daily counts become days (31 days or fewer) or blocks of 7 days. */
function trend(s: Scope, ...maps: Map<string, number>[]) {
  const days = eachDay(s.range.from, s.range.to, 400);
  if (days.length <= 31) return { x: days.map(lbl), vals: maps.map((m) => days.map((d) => m.get(d) || 0)), unit: "day" };
  const x: string[] = [];
  const vals = maps.map(() => [] as number[]);
  for (let i = 0; i < days.length; i += 7) {
    const blk = days.slice(i, i + 7);
    x.push(lbl(blk[0]));
    maps.forEach((m, k) => vals[k].push(blk.reduce((t, d) => t + (m.get(d) || 0), 0)));
  }
  return { x, vals, unit: "week" };
}

async function nameMap(ids: unknown[]) {
  const u = [...new Set(ids.map(String))].filter((i) => ID.test(i));
  const rows: any[] = u.length ? await User.find({ _id: { $in: u } }).select("name").lean() : [];
  return new Map<string, string>(rows.map((x) => [String(x._id), x.name]));
}
const who = (names: Map<string, string>, ids: any[]) => (ids || []).map((i) => names.get(String(i))).filter(Boolean).slice(0, 3).join(", ") || "Unassigned";

/** When each finished task became Done, how long it took (in progress to done, and created to done), and whether it was on time. */
function analyseDone(tasks: any[], events: any[]) {
  const ev = new Map<string, any[]>();
  for (const e of events) { const k = String(e.taskId); (ev.get(k) || ev.set(k, []).get(k)!).push(e); }
  return tasks.map((t) => {
    const list = ev.get(String(t._id)) || [];
    const doneEv = [...list].reverse().find((e) => e.to === "Done");
    const doneAt = doneEv ? +new Date(doneEv.at) : +new Date(t.updatedAt);
    const startEv = list.find((e) => e.to === "In Progress" && +new Date(e.at) <= doneAt);
    return {
      assignees: (t.assigneeIds || []).map(String) as string[], doneAt,
      cycle: startEv ? Math.max(0, (doneAt - +new Date(startEv.at)) / DAY) : null,
      lead: Math.max(0, (doneAt - +new Date(t.createdAt)) / DAY),
      onTime: t.dueDate ? doneAt <= new Date(t.dueDate).getTime() + DAY - 1 : null,
    };
  });
}

const statusData = (rows: any[]) => {
  const order = ["Backlog", "Todo", "In Progress", "In Review", "Done"];
  return [...rows].sort((a, b) => (order.indexOf(a._id) + 1 || 99) - (order.indexOf(b._id) + 1 || 99)).map((r, i) => ({ name: r._id || "Unknown", value: r.count, color: STATUS_COL[r._id] || PAL[i % PAL.length] }));
};

/* ================================== overview ================================== */

async function overview(s: Scope): Promise<SectionDef> {
  const sec = empty("overview", "Overview");
  const rg = inR(s), pv = inPrev(s);
  const running = s.projects.filter((p) => !FINISHED.test(p.status || ""));

  if (s.canTasks || s.canBugs) {
    const [created, createdPrev, done, donePrev, overdue, total, doneTotal, cDaily, dDaily, byStatus, byPrio, byProject]: any[] = await Promise.all([
      Task.countDocuments(tf(s, { createdAt: rg })), Task.countDocuments(tf(s, { createdAt: pv })),
      Task.countDocuments(tf(s, { status: "Done", updatedAt: rg })), Task.countDocuments(tf(s, { status: "Done", updatedAt: pv })),
      Task.countDocuments(tf(s, { status: { $ne: "Done" }, dueDate: { $lt: s.todayUtc } })),
      Task.countDocuments(s.taskFilter), Task.countDocuments(tf(s, { status: "Done" })),
      Task.aggregate([{ $match: tf(s, { createdAt: rg }) }, { $group: { _id: dayKeyExpr("createdAt", s.tz), count: { $sum: 1 } } }]),
      Task.aggregate([{ $match: tf(s, { status: "Done", updatedAt: rg }) }, { $group: { _id: dayKeyExpr("updatedAt", s.tz), count: { $sum: 1 } } }]),
      Task.aggregate([{ $match: s.taskFilter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Task.aggregate([{ $match: tf(s, { status: { $ne: "Done" } }) }, { $group: { _id: "$priority", count: { $sum: 1 } } }]),
      Task.aggregate([{ $match: tf(s, { projectId: { $exists: true } }) }, { $group: { _id: "$projectId", total: { $sum: 1 }, done: sumIf({ $eq: ["$status", "Done"] }) } }, { $sort: { total: -1 } }, { $limit: 8 }]),
    ]);

    sec.kpis.push(
      { label: "Tasks created", value: String(created), sub: delta(created, createdPrev, s.range.days), tone: "info" },
      { label: "Tasks completed", value: String(done), sub: delta(done, donePrev, s.range.days), tone: "good" },
      { label: "Overdue now", value: String(overdue), sub: overdue ? "Open tasks past their due date" : "Nothing is late", tone: overdue ? "bad" : "good" },
      { label: "Completion rate", value: `${pc(doneTotal, total)}%`, sub: `${doneTotal} of ${total} tasks are done` },
    );
    if (s.canProjects) sec.kpis.push({ label: "Active projects", value: String(running.length), sub: `of ${s.projects.length} projects` });
    if (s.canBugs) sec.kpis.push({ label: "Open bugs", value: String(await Task.countDocuments(tf(s, { type: "Bug", status: { $ne: "Done" } }))), tone: "warn" });

    const t = trend(s, dMap(cDaily), dMap(dDaily));
    sec.charts.push({ id: "flow", title: "Created vs completed", type: "line", note: `Tasks per ${t.unit}`, x: t.x, series: [{ name: "Created", color: "#3B82F6", values: t.vals[0] }, { name: "Completed", color: "#10B981", values: t.vals[1] }] });
    sec.charts.push({ id: "status", title: "Tasks by status (now)", type: "donut", data: statusData(byStatus) });
    sec.charts.push({ id: "prio", title: "Open tasks by priority", type: "donut", data: byPrio.map((r: any, i: number) => ({ name: r._id || "None", value: r.count, color: PRIO_COL[r._id] || PAL[i % PAL.length] })) });
    if (byProject.length) {
      sec.charts.push({
        id: "byproj", title: "Done and open by project", type: "hstacked", note: "Biggest projects",
        x: byProject.map((r: any) => s.pn.get(String(r._id)) || "Project"),
        series: [{ name: "Done", color: "#10B981", values: byProject.map((r: any) => r.done) }, { name: "Open", color: "#3B82F6", values: byProject.map((r: any) => r.total - r.done) }],
      });
    }
  }

  if (s.canTime) {
    const [a, b]: any[] = await Promise.all([
      TimeEntry.aggregate([{ $match: timeF(s, inR(s)) }, { $group: { _id: null, m: { $sum: "$minutes" } } }]),
      TimeEntry.aggregate([{ $match: timeF(s, inPrev(s)) }, { $group: { _id: null, m: { $sum: "$minutes" } } }]),
    ]);
    const cur = a[0]?.m || 0;
    sec.kpis.push({ label: "Hours logged", value: fmtDur(cur), sub: delta(cur, b[0]?.m || 0, s.range.days), tone: "info" });
  }
  if (s.canMeet && !s.projectId) {
    const ms: any[] = await Meeting.find({ workspaceId: s.wid, createdAt: inR(s) }).select("_id").limit(3000).lean();
    const joins = ms.length ? await MeetingJoin.countDocuments({ meetingId: { $in: ms.map((m) => m._id) } }) : 0;
    sec.kpis.push({ label: "Meetings", value: String(ms.length), sub: `${joins} joins` });
  }
  sec.notes.push("Completed is counted on the day a task was last set to Done. Figures cover only the projects and tasks you are allowed to see.");
  return sec;
}

/* ================================== projects ================================== */

async function projectsSection(s: Scope): Promise<SectionDef> {
  const sec = empty("projects", "Projects");
  const tasksOn = s.canTasks || s.canBugs;
  const [agg, time]: any[] = await Promise.all([
    tasksOn && s.ids.length
      ? Task.aggregate([
          { $match: tf(s, { projectId: { $in: s.ids } }) },
          { $group: { _id: "$projectId", total: { $sum: 1 }, done: sumIf({ $eq: ["$status", "Done"] }), overdue: sumIf(overdueExpr(s)), bugs: sumIf({ $and: [{ $eq: ["$type", "Bug"] }, { $ne: ["$status", "Done"] }] }) } },
        ])
      : [],
    s.canTime && s.ids.length ? TimeEntry.aggregate([{ $match: timeF(s, inR(s)) }, { $group: { _id: "$projectId", m: { $sum: "$minutes" } } }]) : [],
  ]);
  const A = new Map<string, any>(agg.map((x: any) => [String(x._id), x]));
  const T = new Map<string, number>(time.map((x: any) => [String(x._id), x.m]));
  const now = Date.now();

  const rows = s.projects.map((p) => {
    const a = A.get(String(p._id));
    const total = a?.total || 0, done = a?.done || 0;
    return {
      name: p.name, status: p.status || "—", progress: pc(done, total), total, done, open: total - done, overdue: a?.overdue || 0, bugs: a?.bugs || 0,
      logged: T.get(String(p._id)) || 0, end: p.endDate || null, left: p.endDate ? Math.ceil((+new Date(p.endDate) - now) / DAY) : null, finished: FINISHED.test(p.status || ""),
    };
  }).sort((x, y) => y.overdue - x.overdue || x.progress - y.progress).slice(0, 60);
  const running = rows.filter((r) => !r.finished);

  sec.kpis.push(
    { label: "Projects", value: String(rows.length) },
    { label: "Running", value: String(running.length), tone: "info" },
    { label: "Completed", value: String(rows.filter((r) => DONE_P.test(r.status)).length), tone: "good" },
    { label: "Past their deadline", value: String(running.filter((r) => r.left != null && r.left < 0).length), tone: running.some((r) => r.left != null && r.left < 0) ? "bad" : "good" },
    { label: "Average progress", value: `${running.length ? Math.round(running.reduce((t, r) => t + r.progress, 0) / running.length) : 0}%`, sub: "Running projects" },
  );

  const top = running.slice(0, 8);
  sec.charts.push({ id: "progress", title: "Progress by project", type: "hbar", unit: "%", data: [...running].sort((a, b) => b.progress - a.progress).slice(0, 8).map((r, i) => ({ name: r.name, value: r.progress, color: PAL[i % PAL.length] })) });
  sec.charts.push({ id: "opendone", title: "Done and open tasks", type: "hstacked", x: top.map((r) => r.name), series: [{ name: "Done", color: "#10B981", values: top.map((r) => r.done) }, { name: "Open", color: "#3B82F6", values: top.map((r) => r.open) }] });
  const late = rows.filter((r) => r.overdue).slice(0, 8);
  sec.charts.push({ id: "late", title: "Overdue tasks by project", type: "hbar", data: late.map((r) => ({ name: r.name, value: r.overdue, color: "#EF4444" })) });
  const st = new Map<string, number>();
  rows.forEach((r) => st.set(r.status, (st.get(r.status) || 0) + 1));
  sec.charts.push({ id: "pstatus", title: "Projects by status", type: "donut", data: [...st.entries()].map(([name, value], i) => ({ name, value, color: PAL[i % PAL.length] })) });

  sec.tables.push({
    id: "projects", title: "All projects", note: "Sorted by overdue tasks, then by lowest progress.",
    columns: [
      { key: "name", label: "Project", fmt: "text", w: 3 }, { key: "status", label: "Status", fmt: "text", w: 1.4 }, { key: "progress", label: "Progress", fmt: "pct" },
      { key: "total", label: "Tasks", fmt: "int" }, { key: "done", label: "Done", fmt: "int" }, { key: "open", label: "Open", fmt: "int" }, { key: "overdue", label: "Overdue", fmt: "int" },
      ...(s.canBugs ? [{ key: "bugs", label: "Open bugs", fmt: "int" as const }] : []),
      ...(s.canTime ? [{ key: "logged", label: "Logged", fmt: "dur" as const }] : []),
      { key: "end", label: "Deadline", fmt: "date", w: 1.4 }, { key: "left", label: "Days left", fmt: "int" },
    ],
    rows,
  });
  return sec;
}

/* =================================== tasks =================================== */

async function tasksSection(s: Scope): Promise<SectionDef> {
  const sec = empty("tasks", "Tasks");
  const rg = inR(s), pv = inPrev(s);
  const [total, doneAll, created, createdPrev, doneN, doneNPrev, openList, doneTasks, byStatus, dDaily]: any[] = await Promise.all([
    Task.countDocuments(s.taskFilter), Task.countDocuments(tf(s, { status: "Done" })),
    Task.countDocuments(tf(s, { createdAt: rg })), Task.countDocuments(tf(s, { createdAt: pv })),
    Task.countDocuments(tf(s, { status: "Done", updatedAt: rg })), Task.countDocuments(tf(s, { status: "Done", updatedAt: pv })),
    Task.find(tf(s, { status: { $ne: "Done" } })).select("title taskNumber priority type projectId assigneeIds dueDate createdAt").limit(5000).lean(),
    Task.find(tf(s, { status: "Done", updatedAt: rg })).sort({ updatedAt: -1 }).limit(1500).select("dueDate updatedAt createdAt assigneeIds").lean(),
    Task.aggregate([{ $match: s.taskFilter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: tf(s, { status: "Done", updatedAt: rg }) }, { $group: { _id: dayKeyExpr("updatedAt", s.tz), count: { $sum: 1 } } }]),
  ]);
  const events: any[] = doneTasks.length ? await TaskStatusEvent.find({ taskId: { $in: doneTasks.map((t: any) => t._id) } }).sort({ at: 1 }).select("taskId to at").lean() : [];
  const an = analyseDone(doneTasks, events);

  const nowMs = s.todayUtc.getTime();
  const open = openList as any[];
  const lateDays = (t: any) => (t.dueDate ? Math.floor((nowMs - new Date(t.dueDate).getTime()) / DAY) : null);
  const overdue = open.filter((t) => (lateDays(t) ?? 0) >= 1);

  const due = { Overdue: 0, Today: 0, "1-3 days": 0, "4-7 days": 0, "8-14 days": 0, Later: 0, "No date": 0 } as Record<string, number>;
  const age = { "Under 1 week": 0, "1-2 weeks": 0, "2-4 weeks": 0, "1-2 months": 0, "Over 2 months": 0 } as Record<string, number>;
  const prio = new Map<string, number>(), types = new Map<string, number>(), lateByProject = new Map<string, number>();
  for (const t of open) {
    const l = lateDays(t);
    if (l == null) due["No date"]++;
    else if (l >= 1) due.Overdue++;
    else { const u = -l; if (u === 0) due.Today++; else if (u <= 3) due["1-3 days"]++; else if (u <= 7) due["4-7 days"]++; else if (u <= 14) due["8-14 days"]++; else due.Later++; }
    const a = (Date.now() - +new Date(t.createdAt)) / DAY;
    age[a < 8 ? "Under 1 week" : a < 15 ? "1-2 weeks" : a < 31 ? "2-4 weeks" : a < 61 ? "1-2 months" : "Over 2 months"]++;
    prio.set(t.priority || "None", (prio.get(t.priority || "None") || 0) + 1);
    types.set(t.type || "Task", (types.get(t.type || "Task") || 0) + 1);
    if ((l ?? 0) >= 1 && t.projectId) lateByProject.set(String(t.projectId), (lateByProject.get(String(t.projectId)) || 0) + 1);
  }
  const lead = an.map((x) => x.lead), cyc = an.filter((x) => x.cycle != null).map((x) => x.cycle as number);
  const dated = an.filter((x) => x.onTime != null);
  const onTime = dated.filter((x) => x.onTime).length;

  sec.kpis.push(
    { label: "Open tasks", value: String(total - doneAll), sub: `${open.filter((t) => !(t.assigneeIds || []).length).length} not assigned to anyone` },
    { label: "Created", value: String(created), sub: delta(created, createdPrev, s.range.days), tone: "info" },
    { label: "Completed", value: String(doneN), sub: delta(doneN, doneNPrev, s.range.days), tone: "good" },
    { label: "Overdue now", value: String(overdue.length), tone: overdue.length ? "bad" : "good" },
    { label: "Finished on time", value: dated.length ? `${pc(onTime, dated.length)}%` : "—", sub: dated.length ? `${dated.length} tasks had a due date` : "No finished task had a due date" },
    { label: "Median lead time", value: lead.length ? `${r1(med(lead) as number)}d` : "—", sub: "Created to done" },
    { label: "Average cycle time", value: cyc.length ? `${r1(avg(cyc) as number)}d` : "—", sub: cyc.length ? "In progress to done" : "Needs tasks that went through In Progress" },
  );

  const t = trend(s, dMap(dDaily));
  sec.charts.push({ id: "throughput", title: "Throughput", type: "line", note: `Tasks completed per ${t.unit}`, x: t.x, series: [{ name: "Completed", color: "#10B981", values: t.vals[0] }] });
  sec.charts.push({ id: "status", title: "Tasks by status (now)", type: "donut", data: statusData(byStatus) });
  sec.charts.push({ id: "due", title: "Open tasks by due date", type: "bar", data: Object.entries(due).map(([name, value]) => ({ name, value, color: name === "Overdue" ? "#EF4444" : name === "Today" ? "#F59E0B" : name === "No date" ? "#CBD5E1" : "#3B82F6" })) });
  sec.charts.push({ id: "age", title: "How old are the open tasks", type: "bar", data: Object.entries(age).map(([name, value], i) => ({ name, value, color: ["#10B981", "#84CC16", "#F59E0B", "#F97316", "#EF4444"][i] })) });
  const lb = [["Within 1 day", 1], ["2-3 days", 3], ["4-7 days", 7], ["8-14 days", 14], ["15-30 days", 30], ["Over 30 days", 1e9]] as const;
  sec.charts.push({ id: "lead", title: "Lead time of finished tasks", type: "bar", note: "Days from created to done", data: lb.map(([name, max], i) => ({ name, value: lead.filter((d) => d <= max && d > (i ? lb[i - 1][1] : -1)).length, color: PAL[i % PAL.length] })) });
  sec.charts.push({ id: "prio", title: "Open tasks by priority", type: "donut", data: [...prio.entries()].map(([name, value], i) => ({ name, value, color: PRIO_COL[name] || PAL[i % PAL.length] })) });
  sec.charts.push({ id: "latep", title: "Overdue tasks by project", type: "hbar", data: [...lateByProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, value]) => ({ name: s.pn.get(id) || "Project", value, color: "#EF4444" })) });
  sec.charts.push({ id: "type", title: "Open tasks by type", type: "donut", data: [...types.entries()].map(([name, value], i) => ({ name, value, color: PAL[i % PAL.length] })) });

  const worst = [...overdue].sort((a, b) => (lateDays(b) || 0) - (lateDays(a) || 0)).slice(0, 15);
  const oldest = [...open].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).slice(0, 10);
  const names = await nameMap([...worst, ...oldest].flatMap((x) => x.assigneeIds || []));
  const row = (x: any) => ({ num: `TASK-${x.taskNumber}`, title: x.title, project: s.pn.get(String(x.projectId)) || "No project", who: who(names, x.assigneeIds), prio: x.priority || "—", due: x.dueDate || null, late: lateDays(x), age: Math.floor((Date.now() - +new Date(x.createdAt)) / DAY) });
  const cols = (extra: any[]) => [{ key: "num", label: "Task", fmt: "text" as const }, { key: "title", label: "Title", fmt: "text" as const, w: 4 }, { key: "project", label: "Project", fmt: "text" as const, w: 2 }, { key: "who", label: "Assigned to", fmt: "text" as const, w: 2 }, { key: "prio", label: "Priority", fmt: "text" as const }, ...extra];
  sec.tables.push({ id: "overdue", title: "Most overdue tasks", columns: cols([{ key: "due", label: "Due", fmt: "date" }, { key: "late", label: "Days late", fmt: "int" }]), rows: worst.map(row) });
  sec.tables.push({ id: "oldest", title: "Oldest open tasks", columns: cols([{ key: "age", label: "Age (days)", fmt: "int" }]), rows: oldest.map(row) });
  if (total - doneAll > 5000) sec.notes.push("Charts that group open tasks use the 5,000 newest open tasks.");
  if (doneN > 1500) sec.notes.push("Lead time, cycle time and on-time use the 1,500 most recently finished tasks.");
  return sec;
}

/* =================================== bugs =================================== */

async function bugsSection(s: Scope): Promise<SectionDef> {
  const sec = empty("bugs", "Bugs");
  if (!s.canBugs) return sec;
  const rg = inR(s), pv = inPrev(s);
  const b = (...e: any[]) => tf(s, { type: "Bug" }, ...e);
  const [created, createdPrev, fixed, fixedPrev, openList, fixedList, cDaily, fDaily]: any[] = await Promise.all([
    Task.countDocuments(b({ createdAt: rg })), Task.countDocuments(b({ createdAt: pv })),
    Task.countDocuments(b({ status: "Done", updatedAt: rg })), Task.countDocuments(b({ status: "Done", updatedAt: pv })),
    Task.find(b({ status: { $ne: "Done" } })).select("title taskNumber status projectId assigneeIds createdAt bugDetails").limit(3000).lean(),
    Task.find(b({ status: "Done", updatedAt: rg })).sort({ updatedAt: -1 }).limit(800).select("createdAt updatedAt").lean(),
    Task.aggregate([{ $match: b({ createdAt: rg }) }, { $group: { _id: dayKeyExpr("createdAt", s.tz), count: { $sum: 1 } } }]),
    Task.aggregate([{ $match: b({ status: "Done", updatedAt: rg }) }, { $group: { _id: dayKeyExpr("updatedAt", s.tz), count: { $sum: 1 } } }]),
  ]);
  const open = openList as any[];
  const sev = (x: any) => x.bugDetails?.severity || "Unrated";
  const ageOf = (x: any) => Math.floor((Date.now() - +new Date(x.createdAt)) / DAY);
  const ttf = (fixedList as any[]).map((x) => Math.max(0, (+new Date(x.updatedAt) - +new Date(x.createdAt)) / DAY));
  const bySev = new Map<string, number>(), byProj = new Map<string, number>(), byStatus = new Map<string, number>();
  const ages = { "Under 1 week": 0, "1-2 weeks": 0, "2-4 weeks": 0, "Over 1 month": 0 } as Record<string, number>;
  for (const x of open) {
    bySev.set(sev(x), (bySev.get(sev(x)) || 0) + 1);
    byStatus.set(x.status, (byStatus.get(x.status) || 0) + 1);
    if (x.projectId) byProj.set(String(x.projectId), (byProj.get(String(x.projectId)) || 0) + 1);
    const a = ageOf(x);
    ages[a < 7 ? "Under 1 week" : a < 14 ? "1-2 weeks" : a < 30 ? "2-4 weeks" : "Over 1 month"]++;
  }
  const hot = open.filter((x) => ["Critical", "High"].includes(sev(x)));
  const oldestAge = open.length ? Math.max(...open.map(ageOf)) : 0;

  sec.kpis.push(
    { label: "Open bugs", value: String(open.length), tone: open.length ? "warn" : "good" },
    { label: "Critical and high", value: String(hot.length), sub: "Still open", tone: hot.length ? "bad" : "good" },
    { label: "Reported", value: String(created), sub: delta(created, createdPrev, s.range.days), tone: "info" },
    { label: "Fixed", value: String(fixed), sub: delta(fixed, fixedPrev, s.range.days), tone: "good" },
    { label: "Median time to fix", value: ttf.length ? `${r1(med(ttf) as number)}d` : "—", sub: "Reported to done" },
    { label: "Oldest open bug", value: open.length ? `${oldestAge}d` : "—" },
  );

  const t = trend(s, dMap(cDaily), dMap(fDaily));
  sec.charts.push({ id: "flow", title: "Reported vs fixed", type: "line", note: `Bugs per ${t.unit}`, x: t.x, series: [{ name: "Reported", color: "#EF4444", values: t.vals[0] }, { name: "Fixed", color: "#10B981", values: t.vals[1] }] });
  sec.charts.push({ id: "sev", title: "Open bugs by severity", type: "bar", data: ["Critical", "High", "Medium", "Low", "Unrated"].map((n) => ({ name: n, value: bySev.get(n) || 0, color: SEV_COL[n] })) });
  sec.charts.push({ id: "proj", title: "Open bugs by project", type: "hbar", data: [...byProj.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, value]) => ({ name: s.pn.get(id) || "Project", value, color: "#F97316" })) });
  sec.charts.push({ id: "age", title: "Age of open bugs", type: "bar", data: Object.entries(ages).map(([name, value], i) => ({ name, value, color: ["#10B981", "#F59E0B", "#F97316", "#EF4444"][i] })) });
  sec.charts.push({ id: "status", title: "Open bugs by status", type: "donut", data: [...byStatus.entries()].map(([name, value], i) => ({ name, value, color: STATUS_COL[name] || PAL[i % PAL.length] })) });

  const list = [...hot].sort((a, c) => ageOf(c) - ageOf(a)).slice(0, 15);
  const names = await nameMap(list.flatMap((x) => x.assigneeIds || []));
  sec.tables.push({
    id: "hot", title: "Open critical and high bugs",
    columns: [{ key: "num", label: "Bug", fmt: "text" }, { key: "title", label: "Title", fmt: "text", w: 4 }, { key: "sev", label: "Severity", fmt: "text" }, { key: "project", label: "Project", fmt: "text", w: 2 }, { key: "who", label: "Assigned to", fmt: "text", w: 2 }, { key: "status", label: "Status", fmt: "text" }, { key: "age", label: "Age (days)", fmt: "int" }],
    rows: list.map((x) => ({ num: `TASK-${x.taskNumber}`, title: x.title, sev: sev(x), project: s.pn.get(String(x.projectId)) || "No project", who: who(names, x.assigneeIds), status: x.status, age: ageOf(x) })),
  });
  sec.notes.push("Fixed is counted when a bug is last set to Done.");
  return sec;
}

/* =================================== team =================================== */

async function teamSection(s: Scope): Promise<SectionDef> {
  const sec = empty("team", "Team");
  const rg = inR(s);
  const [members, openAgg, doneTasks, timeAgg]: any[] = await Promise.all([
    WorkspaceMember.find({ workspaceId: s.wid, status: "active" }).select("userId profile.designation").populate("userId", "name").lean(),
    s.canTasks || s.canBugs
      ? Task.aggregate([
          { $match: tf(s, { status: { $ne: "Done" }, assigneeIds: { $exists: true } }) }, { $unwind: "$assigneeIds" },
          { $group: { _id: "$assigneeIds", open: { $sum: 1 }, overdue: sumIf(overdueExpr(s)) } },
        ])
      : [],
    s.canTasks || s.canBugs ? Task.find(tf(s, { status: "Done", updatedAt: rg })).sort({ updatedAt: -1 }).limit(1500).select("dueDate updatedAt createdAt assigneeIds").lean() : [],
    s.canTime && s.ids.length ? TimeEntry.aggregate([{ $match: timeF(s, rg) }, { $group: { _id: "$userId", m: { $sum: "$minutes" } } }]) : [],
  ]);
  const events: any[] = doneTasks.length ? await TaskStatusEvent.find({ taskId: { $in: doneTasks.map((t: any) => t._id) } }).sort({ at: 1 }).select("taskId to at").lean() : [];
  const an = analyseDone(doneTasks, events);

  const O = new Map<string, any>(openAgg.map((x: any) => [String(x._id), x]));
  const T = new Map<string, number>(timeAgg.map((x: any) => [String(x._id), x.m]));
  const D = new Map<string, { n: number; dated: number; ok: number; cyc: number[] }>();
  for (const x of an) for (const u of x.assignees) {
    const d = D.get(u) || { n: 0, dated: 0, ok: 0, cyc: [] };
    d.n++;
    if (x.onTime != null) { d.dated++; if (x.onTime) d.ok++; }
    if (x.cycle != null) d.cyc.push(x.cycle);
    D.set(u, d);
  }

  const rows = (members as any[]).filter((m) => m.userId).map((m) => {
    const id = String(m.userId._id), o = O.get(id), d = D.get(id);
    return {
      name: m.userId.name, role: m.profile?.designation || "", open: o?.open || 0, overdue: o?.overdue || 0, done: d?.n || 0,
      ontime: d && d.dated ? pc(d.ok, d.dated) : null, datedN: d?.dated || 0, cycle: d && d.cyc.length ? r1(avg(d.cyc) as number) : null, logged: T.get(id) || 0,
    };
  }).sort((a, b) => b.done - a.done || b.open - a.open).slice(0, 60);

  const withWork = rows.filter((r) => r.open > 0);
  const totalDone = rows.reduce((t, r) => t + r.done, 0);
  const dated = an.filter((x) => x.onTime != null);
  const busiest = [...rows].sort((a, b) => b.open - a.open)[0];
  sec.kpis.push(
    { label: "People", value: String(rows.length) },
    { label: "People with open work", value: String(withWork.length), sub: rows.length ? `${rows.length - withWork.length} have nothing open` : undefined },
    { label: "Average open per person", value: withWork.length ? String(r1(withWork.reduce((t, r) => t + r.open, 0) / withWork.length)) : "0" },
    { label: "Completed in period", value: String(totalDone), tone: "good" },
    { label: "Team on-time rate", value: dated.length ? `${pc(dated.filter((x) => x.onTime).length, dated.length)}%` : "—" },
    { label: "Most open tasks", value: busiest?.open ? String(busiest.open) : "—", sub: busiest?.open ? busiest.name : undefined },
  );

  const topDone = [...rows].filter((r) => r.done).sort((a, b) => b.done - a.done).slice(0, 8);
  sec.charts.push({ id: "done", title: "Tasks completed", type: "hbar", data: topDone.map((r, i) => ({ name: r.name, value: r.done, color: PAL[i % PAL.length] })) });
  const load = [...withWork].sort((a, b) => b.open - a.open).slice(0, 8);
  sec.charts.push({ id: "load", title: "Open workload", type: "hstacked", x: load.map((r) => r.name), series: [{ name: "Open", color: "#14B8A6", values: load.map((r) => r.open - r.overdue) }, { name: "Overdue", color: "#EF4444", values: load.map((r) => r.overdue) }] });
  sec.charts.push({ id: "ontime", title: "On-time rate", type: "hbar", unit: "%", note: "People with at least 3 finished tasks that had a due date", data: rows.filter((r) => r.datedN >= 3 && r.ontime != null).sort((a, b) => (b.ontime as number) - (a.ontime as number)).slice(0, 8).map((r) => ({ name: r.name, value: r.ontime as number, color: (r.ontime as number) >= 80 ? "#10B981" : (r.ontime as number) >= 50 ? "#F59E0B" : "#EF4444" })) });
  if (s.canTime) sec.charts.push({ id: "hours", title: "Hours logged", type: "hbar", unit: "h", data: [...rows].filter((r) => r.logged).sort((a, b) => b.logged - a.logged).slice(0, 8).map((r, i) => ({ name: r.name, value: r1(r.logged / 60), color: PAL[i % PAL.length] })) });

  sec.tables.push({
    id: "people", title: "Everyone", note: "Sorted by tasks completed.",
    columns: [{ key: "name", label: "Person", fmt: "text", w: 3 }, { key: "role", label: "Role", fmt: "text", w: 2 }, { key: "open", label: "Open", fmt: "int" }, { key: "overdue", label: "Overdue", fmt: "int" }, { key: "done", label: "Completed", fmt: "int" }, { key: "ontime", label: "On time", fmt: "pct" }, { key: "cycle", label: "Avg cycle (days)", fmt: "dec1" }, ...(s.canTime ? [{ key: "logged", label: "Logged", fmt: "dur" as const }] : [])],
    rows,
  });
  sec.notes.push("This shows workload and delivery. Use it for planning and support, not for ranking people. Work is counted for every person a task is assigned to.");
  if (doneTasks.length >= 1500) sec.notes.push("Completed, on-time and cycle time use the 1,500 most recently finished tasks.");
  return sec;
}

/* =================================== time =================================== */

async function timeSection(s: Scope): Promise<SectionDef> {
  const sec = empty("time", "Time");
  if (!s.canTime) return sec;
  const rg = inR(s);
  const f = timeF(s, rg);
  const [daily, byProj, byUser, doneTasks]: any[] = await Promise.all([
    TimeEntry.aggregate([{ $match: f }, { $group: { _id: dayKeyExpr("date", s.tz), count: { $sum: "$minutes" } } }]),
    TimeEntry.aggregate([{ $match: f }, { $group: { _id: "$projectId", m: { $sum: "$minutes" } } }, { $sort: { m: -1 } }]),
    TimeEntry.aggregate([{ $match: f }, { $group: { _id: "$userId", m: { $sum: "$minutes" }, days: { $addToSet: dayKeyExpr("date", s.tz) } } }, { $sort: { m: -1 } }]),
    Task.find(tf(s, { status: "Done", updatedAt: rg, estimatedMinutes: { $gt: 0 } })).sort({ updatedAt: -1 }).limit(400).select("title taskNumber estimatedMinutes projectId").lean(),
  ]);
  const total = byProj.reduce((t: number, x: any) => t + x.m, 0);
  const days = (daily as any[]).filter((d) => d.count > 0).length;
  const names = await nameMap(byUser.map((x: any) => x._id));

  // estimate against the time that was really logged on the same tasks
  const logged: any[] = doneTasks.length ? await TimeEntry.aggregate([{ $match: { workspaceId: s.wid, taskId: { $in: doneTasks.map((t: any) => t._id) } } }, { $group: { _id: "$taskId", m: { $sum: "$minutes" } } }]) : [];
  const L = new Map<string, number>(logged.map((x) => [String(x._id), x.m]));
  const acc = (doneTasks as any[]).filter((t) => (L.get(String(t._id)) || 0) > 0).map((t) => ({ t, est: t.estimatedMinutes as number, act: L.get(String(t._id)) as number, ratio: (L.get(String(t._id)) as number) / t.estimatedMinutes }));
  const within = acc.filter((x) => x.ratio >= 0.75 && x.ratio <= 1.25).length;
  const longer = acc.filter((x) => x.ratio > 1.25).length;

  sec.kpis.push(
    { label: "Time logged", value: fmtDur(total), tone: "info" },
    { label: "Average per working day", value: days ? fmtDur(total / days) : "—", sub: `${days} days had time logged` },
    { label: "People logging time", value: String(byUser.length) },
    { label: "Projects with time", value: String(byProj.length) },
    { label: "Estimates within ±25%", value: acc.length >= 3 ? `${pc(within, acc.length)}%` : "—", sub: acc.length >= 3 ? `${acc.length} finished tasks compared` : "Needs 3 finished tasks with an estimate and logged time" },
  );

  const t = trend(s, new Map<string, number>((daily as any[]).map((d) => [d._id, Math.round((d.count / 60) * 10) / 10])));
  sec.charts.push({ id: "perday", title: "Hours logged", type: "line", unit: "h", note: `Hours per ${t.unit}`, x: t.x, series: [{ name: "Hours", color: "#14B8A6", values: t.vals[0] }] });
  sec.charts.push({ id: "byproj", title: "Hours by project", type: "hbar", unit: "h", data: byProj.slice(0, 8).map((x: any, i: number) => ({ name: s.pn.get(String(x._id)) || "Project", value: r1(x.m / 60), color: PAL[i % PAL.length] })) });
  sec.charts.push({ id: "byuser", title: "Hours by person", type: "hbar", unit: "h", data: byUser.slice(0, 8).map((x: any, i: number) => ({ name: names.get(String(x._id)) || "Unknown", value: r1(x.m / 60), color: PAL[i % PAL.length] })) });
  if (acc.length >= 3) sec.charts.push({ id: "acc", title: "Estimate accuracy", type: "donut", data: [{ name: "Within ±25%", value: within, color: "#10B981" }, { name: "Took longer", value: longer, color: "#EF4444" }, { name: "Faster than estimated", value: acc.length - within - longer, color: "#3B82F6" }] });

  sec.tables.push({ id: "people", title: "Time by person", columns: [{ key: "name", label: "Person", fmt: "text", w: 3 }, { key: "m", label: "Logged", fmt: "dur" }, { key: "days", label: "Days with time", fmt: "int" }, { key: "avg", label: "Average per day", fmt: "dur" }], rows: byUser.slice(0, 60).map((x: any) => ({ name: names.get(String(x._id)) || "Unknown", m: x.m, days: x.days.length, avg: x.days.length ? x.m / x.days.length : 0 })) });
  sec.tables.push({ id: "projects", title: "Time by project", columns: [{ key: "name", label: "Project", fmt: "text", w: 3 }, { key: "m", label: "Logged", fmt: "dur" }, { key: "share", label: "Share of all time", fmt: "pct" }], rows: byProj.slice(0, 60).map((x: any) => ({ name: s.pn.get(String(x._id)) || "Project", m: x.m, share: pc(x.m, total) })) });
  sec.tables.push({
    id: "over", title: "Finished tasks that took longer than estimated", note: "Time logged on the task compared with its estimate.",
    columns: [{ key: "num", label: "Task", fmt: "text" }, { key: "title", label: "Title", fmt: "text", w: 4 }, { key: "project", label: "Project", fmt: "text", w: 2 }, { key: "est", label: "Estimate", fmt: "dur" }, { key: "act", label: "Logged", fmt: "dur" }, { key: "ratio", label: "Times the estimate", fmt: "dec1" }],
    rows: acc.filter((x) => x.ratio > 1.25).sort((a, b) => b.ratio - a.ratio).slice(0, 10).map((x) => ({ num: `TASK-${x.t.taskNumber}`, title: x.t.title, project: s.pn.get(String(x.t.projectId)) || "No project", est: x.est, act: x.act, ratio: x.ratio })),
  });
  return sec;
}

/* ================================= attendance ================================= */

async function attendanceSection(s: Scope): Promise<SectionDef> {
  const sec = empty("attendance", "Attendance");
  const settings = await getSettings(s.workspaceId, s.uid);
  const people = await trackedPeople(s.workspaceId);
  if (people.length > 500) throw ApiError.badRequest("Too many people for one attendance report. Choose a shorter range.");
  const ctx = await buildContext(settings, s.workspaceId, s.range.from, s.range.to, people.map((p) => p.userId));
  const end = s.range.to > ctx.today ? ctx.today : s.range.to;
  const dates = s.range.from <= end ? eachDay(s.range.from, end, 400) : [];

  const present = new Map<string, number>();
  const lateDow = [0, 0, 0, 0, 0, 0, 0];
  const spread = [0, 0, 0, 0, 0];
  const rows = people.map((p) => {
    const start = personStart(ctx, p.joinedAt);
    const days = dates.map((d) => dayInfo(ctx, p.userId, d, start));
    for (const d of days) {
      if (["present", "working", "incomplete", "half_day"].includes(d.status)) present.set(d.date, (present.get(d.date) || 0) + 1);
      if (d.late && d.firstIn != null) lateDow[dow(d.date)]++;
    }
    const sm = summarize(days, ctx);
    const rt = rating(sm.score);
    if (rt.stars) spread[rt.stars - 1]++;
    return { name: p.name, present: sm.present, half: sm.halfDays, absent: sm.absent, leave: sm.paidLeave + sm.unpaidLeave, late: sm.late, avgHours: sm.avgMinutes, rate: sm.attendanceRate, punct: sm.punctuality, score: sm.score, stars: rt.stars ? `${rt.stars}/5 ${rt.label}` : "—", workedMinutes: sm.workedMinutes };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const scored = rows.filter((r) => r.rate != null);
  const mean = (f: (r: (typeof rows)[number]) => number) => (scored.length ? Math.round(scored.reduce((t, r) => t + f(r), 0) / scored.length) : null);
  const tracked = new Set(people.map((p) => p.userId));
  const leaveBy = new Map<string, number>();
  for (const [k, marks] of ctx.leaves) {
    const [uid, date] = k.split("|");
    if (!tracked.has(uid) || date < s.range.from || date > end) continue;
    for (const m of marks) leaveBy.set(m.name, (leaveBy.get(m.name) || 0) + (m.half === "none" ? 1 : 0.5));
  }

  const avgScore = mean((r) => r.score ?? 0);
  sec.kpis.push(
    { label: "Average attendance", value: mean((r) => r.rate ?? 0) == null ? "—" : `${mean((r) => r.rate ?? 0)}%`, tone: "good" },
    { label: "Average punctuality", value: mean((r) => r.punct) == null ? "—" : `${mean((r) => r.punct)}%` },
    { label: "Late check-ins", value: String(rows.reduce((t, r) => t + r.late, 0)), tone: "warn" },
    { label: "Absent days", value: String(rows.reduce((t, r) => t + r.absent, 0)), tone: rows.some((r) => r.absent) ? "bad" : "good" },
    { label: "Leave days", value: String(r1(rows.reduce((t, r) => t + r.leave, 0))), tone: "info" },
    { label: "Hours worked", value: `${Math.round(rows.reduce((t, r) => t + r.workedMinutes, 0) / 60)}h`, sub: avgScore != null ? `Average score ${avgScore} of 100` : undefined },
  );

  const t = trend(s, present);
  sec.charts.push({ id: "perday", title: "People present each day", type: "line", note: `Per ${t.unit}`, x: t.x, series: [{ name: "Present", color: "#10B981", values: t.vals[0] }] });
  sec.charts.push({ id: "stars", title: "Star ratings", type: "bar", data: [1, 2, 3, 4, 5].map((n) => ({ name: `${n} star`, value: spread[n - 1], color: ["#DC2626", "#EA580C", "#CA8A04", "#65A30D", "#16A34A"][n - 1] })) });
  sec.charts.push({ id: "low", title: "Lowest attendance", type: "hbar", unit: "%", note: "Eight people with the lowest attendance rate", data: [...scored].sort((a, b) => (a.rate as number) - (b.rate as number)).slice(0, 8).map((r) => ({ name: r.name, value: r.rate as number, color: (r.rate as number) >= 90 ? "#10B981" : (r.rate as number) >= 75 ? "#F59E0B" : "#EF4444" })) });
  sec.charts.push({ id: "latedow", title: "Late check-ins by weekday", type: "bar", data: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, i) => ({ name, value: lateDow[i], color: "#F59E0B" })) });
  sec.charts.push({ id: "leave", title: "Leave by type", type: "donut", data: [...leaveBy.entries()].map(([name, value], i) => ({ name, value: r1(value), color: PAL[i % PAL.length] })) });

  sec.tables.push({
    id: "people", title: "Everyone",
    columns: [{ key: "name", label: "Person", fmt: "text", w: 3 }, { key: "present", label: "Present", fmt: "int" }, { key: "half", label: "Half days", fmt: "int" }, { key: "absent", label: "Absent", fmt: "int" }, { key: "leave", label: "Leave", fmt: "dec1" }, { key: "late", label: "Late", fmt: "int" }, { key: "avgHours", label: "Avg hours", fmt: "dur" }, { key: "rate", label: "Attendance", fmt: "pct" }, { key: "punct", label: "Punctuality", fmt: "pct" }, { key: "score", label: "Score", fmt: "int" }, { key: "stars", label: "Rating", fmt: "text", w: 2 }],
    rows: rows.map(({ workedMinutes, ...r }) => r),
  });
  sec.notes.push("Score = 60% attendance rate + 25% punctuality + 15% hours completed. Approved paid leave and holidays do not lower anyone's rating. Days before tracking started, or before a person joined, are not counted.");
  return sec;
}

export const BUILD: Record<string, (s: Scope) => Promise<SectionDef>> = {
  overview, projects: projectsSection, tasks: tasksSection, bugs: bugsSection, team: teamSection, time: timeSection, attendance: attendanceSection,
};