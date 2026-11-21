import { Request, Response } from "express";
import { Types } from "mongoose";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { Project } from "../models/Project";
import { Task } from "../models/Task";
import { User } from "../models/User";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { ActivityLog } from "../models/ActivityLog";
import { DashboardLayout } from "../models/DashboardLayout";
import { isManagerLevel } from "../services/permissions";
import { addDays, dayKeyIn, eachDay, safeTz } from "../services/attendanceCalc";

const DAY = 864e5;
const FINISHED = /^(completed|complete|done|archived|cancelled|canceled|closed)$/i;
const SIZES = ["s", "m", "l", "xl"];

/* ================================== overview ================================== */

export const overview = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const a = req.access!;
  const uid = req.user!.id;
  const wid = new Types.ObjectId(workspaceId);
  const me = new Types.ObjectId(uid);

  const u: any = await User.findById(uid).select("timezone").lean();
  const tz = safeTz(u?.timezone);
  const now = Date.now();
  const today = dayKeyIn(now, tz);
  const startToday = new Date(`${today}T00:00:00Z`);
  const weekEnd = new Date(+startToday + 7 * DAY);

  const canProjects = a.perms.has("projects.view");
  const canTasks = a.perms.has("tasks.view");
  const canBugs = a.perms.has("bugs.view");
  const canPeople = a.perms.has("people.view");
  const canAnalytics = a.perms.has("analytics.view");
  const tasksOn = canTasks || canBugs;

  // projects this person may open (private projects and "only my projects" roles)
  const mine = [{ members: me }, { managerId: me }, { createdBy: me }];
  const limited = a.scope === "member" && !a.isOwner;
  const visible: any = { workspaceId: wid };
  if (limited) visible.$or = mine;
  else if (!isManagerLevel(a)) visible.$or = [{ visibility: { $ne: "private" } }, ...mine];

  const projects: any[] =
    canProjects || tasksOn ? ((await Project.find(visible).select("name color icon status priority endDate").limit(300).lean()) as any[]) : [];
  const ids = projects.map((p) => p._id);

  // tasks this person may see (same rules as search and the task list)
  const orphan: any = { projectId: { $exists: false } };
  if (limited) orphan.$or = [{ assigneeIds: me }, { createdBy: me }];
  const and: any[] = [{ $or: [{ projectId: { $in: ids } }, orphan] }];
  if (!canBugs) and.push({ type: { $ne: "Bug" } });
  if (!canTasks) and.push({ type: "Bug" });
  const scope: any = { workspaceId: wid, parentTaskId: { $exists: false }, $and: and };

  const open = { status: { $ne: "Done" } };
  const late = { dueDate: { $lt: startToday } };
  const none: any[] = [];
  const overdueExpr = { $and: [{ $ne: ["$status", "Done"] }, { $gt: ["$dueDate", null] }, { $lt: ["$dueDate", startToday] }] };

  const [byStatus, byPriority, perProject, doneDaily, createdDaily, openAll, myOpen, myOverdue, overdueAll, myDueWeek, myItems, workload, bugs, members, act]: any[] =
    await Promise.all([
      tasksOn ? Task.aggregate([{ $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } }]) : none,
      tasksOn ? Task.aggregate([{ $match: { ...scope, ...open } }, { $group: { _id: "$priority", count: { $sum: 1 } } }]) : none,
      tasksOn && ids.length
        ? Task.aggregate([
            { $match: { ...scope, projectId: { $in: ids } } },
            { $group: { _id: "$projectId", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "Done"] }, 1, 0] } }, overdue: { $sum: { $cond: [overdueExpr, 1, 0] } } } },
          ])
        : none,
      tasksOn
        ? Task.aggregate([
            { $match: { ...scope, status: "Done", updatedAt: { $gte: new Date(now - 84 * DAY) } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt", timezone: tz } }, count: { $sum: 1 } } },
          ])
        : none,
      tasksOn
        ? Task.aggregate([
            { $match: { ...scope, createdAt: { $gte: new Date(now - 14 * DAY) } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } }, count: { $sum: 1 } } },
          ])
        : none,
      tasksOn ? Task.countDocuments({ ...scope, ...open }) : 0,
      tasksOn ? Task.countDocuments({ ...scope, ...open, assigneeIds: me }) : 0,
      tasksOn ? Task.countDocuments({ ...scope, ...open, ...late, assigneeIds: me }) : 0,
      tasksOn ? Task.countDocuments({ ...scope, ...open, ...late }) : 0,
      tasksOn ? Task.countDocuments({ ...scope, ...open, assigneeIds: me, dueDate: { $gte: startToday, $lt: weekEnd } }) : 0,
      tasksOn ? Task.find({ ...scope, ...open, assigneeIds: me }).select("title taskNumber status priority dueDate projectId type").limit(80).lean() : none,
      tasksOn && canAnalytics
        ? Task.aggregate([
            { $match: { ...scope, ...open, assigneeIds: { $exists: true, $ne: [] } } },
            { $unwind: "$assigneeIds" },
            { $group: { _id: "$assigneeIds", open: { $sum: 1 }, overdue: { $sum: { $cond: [overdueExpr, 1, 0] } } } },
            { $sort: { open: -1 } },
            { $limit: 8 },
          ])
        : none,
      canBugs ? Task.aggregate([{ $match: { ...scope, type: "Bug", ...open } }, { $group: { _id: "$bugDetails.severity", count: { $sum: 1 } } }]) : none,
      canPeople ? WorkspaceMember.countDocuments({ workspaceId: wid, status: "active" }) : 0,
      // people with a manager-level role see everything that happens, everybody else only their own actions
      ActivityLog.find({ workspaceId: wid, ...(isManagerLevel(a) ? {} : { actorId: me }) }).sort({ createdAt: -1 }).limit(12).populate("actorId", "name profileImage").lean(),
    ]);

  /* ---- series ---- */
  const dMap = new Map<string, number>(doneDaily.map((x: any) => [x._id, x.count]));
  const cMap = new Map<string, number>(createdDaily.map((x: any) => [x._id, x.count]));
  const trend = eachDay(addDays(today, -13), today).map((d) => ({ date: d, created: cMap.get(d) || 0, completed: dMap.get(d) || 0 }));
  const heat = eachDay(addDays(today, -83), today).map((d) => ({ date: d, count: dMap.get(d) || 0 }));
  const completed7 = trend.slice(7).reduce((s, x) => s + x.completed, 0);
  const completedPrev7 = trend.slice(0, 7).reduce((s, x) => s + x.completed, 0);

  const total = byStatus.reduce((s: number, x: any) => s + x.count, 0);
  const done = byStatus.find((x: any) => x._id === "Done")?.count || 0;

  /* ---- projects ---- */
  const pp = new Map<string, any>(perProject.map((x: any) => [String(x._id), x]));
  const list = projects.map((p) => {
    const x = pp.get(String(p._id));
    const t = x?.total || 0;
    const d = x?.done || 0;
    return {
      _id: p._id, name: p.name, color: p.color, icon: p.icon, status: p.status || "", priority: p.priority, endDate: p.endDate || null,
      total: t, done: d, overdue: x?.overdue || 0, progress: t ? Math.round((d / t) * 100) : 0, finished: FINISHED.test(p.status || ""),
    };
  });
  const running = list.filter((p) => !p.finished);

  const attention = running
    .map((p) => {
      const reasons: string[] = [];
      if (p.overdue) reasons.push(`${p.overdue} overdue task${p.overdue === 1 ? "" : "s"}`);
      if (p.endDate) {
        const left = Math.ceil((+new Date(p.endDate) - now) / DAY);
        if (left < 0) reasons.push(`Deadline passed ${-left} day${-left === 1 ? "" : "s"} ago`);
        else if (left <= 7 && p.progress < 70) reasons.push(`Due in ${left} day${left === 1 ? "" : "s"} and only ${p.progress}% done`);
      }
      return { ...p, reasons };
    })
    .filter((p) => p.reasons.length)
    .sort((x, y) => y.reasons.length - x.reasons.length || y.overdue - x.overdue)
    .slice(0, 6);

  const deadlines = running
    .filter((p) => p.endDate)
    .sort((x, y) => +new Date(x.endDate!) - +new Date(y.endDate!))
    .slice(0, 6)
    .map((p) => ({ _id: p._id, name: p.name, color: p.color, endDate: p.endDate, progress: p.progress, daysLeft: Math.ceil((+new Date(p.endDate!) - now) / DAY) }));

  /* ---- people, tasks, activity ---- */
  const pname = new Map(projects.map((p) => [String(p._id), p.name]));
  const tasks = (myItems as any[])
    .sort((x, y) => (x.dueDate ? +new Date(x.dueDate) : Infinity) - (y.dueDate ? +new Date(y.dueDate) : Infinity))
    .slice(0, 12)
    .map((t) => ({ _id: t._id, title: t.title, taskNumber: t.taskNumber, status: t.status, priority: t.priority, dueDate: t.dueDate || null, type: t.type || "Task", projectId: t.projectId || null, projectName: t.projectId ? pname.get(String(t.projectId)) || null : null }));

  const users: any[] = workload.length ? await User.find({ _id: { $in: workload.map((w: any) => w._id) } }).select("name profileImage").lean() : [];
  const uMap = new Map(users.map((x) => [String(x._id), x]));

  return sendSuccess(
    res, 200,
    {
      today, timezone: tz,
      stats: {
        projects: canProjects ? list.length : null, activeProjects: canProjects ? running.length : null, members: canPeople ? members : null,
        openTasks: openAll, myOpen, myOverdue, overdue: overdueAll, myDueWeek, completed7, completedPrev7, totalTasks: total, doneTasks: done,
        completionRate: total ? Math.round((done / total) * 100) : 0,
      },
      byStatus: byStatus.map((x: any) => ({ status: x._id || "Unknown", count: x.count })),
      byPriority: byPriority.map((x: any) => ({ priority: x._id || "None", count: x.count })),
      trend, heat,
      projects: canProjects ? list : [],
      attention: canProjects ? attention : [],
      deadlines: canProjects ? deadlines : [],
      tasks,
      bugs: canBugs ? bugs.map((x: any) => ({ severity: x._id || "Unrated", count: x.count })) : null,
      workload: canAnalytics
        ? workload.map((w: any) => ({ userId: w._id, name: uMap.get(String(w._id))?.name || "Unknown", profileImage: uMap.get(String(w._id))?.profileImage, open: w.open, overdue: w.overdue }))
        : null,
      activity: (act as any[]).map((x) => ({ _id: x._id, action: x.action, resourceType: x.resourceType, title: x.metadata?.title || "", actor: x.actorId?.name ? { name: x.actorId.name, profileImage: x.actorId.profileImage } : null, createdAt: x.createdAt })),
    },
    "Dashboard"
  );
});

/* ================================== layout ================================== */

export const getLayout = catchAsync(async (req: Request, res: Response) => {
  const l: any = await DashboardLayout.findOne({ userId: req.user!.id, workspaceId: req.params.workspaceId }).lean();
  return sendSuccess(res, 200, { widgets: l?.widgets || null }, "Layout");
});

export const saveLayout = catchAsync(async (req: Request, res: Response) => {
  const list = req.body?.widgets;
  if (!Array.isArray(list) || list.length > 60) throw ApiError.badRequest("That layout is not valid");
  const seen = new Set<string>();
  const clean: { id: string; size: string; hidden: boolean }[] = [];
  for (const w of list) {
    const id = String(w?.id || "");
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    clean.push({ id, size: SIZES.includes(w?.size) ? w.size : "m", hidden: !!w?.hidden });
  }
  await DashboardLayout.findOneAndUpdate({ userId: req.user!.id, workspaceId: req.params.workspaceId }, { $set: { widgets: clean } }, { upsert: true });
  return sendSuccess(res, 200, { widgets: clean }, "Layout saved");
});

export const resetLayout = catchAsync(async (req: Request, res: Response) => {
  await DashboardLayout.deleteOne({ userId: req.user!.id, workspaceId: req.params.workspaceId });
  return sendSuccess(res, 200, null, "Layout reset");
});