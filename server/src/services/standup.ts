import mongoose, { Types } from "mongoose";
import { Task } from "../models/Task";
import { TaskStatusEvent } from "../models/TaskStatusEvent";
import { Project } from "../models/Project";
import { User } from "../models/User";
import { TimeEntry, ProjectComment, RiskIssue, TaskDependency } from "../models/ProjectExtras";
import { GithubTaskLink } from "../models/GithubIntegration";
import { StandupNote } from "../models/Standup";
import { uniqueIds } from "./projectEvents";
import { sendMail } from "../utils/mailer";
import { standupDigestEmail } from "../utils/projectEmailTemplates";
import { env } from "../config/env";

const DAY = 864e5;
const STALE_DAYS = 3; // In Progress this long = "stuck"
const REVIEW_DAYS = 2; // In Review this long = "waiting for review"
const SEL = "title taskNumber type status projectId dueDate dependencies bugDetails updatedAt";

const oid = (s: unknown) => new Types.ObjectId(String(s));
const dayOf = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const plus = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysSince = (ms: number, now: number) => Math.max(Math.floor((now - ms) / DAY), 0);

/* ------------------------------ time helpers ------------------------------ */

export const safeTz = (tz?: string) => {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    /* fall through */
  }
  return "UTC";
};

/** Local calendar day (yyyy-mm-dd), weekday ("Mon") and hour (0-23) in a timezone. */
export function localParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(ms);
  const p: Record<string, string> = {};
  parts.forEach((x) => (p[x.type] = x.value));
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hour: Number(p.hour) };
}

/** "Yesterday" = the last 24h, or the last 72h on a Monday (so Friday's work shows up). */
export function standupWindow(tz: string, now: number) {
  const { day, weekday, hour } = localParts(now, tz);
  const hours = weekday === "Mon" ? 72 : 24;
  return { day, weekday, hour, hours, start: now - hours * 3600e3, end: now };
}

/* -------------------------------- types -------------------------------- */

export interface Ref {
  _id: string;
  taskNumber: number;
  title: string;
  type: string;
  status: string;
  projectId?: string;
  projectName?: string;
  dueDate: string | null;
}
export interface Blocker {
  kind: "critical" | "dependency" | "overdue" | "review" | "stale" | "risk";
  task?: Ref;
  text: string;
  days?: number;
}
export interface MemberStandup {
  day: string;
  windowHours: number;
  yesterday: {
    done: Ref[];
    inReview: Ref[];
    started: Ref[];
    timeMinutes: number;
    comments: number;
    commits: { sha: string; title: string; url?: string; taskNumber: number }[];
  };
  today: { dueToday: Ref[]; inProgress: Ref[]; soon: Ref[] };
  blockers: Blocker[];
  counts: { done: number; blockers: number; open: number };
}

const KIND_ORDER: Record<string, number> = { critical: 0, dependency: 1, overdue: 2, review: 3, stale: 4, risk: 5 };

/* ---------------------------- one person's standup ---------------------------- */

export async function buildMemberStandup(o: { workspaceId: string; userId: string; projectId?: string; tz: string; now?: number }): Promise<MemberStandup> {
  const now = o.now ?? Date.now();
  const win = standupWindow(o.tz, now);
  const range = { $gte: new Date(win.start), $lt: new Date(win.end) };
  const scope: any = { workspaceId: o.workspaceId };
  if (o.projectId) scope.projectId = o.projectId;
  const scopeAgg: any = { workspaceId: oid(o.workspaceId) };
  if (o.projectId) scopeAgg.projectId = oid(o.projectId);

  // open tasks assigned to this person
  const open: any[] = await Task.find({ ...scope, assigneeIds: o.userId, parentTaskId: { $exists: false }, status: { $ne: "Done" } }).select(SEL).limit(300).lean();

  // tasks that moved during the window (real events only, never the reconstructed ones)
  const events: any[] = await TaskStatusEvent.find({
    ...scope, at: range, synthetic: { $ne: true }, from: { $ne: null }, to: { $in: ["In Progress", "In Review", "Done"] },
  }).select("taskId to").limit(3000).lean();
  const evIds = [...new Set(events.map((e) => String(e.taskId)))];
  const touched: any[] = evIds.length
    ? await Task.find({ _id: { $in: evIds }, assigneeIds: o.userId, parentTaskId: { $exists: false } }).select(SEL).lean()
    : [];
  // tasks outside any project have no status history: use their last update
  const loose: any[] = o.projectId
    ? []
    : await Task.find({ workspaceId: o.workspaceId, projectId: { $exists: false }, assigneeIds: o.userId, parentTaskId: { $exists: false }, status: "Done", updatedAt: range }).select(SEL).limit(50).lean();

  const rank: Record<string, number> = { "In Progress": 1, "In Review": 2, Done: 3 };
  const best = new Map<string, string>();
  for (const e of events) {
    const id = String(e.taskId);
    if (!best.has(id) || rank[e.to] > rank[best.get(id)!]) best.set(id, e.to);
  }
  const rawDone: any[] = [...loose];
  const rawReview: any[] = [];
  const rawStarted: any[] = [];
  for (const t of touched) {
    const b = best.get(String(t._id));
    if (t.status === "Done" && b === "Done") rawDone.push(t);
    else if (t.status === "In Review" && (b === "In Review" || b === "Done")) rawReview.push(t);
    else if (t.status === "In Progress") rawStarted.push(t);
  }

  // today's lists
  const today = win.day;
  const soonTo = plus(today, 3);
  const rawDueToday = open.filter((t) => dayOf(t.dueDate) === today);
  const used = new Set(rawDueToday.map((t) => String(t._id)));
  const rawInProgress = open.filter((t) => t.status === "In Progress" && !used.has(String(t._id)));
  rawInProgress.forEach((t) => used.add(String(t._id)));
  const rawSoon = open
    .filter((t) => { const k = dayOf(t.dueDate); return !!k && k > today && k <= soonTo && !used.has(String(t._id)); })
    .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate));

  // how long open tasks have sat in their current status
  const aging = open.filter((t) => t.status === "In Progress" || t.status === "In Review");
  const sinceMap = new Map<string, number>();
  if (aging.length) {
    const rows: any[] = await TaskStatusEvent.aggregate([
      { $match: { taskId: { $in: aging.map((t) => t._id) }, to: { $in: ["In Progress", "In Review"] } } },
      { $group: { _id: { t: "$taskId", s: "$to" }, at: { $max: "$at" } } },
    ]);
    rows.forEach((r) => sinceMap.set(`${r._id.t}:${r._id.s}`, +new Date(r.at)));
  }

  // unfinished dependencies of open tasks (both the Task.dependencies list and the project dependency tab)
  const openIds = open.map((t) => t._id);
  const links: any[] = openIds.length ? await TaskDependency.find({ taskId: { $in: openIds } }).select("taskId dependsOnTaskId").lean() : [];
  const depMap = new Map<string, string[]>();
  open.forEach((t) => depMap.set(String(t._id), (t.dependencies || []).map(String)));
  links.forEach((l) => depMap.set(String(l.taskId), [...(depMap.get(String(l.taskId)) || []), String(l.dependsOnTaskId)]));
  const depIds = [...new Set([...depMap.values()].flat())];
  const unfinished: any[] = depIds.length ? await Task.find({ _id: { $in: depIds }, status: { $ne: "Done" } }).select("title taskNumber").lean() : [];
  const unf = new Map(unfinished.map((t) => [String(t._id), t]));

  const risks: any[] = await RiskIssue.find({ ...scope, ownerId: o.userId, status: { $in: ["Open", "Mitigating"] } }).select("title type severity projectId").limit(20).lean();

  // the rest: time, comments, commits
  const relevant = [...openIds, ...touched.map((t) => t._id)];
  const [timeAgg, comments, commitDocs] = await Promise.all([
    TimeEntry.aggregate([{ $match: { ...scopeAgg, userId: oid(o.userId), createdAt: range } }, { $group: { _id: null, minutes: { $sum: "$minutes" } } }]),
    ProjectComment.countDocuments({ ...scope, userId: o.userId, createdAt: range }),
    relevant.length
      ? GithubTaskLink.find({ taskId: { $in: relevant }, type: "commit", updatedAtExt: range }).sort({ updatedAtExt: -1 }).limit(15).lean()
      : Promise.resolve([] as any[]),
  ]);

  // project names for display
  const pids = [...new Set([...open, ...touched, ...loose, ...risks].map((x: any) => x.projectId).filter(Boolean).map(String))];
  const projects: any[] = pids.length ? await Project.find({ _id: { $in: pids } }).select("name").lean() : [];
  const names = new Map<string, string>(projects.map((p) => [String(p._id), p.name]));

  const ref = (t: any): Ref => ({
    _id: String(t._id), taskNumber: t.taskNumber, title: t.title, type: t.type || "Task", status: t.status,
    projectId: t.projectId ? String(t.projectId) : undefined, projectName: t.projectId ? names.get(String(t.projectId)) : undefined,
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
  });
  const taskByNum = new Map<string, any>([...open, ...touched].map((t) => [String(t._id), t]));

  // blockers
  const blockers: Blocker[] = [];
  for (const t of open) {
    const r = ref(t);
    if (t.type === "Bug" && t.bugDetails?.severity === "Critical") blockers.push({ kind: "critical", task: r, text: "Critical bug is still open" });
    const waiting = (depMap.get(String(t._id)) || []).map((id) => unf.get(id)).filter(Boolean);
    if (waiting.length) {
      blockers.push({ kind: "dependency", task: r, text: `Waiting on ${waiting.slice(0, 3).map((w: any) => `TASK-${w.taskNumber} ${w.title}`).join(", ")}` });
    }
    const dk = dayOf(t.dueDate);
    if (dk && dk < today) {
      const d = Math.round((Date.parse(today) - Date.parse(dk)) / DAY);
      blockers.push({ kind: "overdue", task: r, days: d, text: `Overdue by ${d} day${d === 1 ? "" : "s"}` });
    }
    if (t.status === "In Review" || t.status === "In Progress") {
      const since = sinceMap.get(`${t._id}:${t.status}`) ?? +new Date(t.updatedAt);
      const d = daysSince(since, now);
      if (t.status === "In Review" && d >= REVIEW_DAYS) blockers.push({ kind: "review", task: r, days: d, text: `Waiting for review for ${d} days` });
      if (t.status === "In Progress" && d >= STALE_DAYS) blockers.push({ kind: "stale", task: r, days: d, text: `In progress for ${d} days` });
    }
  }
  for (const k of risks) {
    blockers.push({ kind: "risk", text: `${k.type}: ${k.title} (${k.severity})${k.projectId && names.get(String(k.projectId)) ? ` in ${names.get(String(k.projectId))}` : ""}` });
  }
  blockers.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  return {
    day: win.day,
    windowHours: win.hours,
    yesterday: {
      done: rawDone.slice(0, 30).map(ref),
      inReview: rawReview.slice(0, 30).map(ref),
      started: rawStarted.slice(0, 30).map(ref),
      timeMinutes: timeAgg[0]?.minutes || 0,
      comments,
      commits: commitDocs.map((c: any) => ({ sha: String(c.externalId).slice(0, 7), title: c.title || "", url: c.url, taskNumber: taskByNum.get(String(c.taskId))?.taskNumber ?? 0 })),
    },
    today: { dueToday: rawDueToday.slice(0, 20).map(ref), inProgress: rawInProgress.slice(0, 20).map(ref), soon: rawSoon.slice(0, 20).map(ref) },
    blockers: blockers.slice(0, 25),
    counts: { done: rawDone.length, blockers: blockers.length, open: open.length },
  };
}

/* --------------------------------- team view --------------------------------- */

export async function buildTeamStandup(project: any, tz: string, now = Date.now()) {
  const ids = uniqueIds([project.managerId, project.createdBy, ...project.members]).slice(0, 40);
  const users: any[] = await User.find({ _id: { $in: ids }, accountStatus: "active" }).select("name profileImage jobTitle").lean();
  const day = standupWindow(tz, now).day;
  const notes: any[] = await StandupNote.find({ workspaceId: project.workspaceId, userId: { $in: users.map((u) => u._id) }, day }).lean();
  const noteBy = new Map(notes.map((n) => [String(n.userId), n]));

  const members: any[] = [];
  for (let i = 0; i < users.length; i += 5) {
    const part = await Promise.all(
      users.slice(i, i + 5).map(async (u) => {
        const s = await buildMemberStandup({ workspaceId: String(project.workspaceId), userId: String(u._id), projectId: String(project._id), tz, now });
        const n = noteBy.get(String(u._id));
        return { user: { _id: u._id, name: u.name, profileImage: u.profileImage, jobTitle: u.jobTitle }, ...s, note: n ? { plan: n.plan, blockers: n.blockers, away: n.away } : null };
      })
    );
    members.push(...part);
  }
  members.sort((a, b) => b.blockers.length - a.blockers.length || a.user.name.localeCompare(b.user.name));

  return {
    day,
    windowHours: standupWindow(tz, now).hours,
    members,
    summary: {
      members: members.length,
      done: members.reduce((a, m) => a + m.counts.done, 0),
      blockedPeople: members.filter((m) => m.blockers.length > 0).length,
      away: members.filter((m) => m.note?.away).length,
    },
  };
}

/* ----------------------------------- email ----------------------------------- */

const t = (r: Ref) => `TASK-${r.taskNumber} ${r.title}${r.projectName ? ` (${r.projectName})` : ""}`;
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export function digestLines(s: MemberStandup, note?: { plan?: string; blockers?: string; away?: boolean } | null) {
  const y: string[] = [
    ...s.yesterday.done.map((r) => `Finished ${t(r)}`),
    ...s.yesterday.inReview.map((r) => `Sent to review: ${t(r)}`),
    ...s.yesterday.started.map((r) => `Started ${t(r)}`),
  ];
  if (s.yesterday.commits.length) y.push(`${s.yesterday.commits.length} commit${s.yesterday.commits.length === 1 ? "" : "s"} pushed`);
  if (s.yesterday.timeMinutes) y.push(`Logged ${hm(s.yesterday.timeMinutes)}`);
  if (s.yesterday.comments) y.push(`${s.yesterday.comments} discussion message${s.yesterday.comments === 1 ? "" : "s"}`);

  const d = (r: Ref) => (r.dueDate ? new Date(r.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
  const today: string[] = [
    ...s.today.dueToday.map((r) => `Due today: ${t(r)}`),
    ...s.today.inProgress.map((r) => `Working on ${t(r)}`),
    ...s.today.soon.map((r) => `Coming up (${d(r)}): ${t(r)}`),
  ];
  if (note?.plan) today.unshift(`Your note: ${note.plan}`);

  const blockers = s.blockers.map((b) => `${b.task ? t(b.task) + ": " : ""}${b.text}`);
  if (note?.blockers) blockers.unshift(`Your note: ${note.blockers}`);
  return { yesterday: y.slice(0, 14), today: today.slice(0, 14), blockers: blockers.slice(0, 12) };
}

const hasContent = (l: { yesterday: string[]; today: string[]; blockers: string[] }) => l.yesterday.length + l.today.length + l.blockers.length > 0;

/** Builds and sends one person's morning email for one workspace. `force` = they clicked "email me now". */
export async function sendDigest(user: any, workspaceId: string, opts: { force?: boolean } = {}): Promise<{ sent: boolean; reason?: string }> {
  if (!user?.email) return { sent: false, reason: "No email address" };
  if (!env.SMTP_HOST) return { sent: false, reason: "Email is not configured on the server (SMTP settings missing)" };

  const tz = safeTz(user.timezone);
  const s = await buildMemberStandup({ workspaceId, userId: String(user._id), tz });
  const win = standupWindow(tz, Date.now());
  const note: any = await StandupNote.findOne({ workspaceId, userId: user._id, day: win.day }).lean();
  const lines = digestLines(s, note);

  // project leads also get the team's blockers
  const leadProjects: any[] = await Project.find({
    workspaceId, status: { $in: ["Planning", "Active", "On Hold"] },
    $or: [{ managerId: user._id }, { createdBy: user._id }, { memberRoles: { $elemMatch: { userId: user._id, role: "ADMIN" } } }],
  }).limit(5);
  const team: string[] = [];
  for (const p of leadProjects) {
    const ts = await buildTeamStandup(p, tz);
    for (const m of ts.members) {
      if (String(m.user._id) === String(user._id)) continue;
      for (const b of m.blockers.slice(0, 2)) team.push(`${m.user.name}: ${b.task ? t(b.task) + ", " : ""}${b.text}`);
    }
  }

  if (!hasContent(lines) && !team.length && !opts.force) return { sent: false, reason: "Nothing to report" };

  const WorkspaceModel: any = (mongoose.models as any).Workspace; // looked up by name so this file does not depend on the model's path
  const ws = WorkspaceModel ? await WorkspaceModel.findById(workspaceId).select("name").lean() : null;
  const dateLabel = new Date(`${win.day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  const { subject, html } = standupDigestEmail({
    name: user.name, workspaceName: ws?.name || "your workspace", dateLabel, windowHours: s.windowHours,
    yesterday: lines.yesterday, today: lines.today, blockers: lines.blockers, team: team.slice(0, 10),
    away: !!note?.away, url: `${env.CLIENT_URL}/app/${workspaceId}/standup`,
  });
  await sendMail(user.email, subject, html);
  return { sent: true };
}