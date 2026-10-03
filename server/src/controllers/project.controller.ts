import { Request, Response } from "express";
import { Types } from "mongoose";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess, sendPaginated } from "../utils/ApiResponse";
import { Project, IProject } from "../models/Project";
import { Task } from "../models/Task";
import { ProjectTemplate } from "../models/ProjectTemplate";
import { Milestone, RiskIssue } from "../models/ProjectExtras";
// ASSUMPTION: apne workspace-membership model ka path set karo.
import { WorkspaceMember } from "../models/WorkspaceMember";
import { PReq, fail, WORKSPACE_MANAGERS } from "../utils/projectAccess";
import { getName, logActivity, projectRecipients, sendToUsers, uniqueIds } from "../services/projectEvents";
import { BUILT_IN_TEMPLATES, applyTemplate, createTasksBulk, purgeProject } from "../services/projectOps";
import {
  buildProjectUrl, projectArchivedEmail, projectDeletedEmail, projectMemberAddedEmail, projectMemberRemovedEmail,
  projectRoleChangedEmail, projectStatusChangedEmail, projectUpdatedEmail,
} from "../utils/projectEmailTemplates";

const EDITABLE = [
  "name", "description", "managerId", "status", "priority", "startDate", "endDate", "color", "icon", "coverImage",
  "category", "tags", "clientName", "budget", "currency", "visibility",
];
const slugify = (n: string) => n.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fmt = (v: unknown) => (v ? new Date(v as string).toDateString() : "none");
const sameDate = (a?: Date | null, b?: string | null) => (a ? +new Date(a) : 0) === (b ? +new Date(b) : 0);
const pickBody = (body: any) => {
  const out: any = {};
  EDITABLE.forEach((k) => {
    if (body && k in body) out[k] = body[k] === "" ? null : body[k];
  });
  return out;
};
const wsId = (p: IProject) => String(p.workspaceId);
const urlOf = (p: IProject, tab = "overview") => buildProjectUrl(wsId(p), String(p._id), tab);

async function validWorkspaceUsers(workspaceId: string, ids: string[]) {
  if (!ids.length) return [];
  const found = await WorkspaceMember.find({ workspaceId, userId: { $in: ids } }).distinct("userId");
  return found.map(String);
}

/* --------------------------------- Create --------------------------------- */

export const createProject = catchAsync(async (req: Request, res: Response) => {
  const uid = req.user!.id;
  const { workspaceId, memberIds = [], templateId, ...rest } = req.body;
  const data = pickBody(rest);
  if (data.status === "Archived") data.status = "Planning";

  const extra = await validWorkspaceUsers(workspaceId, uniqueIds([...memberIds, data.managerId]).filter((i) => i !== uid));
  const members = uniqueIds([uid, ...extra]);
  const memberRoles = extra.filter((id) => id !== String(data.managerId)).map((userId) => ({ userId, role: "MEMBER" }));

  const project = await Project.create({
    ...data,
    workspaceId,
    slug: `${slugify(data.name)}-${Date.now().toString(36)}`,
    createdBy: uid,
    members,
    memberRoles,
  });

  if (templateId && templateId !== "blank") {
    const tpl: any =
      BUILT_IN_TEMPLATES.find((t) => t.id === templateId) ||
      (Types.ObjectId.isValid(templateId) ? await ProjectTemplate.findOne({ _id: templateId, workspaceId }) : null);
    if (tpl) await applyTemplate(project, tpl, uid);
  }

  await logActivity({ workspaceId, projectId: project._id, actorId: uid, action: "project_created", metadata: { name: project.name, title: project.name } });

  const byName = await getName(uid);
  const url = urlOf(project);
  const managerId = data.managerId ? String(data.managerId) : "";
  void sendToUsers(extra.filter((id) => id !== managerId), uid, () => projectMemberAddedEmail({ projectName: project.name, byName, role: "Member", url }));
  if (managerId) void sendToUsers([managerId], uid, () => projectMemberAddedEmail({ projectName: project.name, byName, role: "Project manager", url }));

  return sendSuccess(res, 201, project, "Project created");
});

/* ---------------------------------- List ---------------------------------- */

export const listProjects = catchAsync(async (req: Request, res: Response) => {
  const uid = req.user!.id;
  const { workspaceId } = req.params;
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(Number(q.page) || 1, 1);
  const limit = Math.min(Number(q.limit) || 50, 200);

  const filter: any = { workspaceId };
  const and: any[] = [];
  if (q.search) {
    const rx = new RegExp(escRx(q.search), "i");
    and.push({ $or: [{ name: rx }, { description: rx }, { clientName: rx }, { tags: rx }] });
  }
  if (q.status) filter.status = q.status;
  else filter.status = q.archived === "true" ? "Archived" : { $ne: "Archived" };
  if (q.priority) filter.priority = q.priority;
  if (q.managerId) filter.managerId = q.managerId;
  if (q.category) filter.category = q.category;
  if (q.tag) filter.tags = q.tag;
  if (q.favorite === "true") filter.favoritedBy = uid;
  if (q.dueBefore) filter.endDate = { $lte: new Date(q.dueBefore) };

  // Private projects sirf unke logon aur workspace admins ko dikhte hain.
  const wm: any = await WorkspaceMember.findOne({ workspaceId, userId: uid }).select("role");
  if (!wm || !WORKSPACE_MANAGERS.includes(wm.role)) {
    and.push({ $or: [{ visibility: { $ne: "private" } }, { members: uid }, { managerId: uid }, { createdBy: uid }] });
  }
  if (and.length) filter.$and = and;

  const docs = await Project.find(filter).populate("managerId", "name profileImage").populate("members", "name profileImage");
  const now = new Date();
  const stats = await Task.aggregate([
    { $match: { projectId: { $in: docs.map((d) => d._id) } } },
    {
      $group: {
        _id: "$projectId",
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ["$status", "Done"] }, 1, 0] } },
        overdue: {
          $sum: { $cond: [{ $and: [{ $gt: ["$dueDate", null] }, { $lt: ["$dueDate", now] }, { $ne: ["$status", "Done"] }] }, 1, 0] },
        },
      },
    },
  ]);
  const statMap = new Map(stats.map((s) => [String(s._id), s]));

  const items = docs.map((d) => {
    const s = statMap.get(String(d._id)) || { total: 0, done: 0, overdue: 0 };
    const o: any = d.toObject();
    o.isFavorite = d.favoritedBy.some((f) => String(f) === uid);
    delete o.favoritedBy;
    o.taskStats = { total: s.total, done: s.done, overdue: s.overdue };
    o.progress = s.total ? Math.round((s.done / s.total) * 100) : d.status === "Completed" ? 100 : 0;
    return o;
  });

  const t = (v?: Date) => (v ? +new Date(v) : 8.64e15);
  const prio: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  const sorters: Record<string, (a: any, b: any) => number> = {
    newest: (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    oldest: (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
    due: (a, b) => t(a.endDate) - t(b.endDate),
    progress: (a, b) => b.progress - a.progress,
    priority: (a, b) => prio[a.priority] - prio[b.priority],
  };
  items.sort(sorters[q.sort || "newest"] || sorters.newest);
  items.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite)); // favorites upar

  return sendPaginated(res, items.slice((page - 1) * limit, page * limit), page, limit, items.length, "Projects");
});

/* ----------------------------------- Get ----------------------------------- */

export const getProject = catchAsync(async (req: Request, res: Response) => {
  const { project: base, projectRole } = req as PReq;
  const project = await Project.findById(base._id)
    .populate("managerId", "name profileImage email")
    .populate("members", "name profileImage email")
    .populate("memberRoles.userId", "name profileImage email");
  if (!project) throw ApiError.notFound("Project not found");

  const pid = project._id;
  const [total, completed, inProgress, overdue, msTotal, msDone, openRisks] = await Promise.all([
    Task.countDocuments({ projectId: pid }),
    Task.countDocuments({ projectId: pid, status: "Done" }),
    Task.countDocuments({ projectId: pid, status: "In Progress" }),
    Task.countDocuments({ projectId: pid, dueDate: { $lt: new Date() }, status: { $ne: "Done" } }),
    Milestone.countDocuments({ projectId: pid }),
    Milestone.countDocuments({ projectId: pid, status: "Completed" }),
    RiskIssue.countDocuments({ projectId: pid, status: { $in: ["Open", "Mitigating"] } }),
  ]);

  const out: any = project.toObject();
  out.isFavorite = project.favoritedBy.some((f) => String(f) === req.user!.id);
  out.myRole = projectRole;
  out.progress = total ? Math.round((completed / total) * 100) : project.status === "Completed" ? 100 : 0;
  delete out.favoritedBy;

  return sendSuccess(
    res, 200,
    {
      project: out,
      stats: { total, completed, inProgress, overdue, pending: total - completed - inProgress, milestones: { total: msTotal, done: msDone }, openRisks },
    },
    "Project"
  );
});

/* --------------------------------- Update --------------------------------- */

export const updateProject = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const uid = req.user!.id;
  const body: any = pickBody(req.body);
  if (body.status === "Archived") delete body.status; // archive ke liye alag endpoint hai

  const changes: string[] = [];
  const statusFrom = project.status;
  const statusChanged = "status" in body && body.status && body.status !== project.status;
  if ("name" in body && body.name !== project.name) changes.push(`Name: "${project.name}" → "${body.name}"`);
  if ("priority" in body && body.priority !== project.priority) changes.push(`Priority: ${project.priority} → ${body.priority}`);
  if ("startDate" in body && !sameDate(project.startDate, body.startDate)) changes.push(`Start date: ${fmt(project.startDate)} → ${fmt(body.startDate)}`);
  const endChanged = "endDate" in body && !sameDate(project.endDate, body.endDate);
  if (endChanged) {
    changes.push(`End date: ${fmt(project.endDate)} → ${fmt(body.endDate)}`);
    body.dueSoonSentAt = null;
    body.overdueSentAt = null;
  }
  if ("visibility" in body && body.visibility !== project.visibility) changes.push(`Visibility: ${project.visibility} → ${body.visibility}`);
  const managerChanged = "managerId" in body && String(body.managerId ?? "") !== String(project.managerId ?? "");
  if (managerChanged) changes.push("Project manager changed");

  project.set(body);
  if (managerChanged && body.managerId && !project.members.some((m) => String(m) === String(body.managerId))) {
    project.members.push(new Types.ObjectId(body.managerId));
  }
  await project.save();

  await logActivity({ workspaceId: project.workspaceId, projectId: project._id, actorId: uid, action: "project_updated", metadata: { title: project.name, changes: [...changes, ...(statusChanged ? [`Status: ${statusFrom} → ${body.status}`] : [])] } });

  const byName = await getName(uid);
  const url = urlOf(project);
  const recipients = projectRecipients(project);
  if (statusChanged) void sendToUsers(recipients, uid, () => projectStatusChangedEmail({ projectName: project.name, from: statusFrom, to: body.status, byName, url }));
  if (changes.length) void sendToUsers(recipients, uid, () => projectUpdatedEmail({ projectName: project.name, byName, changes, url }));
  if (managerChanged && body.managerId) void sendToUsers([body.managerId], uid, () => projectMemberAddedEmail({ projectName: project.name, byName, role: "Project manager", url }));

  return sendSuccess(res, 200, project, "Project updated");
});

/* ------------------------- Archive / restore / delete ------------------------- */

export const archiveProject = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  if (project.status !== "Archived") {
    project.previousStatus = project.status;
    project.status = "Archived";
    project.archivedAt = new Date();
    await project.save();
    await logActivity({ workspaceId: project.workspaceId, projectId: project._id, actorId: req.user!.id, action: "project_archived", metadata: { title: project.name } });
    const byName = await getName(req.user!.id);
    void sendToUsers(projectRecipients(project), req.user!.id, () => projectArchivedEmail({ projectName: project.name, byName, archived: true, url: urlOf(project) }));
  }
  return sendSuccess(res, 200, project, "Project archived");
});

export const restoreProject = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  if (project.status === "Archived") {
    project.status = project.previousStatus && project.previousStatus !== "Archived" ? project.previousStatus : "Active";
    project.archivedAt = undefined;
    await project.save();
    await logActivity({ workspaceId: project.workspaceId, projectId: project._id, actorId: req.user!.id, action: "project_restored", metadata: { title: project.name } });
    const byName = await getName(req.user!.id);
    void sendToUsers(projectRecipients(project), req.user!.id, () => projectArchivedEmail({ projectName: project.name, byName, archived: false, url: urlOf(project) }));
  }
  return sendSuccess(res, 200, project, "Project restored");
});

async function deleteWithEmail(project: IProject, actorId: string) {
  const recipients = projectRecipients(project);
  const name = project.name;
  const byName = await getName(actorId);
  await purgeProject(project._id);
  await Project.deleteOne({ _id: project._id });
  void sendToUsers(recipients, actorId, () => projectDeletedEmail({ projectName: name, byName }));
}

export const deleteProject = catchAsync(async (req: Request, res: Response) => {
  await deleteWithEmail((req as PReq).project, req.user!.id);
  return sendSuccess(res, 200, null, "Project deleted");
});

/* ------------------------------ Favorite / dup ------------------------------ */

export const toggleFavorite = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const uid = req.user!.id;
  const has = project.favoritedBy.some((f) => String(f) === uid);
  await Project.updateOne({ _id: project._id }, has ? { $pull: { favoritedBy: uid } } : { $addToSet: { favoritedBy: uid } });
  return sendSuccess(res, 200, { isFavorite: !has }, has ? "Removed from favorites" : "Added to favorites");
});

export const duplicateProject = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const uid = req.user!.id;
  const { name, includeTasks = true, includeMilestones = true } = req.body || {};
  const src: any = project.toObject();
  const copyName = String(name || `${project.name} (Copy)`).slice(0, 120);

  const copy = await Project.create({
    workspaceId: project.workspaceId, name: copyName, slug: `${slugify(copyName)}-${Date.now().toString(36)}`,
    description: src.description, managerId: src.managerId, members: src.members, memberRoles: src.memberRoles,
    status: "Planning", priority: src.priority, startDate: src.startDate, endDate: src.endDate, color: src.color, icon: src.icon,
    coverImage: src.coverImage, category: src.category, tags: src.tags, clientName: src.clientName, budget: src.budget,
    currency: src.currency, visibility: src.visibility, createdBy: uid,
  });

  const oldTasks: any[] = includeTasks ? await Task.find({ projectId: project._id }).sort({ taskNumber: 1 }).lean() : [];
  const newTasks = await createTasksBulk(
    copy,
    oldTasks.map((t) => ({ title: t.title, description: t.description, priority: t.priority, labels: t.labels, estimatedMinutes: t.estimatedMinutes, status: "Backlog" })),
    uid
  );
  if (includeMilestones) {
    const ms: any[] = await Milestone.find({ projectId: project._id }).lean();
    const idMap = new Map(oldTasks.map((t, i) => [String(t._id), newTasks[i]?._id]));
    await Milestone.insertMany(
      ms.map((m) => ({
        projectId: copy._id, workspaceId: copy.workspaceId, title: m.title, description: m.description, dueDate: m.dueDate, order: m.order, createdBy: uid,
        taskIds: (m.taskIds || []).map((id: any) => idMap.get(String(id))).filter(Boolean),
      }))
    );
  }
  await logActivity({ workspaceId: copy.workspaceId, projectId: copy._id, actorId: uid, action: "project_created", metadata: { title: copyName, duplicatedFrom: project.name } });

  const byName = await getName(uid);
  void sendToUsers(copy.members, uid, () => projectMemberAddedEmail({ projectName: copy.name, byName, role: "Member", url: urlOf(copy) }));
  return sendSuccess(res, 201, copy, "Project duplicated");
});

/* ----------------------------------- Bulk ----------------------------------- */

export const bulkUpdate = catchAsync(async (req: Request, res: Response) => {
  const uid = req.user!.id;
  const { workspaceId, ids, action, status } = req.body;
  const projects = await Project.find({ _id: { $in: ids }, workspaceId });
  const byName = await getName(uid);
  let n = 0;
  for (const p of projects) {
    if (action === "archive" && p.status !== "Archived") {
      p.previousStatus = p.status; p.status = "Archived"; p.archivedAt = new Date();
      void sendToUsers(projectRecipients(p), uid, () => projectArchivedEmail({ projectName: p.name, byName, archived: true, url: urlOf(p) }));
    } else if (action === "restore" && p.status === "Archived") {
      p.status = p.previousStatus && p.previousStatus !== "Archived" ? p.previousStatus : "Active"; p.archivedAt = undefined;
      void sendToUsers(projectRecipients(p), uid, () => projectArchivedEmail({ projectName: p.name, byName, archived: false, url: urlOf(p) }));
    } else if (action === "status" && status && status !== "Archived" && status !== p.status) {
      const from = p.status; p.status = status;
      void sendToUsers(projectRecipients(p), uid, () => projectStatusChangedEmail({ projectName: p.name, from, to: status, byName, url: urlOf(p) }));
    } else continue;
    await p.save();
    await logActivity({ workspaceId, projectId: p._id, actorId: uid, action: `project_bulk_${action}`, metadata: { title: p.name } });
    n++;
  }
  return sendSuccess(res, 200, { updated: n }, `${n} project(s) updated`);
});

export const bulkDelete = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, ids } = req.body;
  const projects = await Project.find({ _id: { $in: ids }, workspaceId });
  for (const p of projects) await deleteWithEmail(p, req.user!.id);
  return sendSuccess(res, 200, { deleted: projects.length }, `${projects.length} project(s) deleted`);
});

/* -------------------------------- Members -------------------------------- */

export const addMember = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const { userId, role = "MEMBER" } = req.body;
  if (!userId) return fail(res, "userId is required");
  if (!(await validWorkspaceUsers(wsId(project), [userId])).length) return fail(res, "That user is not a member of this workspace");

  if (!project.members.some((m) => String(m) === String(userId))) project.members.push(new Types.ObjectId(userId));
  (project as any).memberRoles = project.memberRoles.filter((m) => String(m.userId) !== String(userId));
  (project.memberRoles as any).push({ userId, role });
  await project.save();

  await logActivity({ workspaceId: project.workspaceId, projectId: project._id, actorId: req.user!.id, action: "member_added", entity: "member", metadata: { userId, role } });
  const byName = await getName(req.user!.id);
  void sendToUsers([userId], req.user!.id, () => projectMemberAddedEmail({ projectName: project.name, byName, role, url: urlOf(project) }));
  return sendSuccess(res, 200, project, "Member added");
});

export const updateMemberRole = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const { userId } = req.params;
  const { role } = req.body;
  if (!project.members.some((m) => String(m) === userId)) return fail(res, "Not a project member", 404);
  (project as any).memberRoles = project.memberRoles.filter((m) => String(m.userId) !== userId);
  (project.memberRoles as any).push({ userId, role });
  await project.save();
  await logActivity({ workspaceId: project.workspaceId, projectId: project._id, actorId: req.user!.id, action: "member_role_changed", entity: "member", metadata: { userId, role } });
  const byName = await getName(req.user!.id);
  void sendToUsers([userId], req.user!.id, () => projectRoleChangedEmail({ projectName: project.name, byName, role, url: urlOf(project) }));
  return sendSuccess(res, 200, project, "Role updated");
});

export const removeMember = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const { userId } = req.params;
  if (String(project.managerId) === userId || String(project.createdBy) === userId) return fail(res, "Change the project manager before removing this person");
  await Project.updateOne({ _id: project._id }, { $pull: { members: userId, memberRoles: { userId } } });
  await logActivity({ workspaceId: project.workspaceId, projectId: project._id, actorId: req.user!.id, action: "member_removed", entity: "member", metadata: { userId } });
  const byName = await getName(req.user!.id);
  void sendToUsers([userId], req.user!.id, () => projectMemberRemovedEmail({ projectName: project.name, byName }));
  return sendSuccess(res, 200, null, "Member removed");
});

/* -------------------------------- Templates -------------------------------- */

export const listTemplates = catchAsync(async (req: Request, res: Response) => {
  const saved: any[] = await ProjectTemplate.find({ workspaceId: req.params.workspaceId }).sort({ createdAt: -1 }).lean();
  const shape = (t: any, custom: boolean) => ({
    id: custom ? String(t._id) : t.id, name: t.name, description: t.description, custom,
    milestoneCount: t.milestones.length, taskCount: t.tasks.length,
  });
  return sendSuccess(res, 200, [...BUILT_IN_TEMPLATES.map((t) => shape(t, false)), ...saved.map((t) => shape(t, true))], "Templates");
});

export const saveAsTemplate = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const name = String(req.body.name || `${project.name} template`).slice(0, 120);
  const [ms, tasks]: [any[], any[]] = await Promise.all([
    Milestone.find({ projectId: project._id }).sort({ order: 1 }).lean(),
    Task.find({ projectId: project._id }).sort({ taskNumber: 1 }).select("title description estimatedMinutes").lean() as any,
  ]);
  const milestoneOf = new Map<string, string>();
  ms.forEach((m) => (m.taskIds || []).forEach((id: any) => milestoneOf.set(String(id), m.title)));
  const tpl = await ProjectTemplate.create({
    workspaceId: project.workspaceId, name, description: req.body.description || project.description, createdBy: req.user!.id,
    milestones: ms.map((m) => m.title),
    tasks: tasks.map((t) => ({ title: t.title, description: t.description, estimatedMinutes: t.estimatedMinutes, milestoneTitle: milestoneOf.get(String(t._id)) })),
  });
  return sendSuccess(res, 201, tpl, "Template saved");
});

export const deleteTemplate = catchAsync(async (req: Request, res: Response) => {
  const tpl: any = await ProjectTemplate.findById(req.params.templateId);
  if (!tpl) throw ApiError.notFound("Template not found");
  const wm: any = await WorkspaceMember.findOne({ workspaceId: tpl.workspaceId, userId: req.user!.id }).select("role");
  if (!wm || !WORKSPACE_MANAGERS.includes(wm.role)) return fail(res, "Not allowed", 403);
  await tpl.deleteOne();
  return sendSuccess(res, 200, null, "Template deleted");
});

/* ---------------------------------- Export ---------------------------------- */

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection se bachav
  return `"${s.replace(/"/g, '""')}"`;
};

export const exportProject = catchAsync(async (req: Request, res: Response) => {
  const { project } = req as PReq;
  const tasks: any[] = await Task.find({ projectId: project._id }).sort({ taskNumber: 1 }).populate("assigneeIds", "name").lean();
  const head = ["ID", "Title", "Status", "Priority", "Assignees", "Start date", "Due date", "Labels", "Estimated (min)", "Logged (min)", "Created"];
  const rows = tasks.map((t) => [
    `TASK-${t.taskNumber}`, t.title, t.status, t.priority, (t.assigneeIds || []).map((a: any) => a.name).join("; "),
    t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : "", t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
    (t.labels || []).join("; "), t.estimatedMinutes ?? "", t.actualMinutes ?? "", new Date(t.createdAt).toISOString().slice(0, 10),
  ]);
  const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${slugify(project.name) || "project"}-tasks.csv"`);
  res.send(csv);
});