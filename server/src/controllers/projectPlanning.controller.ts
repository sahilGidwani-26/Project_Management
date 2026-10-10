import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { makeCrud } from "../utils/projectCrud";
import { PReq, fail } from "../utils/projectAccess";
import { Task } from "../models/Task";
import { Milestone, Sprint, TimeEntry, TaskDependency, AutomationRule, RecurringTask } from "../models/ProjectExtras";
import { getName, logActivity, projectRecipients, sendToUsers } from "../services/projectEvents";
import { nextRun } from "../services/projectOps";
import { buildProjectUrl, milestoneEmail, sprintEmail } from "../utils/projectEmailTemplates";

const url = (r: PReq, tab: string) => buildProjectUrl(String(r.project.workspaceId), String(r.project._id), tab);
const actor = (r: PReq) => r.user!.id;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Sirf wahi task ids rakho jo is project ke hain. */
const projectTaskIds = async (r: PReq, list: string[]) =>
  list.length ? (await Task.find({ _id: { $in: list }, projectId: r.project._id }).distinct("_id")).map(String) : [];

/* -------------------------------- Milestones -------------------------------- */

export const milestoneCrud = makeCrud({
  model: Milestone,
  entity: "milestone",
  fields: ["title", "description", "dueDate", "order"],
  sort: { order: 1, createdAt: 1 },
  afterCreate: async (r, doc) => {
    const byName = await getName(actor(r));
    void sendToUsers(projectRecipients(r.project), actor(r), () =>
      milestoneEmail({ kind: "created", projectName: r.project.name, title: doc.title, dueDate: doc.dueDate, byName, url: url(r, "overview") })
    );
  },
  beforeUpdate: (_r, data) => {
    if ("dueDate" in data) {
      data.dueSoonSentAt = null;
      data.overdueSentAt = null;
    }
  },
});

export const listMilestones = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const ms: any[] = await Milestone.find({ projectId: r.project._id }).sort({ order: 1, createdAt: 1 }).lean();
  const all = ms.flatMap((m) => m.taskIds || []);
  const tasks: any[] = await Task.find({ _id: { $in: all } }).select("title status dueDate taskNumber").lean();
  const map = new Map(tasks.map((t) => [String(t._id), t]));
  const out = ms.map((m) => {
    const ts = (m.taskIds || []).map((id: any) => map.get(String(id))).filter(Boolean);
    const done = ts.filter((t: any) => t.status === "Done").length;
    return { ...m, tasks: ts, taskTotal: ts.length, taskDone: done, progress: ts.length ? Math.round((done / ts.length) * 100) : m.status === "Completed" ? 100 : 0 };
  });
  return sendSuccess(res, 200, out, "milestones");
});

export const setMilestoneTasks = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const m = await Milestone.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!m) throw ApiError.notFound("Milestone not found");
  m.taskIds = await projectTaskIds(r, ids(req.body.taskIds));
  await m.save();
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: "milestone_tasks_updated", entity: "milestone", metadata: { title: m.title, count: m.taskIds.length } });
  return sendSuccess(res, 200, m, "Milestone tasks updated");
});

export const toggleMilestone = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const m = await Milestone.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!m) throw ApiError.notFound("Milestone not found");
  const completing = m.status !== "Completed";
  m.status = completing ? "Completed" : "Open";
  m.completedAt = completing ? new Date() : undefined;
  await m.save();
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: completing ? "milestone_completed" : "milestone_reopened", entity: "milestone", metadata: { title: m.title } });
  if (completing) {
    const byName = await getName(req.user!.id);
    void sendToUsers(projectRecipients(r.project), req.user!.id, () =>
      milestoneEmail({ kind: "completed", projectName: r.project.name, title: m.title, dueDate: m.dueDate, byName, url: url(r, "overview") })
    );
  }
  return sendSuccess(res, 200, m, completing ? "Milestone completed" : "Milestone reopened");
});

/* ---------------------------------- Sprints ---------------------------------- */

export const sprintCrud = makeCrud({
  model: Sprint,
  entity: "sprint",
  fields: ["name", "goal", "startDate", "endDate"],
  sort: { createdAt: -1 },
  beforeCreate: (_r, d) => {
    d.status = "Planned";
    d.taskIds = [];
  },
});

export const setSprintTasks = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const sprint = await Sprint.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!sprint) throw ApiError.notFound("Sprint not found");
  if (sprint.status === "Completed") return fail(res, "This sprint is already completed");

  const now = new Date();
  const current = new Set<string>(sprint.taskIds.map(String));
  const add = (await projectTaskIds(r, ids(req.body.add))).filter((id) => !current.has(id));
  const remove = ids(req.body.remove).filter((id) => current.has(id));

  // a task lives in one open sprint: pull it out of the others (and log that for a running sprint)
  if (add.length) {
    const others: any[] = await Sprint.find({ projectId: r.project._id, status: { $ne: "Completed" }, _id: { $ne: sprint._id }, taskIds: { $in: add } });
    for (const o of others) {
      const moved = o.taskIds.map(String).filter((id: string) => add.includes(id));
      o.taskIds = o.taskIds.filter((id: any) => !add.includes(String(id)));
      if (o.status === "Active") moved.forEach((id: string) => o.scopeLog.push({ taskId: id, action: "remove", at: now }));
      await o.save();
    }
  }

  const next = new Set(current);
  add.forEach((i) => next.add(i));
  remove.forEach((i) => next.delete(i));
  sprint.taskIds = [...next];
  if (sprint.status === "Active") {
    // changes after the start are "scope change" in the sprint report
    add.forEach((id) => sprint.scopeLog.push({ taskId: id, action: "add", at: now }));
    remove.forEach((id) => sprint.scopeLog.push({ taskId: id, action: "remove", at: now }));
  }
  await sprint.save();
  if (sprint.status === "Active" && add.length) await Task.updateMany({ _id: { $in: add }, status: "Backlog" }, { status: "Todo" });
  return sendSuccess(res, 200, sprint, "Sprint updated");
});

export const startSprint = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const sprint = await Sprint.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!sprint) throw ApiError.notFound("Sprint not found");
  if (sprint.status !== "Planned") return fail(res, "Only planned sprints can be started");
  if (await Sprint.exists({ projectId: r.project._id, status: "Active" })) return fail(res, "Complete the active sprint before starting another");
  sprint.status = "Active";
  sprint.startedAt = new Date();
  sprint.committed = sprint.taskIds.length;
  sprint.committedTaskIds = [...sprint.taskIds]; // "what we promised", for the sprint report
  sprint.scopeLog = [];
  if (!sprint.startDate) sprint.startDate = new Date();
  await sprint.save();
  await Task.updateMany({ _id: { $in: sprint.taskIds }, status: "Backlog" }, { status: "Todo" });
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: "sprint_started", entity: "sprint", metadata: { title: sprint.name } });
  const byName = await getName(req.user!.id);
  void sendToUsers(projectRecipients(r.project), req.user!.id, () =>
    sprintEmail({ kind: "started", projectName: r.project.name, name: sprint.name, goal: sprint.goal, endDate: sprint.endDate, byName, url: url(r, "sprints") })
  );
  return sendSuccess(res, 200, sprint, "Sprint started");
});

export const completeSprint = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const sprint = await Sprint.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!sprint) throw ApiError.notFound("Sprint not found");
  if (sprint.status !== "Active") return fail(res, "Only the active sprint can be completed");
  const tasks: any[] = await Task.find({ _id: { $in: sprint.taskIds } }).select("status").lean();
  const done = tasks.filter((t) => t.status === "Done").map((t) => t._id);
  const open = tasks.filter((t) => t.status !== "Done").map((t) => t._id);
  const total = sprint.taskIds.length;

  const target = req.body.moveTo && req.body.moveTo !== "backlog"
    ? await Sprint.findOne({ _id: req.body.moveTo, projectId: r.project._id, status: "Planned" })
    : null;
  if (target) {
    target.taskIds = [...new Set([...target.taskIds.map(String), ...open.map(String)])];
    await target.save();
  }
  sprint.doneTaskIds = done; // snapshots for the sprint report
  sprint.carriedOverTaskIds = open;
  sprint.taskIds = done;
  sprint.status = "Completed";
  sprint.completedAt = new Date();
  sprint.velocity = done.length;
  await sprint.save();

  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: "sprint_completed", entity: "sprint", metadata: { title: sprint.name, done: done.length, total, carriedOver: open.length } });
  const byName = await getName(req.user!.id);
  void sendToUsers(projectRecipients(r.project), req.user!.id, () =>
    sprintEmail({ kind: "completed", projectName: r.project.name, name: sprint.name, goal: sprint.goal, done: done.length, total, carried: open.length, byName, url: url(r, "sprint-reports") })
  );
  return sendSuccess(res, 200, sprint, "Sprint completed");
});

/* ------------------------------- Dependencies ------------------------------- */

export const listDependencies = catchAsync(async (req: Request, res: Response) =>
  sendSuccess(res, 200, await TaskDependency.find({ projectId: (req as PReq).project._id }).lean(), "dependencies")
);

export const addDependency = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const { taskId, dependsOnTaskId } = req.body;
  if (!taskId || !dependsOnTaskId || String(taskId) === String(dependsOnTaskId)) return fail(res, "Pick two different tasks");
  if ((await projectTaskIds(r, [taskId, dependsOnTaskId])).length !== 2) return fail(res, "Both tasks must belong to this project");

  // circular dependency check
  const deps: any[] = await TaskDependency.find({ projectId: r.project._id }).lean();
  const graph = new Map<string, string[]>();
  deps.forEach((d) => graph.set(String(d.taskId), [...(graph.get(String(d.taskId)) || []), String(d.dependsOnTaskId)]));
  const seen = new Set<string>();
  const stack = [String(dependsOnTaskId)];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === String(taskId)) return fail(res, "That would create a circular dependency");
    if (seen.has(x)) continue;
    seen.add(x);
    stack.push(...(graph.get(x) || []));
  }
  const dep = await TaskDependency.findOneAndUpdate(
    { taskId, dependsOnTaskId },
    { $setOnInsert: { projectId: r.project._id, workspaceId: r.project.workspaceId, createdBy: req.user!.id } },
    { upsert: true, new: true }
  );
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: "dependency_added", entity: "dependency" });
  return sendSuccess(res, 201, dep, "Dependency added");
});

export const removeDependency = catchAsync(async (req: Request, res: Response) => {
  await TaskDependency.deleteOne({ _id: req.params.itemId, projectId: (req as PReq).project._id });
  return sendSuccess(res, 200, null, "Dependency removed");
});

/* ------------------------------- Time tracking ------------------------------- */

export const timeCrud = makeCrud({
  model: TimeEntry,
  entity: "time_entry",
  fields: ["taskId", "minutes", "note", "date", "billable"],
  sort: { date: -1, createdAt: -1 },
  ownerField: "userId",
  populate: [{ path: "userId", select: "name profileImage" }, { path: "taskId", select: "title taskNumber" }],
  beforeCreate: async (r, d) => {
    d.userId = d.createdBy;
    d.minutes = Math.round(Number(d.minutes));
    if (d.taskId && !(await Task.exists({ _id: d.taskId, projectId: r.project._id }))) d.taskId = undefined;
  },
  afterCreate: async (_r, doc) => {
    if (doc.taskId) await Task.updateOne({ _id: doc.taskId }, { $inc: { actualMinutes: doc.minutes } });
  },
  afterDelete: async (_r, doc) => {
    if (doc.taskId) await Task.updateOne({ _id: doc.taskId }, { $inc: { actualMinutes: -doc.minutes } });
  },
});

/* ---------------------------- Automation & recurring ---------------------------- */

export const ruleCrud = makeCrud({
  model: AutomationRule,
  entity: "automation_rule",
  fields: ["name", "active", "triggerType", "triggerStatus", "actionType", "actionValue"],
});

export const recurringCrud = makeCrud({
  model: RecurringTask,
  entity: "recurring_task",
  fields: ["title", "description", "priority", "assigneeIds", "labels", "frequency", "dayOfWeek", "dayOfMonth", "dueInDays", "active"],
  populate: { path: "assigneeIds", select: "name profileImage" },
  beforeCreate: (_r, d) => {
    d.nextRunAt = nextRun(d, new Date());
  },
  beforeUpdate: (_r, d, doc) => {
    if (["frequency", "dayOfWeek", "dayOfMonth"].some((k) => k in d)) d.nextRunAt = nextRun({ ...doc.toObject(), ...d }, new Date());
    if (d.active === true && !doc.active) d.nextRunAt = nextRun({ ...doc.toObject(), ...d }, new Date());
  },
});