import { Task } from "../models/Task";
import { TaskStatusEvent } from "../models/TaskStatusEvent";

export const STATUSES = ["Backlog", "Todo", "In Progress", "In Review", "Done"];
export type Unit = "tasks" | "hours";
export type EvMap = Map<string, { from: string | null; to: string; at: number }[]>;

const DAY = 864e5;
const r1 = (n: number) => Math.round(n * 10) / 10;
const ids = (a?: any[]) => (a || []).map(String);
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const localKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** tasks = every task counts 1, hours = estimated hours (tasks without an estimate count 0). */
export const weightFn = (unit: Unit) => (t: any) => (unit === "hours" ? (t?.estimatedMinutes || 0) / 60 : 1);

/* ----------------------------- data loading ----------------------------- */

/**
 * Tasks that existed before history tracking have no events. Reconstruct them once (approximation:
 * created -> Todo/Backlog at createdAt, and current status at updatedAt). New tasks are tracked exactly.
 */
export async function ensureStatusHistory(projectId: any) {
  const tasks: any[] = await Task.find({ projectId, parentTaskId: { $exists: false } }).select("_id workspaceId projectId status createdAt updatedAt").lean();
  if (!tasks.length) return;
  const have = new Set((await TaskStatusEvent.distinct("taskId", { projectId })).map(String));
  const docs: any[] = [];
  for (const t of tasks) {
    if (have.has(String(t._id))) continue;
    const initial = t.status === "Backlog" ? "Backlog" : "Todo";
    const base = { taskId: t._id, projectId: t.projectId, workspaceId: t.workspaceId, synthetic: true };
    docs.push({ ...base, from: null, to: initial, at: t.createdAt });
    if (t.status !== initial) docs.push({ ...base, from: initial, to: t.status, at: +new Date(t.updatedAt) > +new Date(t.createdAt) ? t.updatedAt : t.createdAt });
  }
  if (docs.length) await TaskStatusEvent.insertMany(docs, { ordered: false }).catch(() => undefined);
}

export async function loadTasks(taskIds: string[]) {
  const docs: any[] = taskIds.length ? await Task.find({ _id: { $in: taskIds } }).select("title taskNumber type status estimatedMinutes createdAt").lean() : [];
  return new Map<string, any>(docs.map((t) => [String(t._id), t]));
}

export async function loadEvents(projectId: any, taskIds?: string[]): Promise<EvMap> {
  const filter: any = { projectId };
  if (taskIds) filter.taskId = { $in: taskIds };
  const rows: any[] = await TaskStatusEvent.find(filter).sort({ at: 1 }).select("taskId from to at").lean();
  const m: EvMap = new Map();
  for (const e of rows) {
    const k = String(e.taskId);
    const arr = m.get(k) || [];
    arr.push({ from: e.from ?? null, to: e.to, at: +new Date(e.at) });
    m.set(k, arr);
  }
  return m;
}

/** The status a task had at moment `t` (null = it did not exist yet). */
export function statusAt(evs: EvMap extends Map<string, infer V> ? V | undefined : never, t: number): string | null {
  if (!evs) return null;
  let res: string | null = null;
  for (const e of evs) {
    if (e.at <= t) res = e.to;
    else break;
  }
  return res;
}

/* ------------------------------ sprint scope ------------------------------ */

export function scopeInfo(s: any) {
  const started = s.status !== "Planned";
  let committed = ids(s.committedTaskIds);
  const log = (s.scopeLog || [])
    .map((l: any) => ({ id: String(l.taskId), action: l.action as "add" | "remove", at: +new Date(l.at) }))
    .sort((a: any, b: any) => a.at - b.at);
  let legacy = false;
  // sprint started before snapshots existed: best guess from what we have
  if (started && !committed.length && !log.length) {
    legacy = true;
    committed = s.status === "Completed" ? ids(s.doneTaskIds?.length ? s.doneTaskIds : s.taskIds) : ids(s.taskIds);
  }
  return { legacy, committed, log };
}

export function sprintTaskIds(s: any): string[] {
  return [...new Set([...ids(s.committedTaskIds), ...ids(s.doneTaskIds), ...ids(s.carriedOverTaskIds), ...ids(s.taskIds), ...(s.scopeLog || []).map((l: any) => String(l.taskId))])];
}

export function sprintSummary(s: any, tasks: Map<string, any>, unit: Unit, withLists = false) {
  const w = weightFn(unit);
  const sum = (list: string[]) => list.reduce((a, id) => a + (tasks.has(id) ? w(tasks.get(id)) : 0), 0);
  const { legacy, committed, log } = scopeInfo(s);
  const committedSet = new Set(committed);

  const lastAction = new Map<string, string>();
  const addedAll = new Set<string>();
  for (const l of log) {
    lastAction.set(l.id, l.action);
    if (l.action === "add" && !committedSet.has(l.id)) addedAll.add(l.id);
  }
  const removedSet = new Set([...lastAction].filter(([, a]) => a === "remove").map(([id]) => id));
  const added = [...addedAll].filter((id) => !removedSet.has(id));
  const removed = [...removedSet];
  const scope = [...new Set([...committed, ...added])].filter((id) => !removedSet.has(id));

  const completedSprint = s.status === "Completed";
  const hasSnapshot = completedSprint && ids(s.doneTaskIds).length > 0;
  const done = hasSnapshot ? ids(s.doneTaskIds) : scope.filter((id) => tasks.get(id)?.status === "Done");
  const doneSet = new Set(done);
  const carried = completedSprint ? ids(s.carriedOverTaskIds) : scope.filter((id) => !doneSet.has(id));

  const completedTotal = sum(done);
  const scopeTotal = hasSnapshot ? completedTotal + sum(carried) : sum(scope);
  const legacyDone = legacy && completedSprint;
  const committedTotal: number | null = legacyDone ? (unit === "tasks" ? s.committed || committed.length : null) : sum(committed);
  const denominator = legacyDone ? committedTotal : scopeTotal;
  const doneOfCommitted = legacyDone ? completedTotal : sum(done.filter((id) => committedSet.has(id)));
  const carriedTotal = legacyDone ? (committedTotal == null ? null : Math.max(committedTotal - completedTotal, 0)) : sum(carried);

  const pct = (a: number, b: number | null) => (b ? Math.round((a / b) * 100) : null);
  const row = (id: string) => {
    const t = tasks.get(id);
    return t ? { _id: id, taskNumber: t.taskNumber, title: t.title, type: t.type || "Task", status: t.status, weight: r1(w(t)) } : null;
  };
  const rows = (list: string[]) => list.map(row).filter(Boolean);

  return {
    legacy,
    committed: committedTotal == null ? null : r1(committedTotal),
    added: r1(sum(added)),
    removed: r1(sum(removed)),
    completed: r1(completedTotal),
    carriedOver: carriedTotal == null ? null : r1(carriedTotal),
    scopeTotal: r1(scopeTotal),
    completionRate: pct(completedTotal, denominator),
    commitmentRate: pct(doneOfCommitted, committedTotal),
    scopeIds: scope,
    lists: withLists ? { committed: rows(committed), added: rows(added), removed: rows(removed), completed: rows(done), carriedOver: rows(carried) } : undefined,
  };
}

/* -------------------------------- burndown -------------------------------- */

export function burndown(s: any, tasks: Map<string, any>, evMap: EvMap, unit: Unit, now = Date.now()) {
  if (s.status === "Planned") return [];
  const w = weightFn(unit);
  const { committed, log } = scopeInfo(s);

  const startMs = startOfDay(+new Date(s.startedAt || s.startDate || s.createdAt));
  const plannedEnd = s.endDate ? new Date(s.endDate).setHours(23, 59, 59, 999) : startMs + 14 * DAY - 1;
  const finish = s.status === "Completed" && s.completedAt ? +new Date(s.completedAt) : now;
  const n = Math.min(Math.max(Math.ceil((Math.max(plannedEnd, finish) - startMs) / DAY), 1), 90);
  const idealDays = Math.max(Math.ceil((plannedEnd - startMs) / DAY), 1);

  const cur = new Set(committed);
  const baseline = [...cur].reduce((a, id) => a + (tasks.has(id) ? w(tasks.get(id)) : 0), 0);
  let li = 0;
  const out: { date: string; remaining: number | null; scope: number | null; ideal: number }[] = [];

  for (let i = 0; i <= n; i++) {
    const dayStart = startMs + i * DAY;
    const ideal = r1(Math.max(baseline * (1 - i / idealDays), 0));
    if (dayStart > finish) {
      out.push({ date: localKey(dayStart), remaining: null, scope: null, ideal });
      continue;
    }
    const at = Math.min(dayStart + DAY - 1, finish);
    while (li < log.length && log[li].at <= at) {
      const l = log[li++];
      if (l.action === "add") cur.add(l.id);
      else cur.delete(l.id);
    }
    let remaining = 0;
    let scope = 0;
    for (const id of cur) {
      const t = tasks.get(id);
      if (!t) continue;
      const wt = w(t);
      scope += wt;
      if (statusAt(evMap.get(id), at) !== "Done") remaining += wt;
    }
    out.push({ date: localKey(dayStart), remaining: r1(remaining), scope: r1(scope), ideal });
  }
  return out;
}

/* --------------------------- cumulative flow (CFD) --------------------------- */

export function cumulativeFlow(taskIds: string[], tasks: Map<string, any>, evMap: EvMap, unit: Unit, fromMs: number, toMs: number, now = Date.now()) {
  const w = weightFn(unit);
  const first = startOfDay(fromMs);
  const days = Math.min(Math.max(Math.round((startOfDay(toMs) - first) / DAY), 0), 120);
  const rows: Record<string, number | string>[] = [];
  for (let i = 0; i <= days; i++) {
    const dayStart = first + i * DAY;
    if (dayStart > now) break;
    const at = Math.min(dayStart + DAY - 1, now);
    const row: Record<string, number | string> = { date: localKey(dayStart) };
    STATUSES.forEach((s) => (row[s] = 0));
    for (const id of taskIds) {
      const t = tasks.get(id);
      if (!t) continue;
      const st = statusAt(evMap.get(id), at);
      if (st) row[st] = (row[st] as number) + w(t);
    }
    STATUSES.forEach((s) => (row[s] = r1(row[s] as number)));
    rows.push(row);
  }
  return rows;
}

/* ------------------------------- cycle time ------------------------------- */

const stats = (arr: number[]) => {
  if (!arr.length) return { count: 0, avg: null, median: null, p85: null };
  const s = [...arr].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { count: s.length, avg: r1(s.reduce((a, b) => a + b, 0) / s.length), median: r1(at(0.5)), p85: r1(at(0.85)) };
};

const EDGES = [1, 2, 3, 5, 8, 13];
const LABELS = ["< 1d", "1-2d", "2-3d", "3-5d", "5-8d", "8-13d", "13d +"];

/** cycle = last "In Progress" -> final "Done". lead = created -> final "Done". Only tasks that are Done now. */
export function cycleStats(taskIds: string[], tasks: Map<string, any>, evMap: EvMap, sinceMs?: number) {
  const items: any[] = [];
  const agg: Record<string, { sum: number; n: number }> = {};

  for (const id of taskIds) {
    const t = tasks.get(id);
    if (!t || t.status !== "Done") continue;
    const evs = evMap.get(id) || [];
    let di = -1;
    for (let i = evs.length - 1; i >= 0; i--) if (evs[i].to === "Done") { di = i; break; }
    if (di < 0) continue;
    const doneAt = evs[di].at;
    if (sinceMs && doneAt < sinceMs) continue;

    const created = evs[0]?.at ?? +new Date(t.createdAt);
    let si = -1;
    for (let i = di - 1; i >= 0; i--) if (evs[i].to === "In Progress") { si = i; break; }

    items.push({
      _id: id, taskNumber: t.taskNumber, title: t.title, type: t.type || "Task", doneAt,
      leadDays: r1((doneAt - created) / DAY), cycleDays: si >= 0 ? r1((doneAt - evs[si].at) / DAY) : null,
    });

    const per: Record<string, number> = {};
    for (let i = 0; i < di; i++) {
      if (evs[i].to === "Done") continue;
      per[evs[i].to] = (per[evs[i].to] || 0) + (evs[i + 1].at - evs[i].at) / DAY;
    }
    for (const [st, d] of Object.entries(per)) {
      const a = (agg[st] ||= { sum: 0, n: 0 });
      a.sum += d;
      a.n++;
    }
  }

  const cycles = items.filter((i) => i.cycleDays != null).map((i) => i.cycleDays as number);
  const histogram = LABELS.map((label) => ({ label, count: 0 }));
  for (const c of cycles) {
    let b = EDGES.findIndex((e) => c < e);
    if (b < 0) b = EDGES.length;
    histogram[b].count++;
  }
  const timeInStatus: Record<string, number | null> = {};
  ["Backlog", "Todo", "In Progress", "In Review"].forEach((s) => (timeInStatus[s] = agg[s] ? r1(agg[s].sum / agg[s].n) : null));

  items.sort((a, b) => a.doneAt - b.doneAt);
  return { cycle: stats(cycles), lead: stats(items.map((i) => i.leadDays)), histogram, timeInStatus, items: items.slice(-200) };
}