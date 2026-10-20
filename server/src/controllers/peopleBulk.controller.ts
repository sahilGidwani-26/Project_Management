import { Request, Response } from "express";
import { Types } from "mongoose";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { WorkspaceMember, WorkspaceRole } from "../models/WorkspaceMember";
import { Project } from "../models/Project";
import { Task } from "../models/Task";
import { ActivityLog } from "../models/ActivityLog";
import { sendMail } from "../utils/mailer";
import { bulkImportSummaryEmail } from "../utils/peopleEmailTemplates";
import { buildProjectUrl, projectMemberAddedEmail } from "../utils/projectEmailTemplates";
import { getName, logActivity, sendToUsers } from "../services/projectEvents";
import { isManagerRole } from "../services/people";
import { checkRow, provisionRow } from "../services/peopleProvision";
import { env } from "../config/env";

const ID = /^[a-f\d]{24}$/i;
const roleOf = (req: Request) => req.workspaceRole as WorkspaceRole;
const nameOf = async (id: string) => ((await User.findById(id).select("name")) as any)?.name || "Someone";

/* ================================ bulk import ================================ */

/**
 * POST /workspaces/:id/members/bulk-import
 * body: { mode: "create" | "invite", rows: [{ email, name, role, designation, department, company, employmentType, phone }], validateOnly?, sendLoginDetails? }
 * validateOnly = true checks every row and changes nothing. Otherwise the valid rows are imported and the rest are reported.
 */
export const bulkImport = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const actorId = req.user!.id;
  const mode: "create" | "invite" = req.body.mode === "invite" ? "invite" : "create";
  const rows: Record<string, unknown>[] = req.body.rows;
  if (!Array.isArray(rows) || !rows.length) throw ApiError.badRequest("There are no rows to import");
  if (rows.length > 100) throw ApiError.badRequest("Import at most 100 people at a time");

  const emails = [...new Set(rows.map((r) => String((r as any)?.email || "").trim().toLowerCase()).filter(Boolean))];
  const users: any[] = emails.length ? await User.find({ email: { $in: emails } }).select("_id name email accountStatus").lean() : [];
  const members: any[] = users.length ? await WorkspaceMember.find({ workspaceId, userId: { $in: users.map((u) => u._id) } }).select("userId status").lean() : [];

  const ctx = {
    actorRole: roleOf(req), mode, seen: new Set<string>(),
    users: new Map(users.map((u) => [u.email, u])),
    memberStatus: new Map(members.map((m) => [String(m.userId), m.status as string])),
  };
  const checks = rows.map((r, i) => ({ line: i + 1, ...checkRow(r || {}, ctx) }));

  if (req.body.validateOnly) {
    const ok = checks.filter((c) => c.ok).length;
    return sendSuccess(
      res, 200,
      { checks: checks.map(({ norm, ...c }) => c), summary: { total: checks.length, ok, failed: checks.length - ok } },
      "Checked"
    );
  }

  const [byName, ws]: [string, any] = await Promise.all([nameOf(actorId), Workspace.findById(workspaceId).select("name").lean()]);
  const pctx = { workspaceId, actorId, byName, workspaceName: ws?.name || "your workspace", mode, send: req.body.sendLoginDetails !== false };

  const results: any[] = checks.map((c) => (c.ok ? null : { line: c.line, email: c.email, name: c.name, status: "failed", message: c.error }));
  const todo = checks.filter((c) => c.ok);
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4); // a few at a time: password hashing is slow on purpose
    const out = await Promise.allSettled(batch.map((c) => provisionRow(c.norm!, pctx)));
    out.forEach((o, k) => {
      const c = batch[k];
      results[c.line - 1] =
        o.status === "fulfilled"
          ? { line: c.line, email: c.email, name: c.norm!.name || c.name, ...o.value }
          : { line: c.line, email: c.email, name: c.name, status: "failed", message: (o.reason as Error)?.message || "Could not import this row" };
    });
  }

  const count = (s: string) => results.filter((r) => r.status === s).length;
  const summary = { total: results.length, created: count("created"), added: count("added"), invited: count("invited") + count("refreshed"), failed: count("failed") };

  await ActivityLog.create({
    workspaceId, actorId, action: "members_bulk_imported", resourceType: "Workspace", resourceId: workspaceId,
    metadata: { title: `${summary.total - summary.failed} of ${summary.total} people`, mode, ...summary },
  }).catch(() => undefined);

  const me: any = await User.findById(actorId).select("email");
  if (me?.email) {
    const failures = results.filter((r) => r.status === "failed").slice(0, 10).map((r) => `Line ${r.line + 1} ${r.email || ""}: ${r.message}`);
    const mail = bulkImportSummaryEmail({ workspaceName: pctx.workspaceName, mode, created: summary.created, added: summary.added, invited: summary.invited, failed: summary.failed, failures, url: `${env.CLIENT_URL}/app/${workspaceId}/team` });
    sendMail(me.email, mail.subject, mail.html).catch(() => {});
  }

  return sendSuccess(res, 200, { results, summary, emailsSent: pctx.send && !!env.SMTP_HOST }, "Import finished");
});

/* ================================== export ================================== */

const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return `"${s.replace(/"/g, '""')}"`;
};
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");

/** GET /workspaces/:id/members/export?private=1 : admins only. Private details (phone, address, DOB) only when asked, and the export is logged. */
export const exportMembers = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const withPrivate = req.query.private === "1";

  const members: any[] = await WorkspaceMember.find({ workspaceId, status: { $in: ["active", "deactivated"] } })
    .sort({ joinedAt: 1 })
    .populate("userId", "name email lastLoginAt")
    .lean();
  const mgrIds = [...new Set(members.map((m) => m.profile?.reportingManagerId).filter(Boolean).map(String))];
  const mgrs: any[] = mgrIds.length ? await User.find({ _id: { $in: mgrIds } }).select("name").lean() : [];
  const mgrName = new Map(mgrs.map((u) => [String(u._id), u.name]));

  const head = ["Name", "Email", "Role", "Status", "Designation", "Department", "Company", "Employment type", "Employee ID", "Joined", "Reports to", "Work location", "Skills", "Last login"];
  if (withPrivate) head.push("Phone", "Alternate phone", "Date of birth", "Address", "Emergency contact");

  const rows = members.map((m) => {
    const p = m.profile || {};
    const a = m.personal?.address || {};
    const e = m.personal?.emergencyContact || {};
    const row: unknown[] = [
      m.userId?.name, m.userId?.email, m.role, m.status, p.designation, p.department, p.company, p.employmentType, p.employeeId,
      day(m.joinedAt), p.reportingManagerId ? mgrName.get(String(p.reportingManagerId)) : "", p.workLocation, (p.skills || []).join("; "), day(m.userId?.lastLoginAt),
    ];
    if (withPrivate) {
      row.push(
        m.personal?.phone, m.personal?.alternatePhone, day(m.personal?.dateOfBirth),
        [a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", "),
        e.name ? `${e.name}${e.relation ? ` (${e.relation})` : ""}${e.phone ? ` ${e.phone}` : ""}` : ""
      );
    }
    return row;
  });

  await ActivityLog.create({
    workspaceId, actorId: req.user!.id, action: "members_exported", resourceType: "Workspace", resourceId: workspaceId,
    metadata: { title: `${members.length} people${withPrivate ? " (with private details)" : ""}`, private: withPrivate },
  }).catch(() => undefined);

  const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="team-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

/* ================================ departments ================================ */

/** GET /workspaces/:id/departments : people grouped by department. Workload numbers only for managers. */
export const listDepartments = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const manager = isManagerRole(roleOf(req));

  const members: any[] = await WorkspaceMember.find({ workspaceId, status: "active" })
    .select("userId role profile.designation profile.department")
    .populate("userId", "name email profileImage")
    .lean();
  const userIds = members.map((m) => m.userId?._id).filter(Boolean);

  const load = new Map<string, { open: number; overdue: number }>();
  if (manager && userIds.length) {
    const now = new Date();
    const rows: any[] = await Task.aggregate([
      { $match: { workspaceId: new Types.ObjectId(workspaceId), parentTaskId: { $exists: false }, status: { $ne: "Done" }, assigneeIds: { $in: userIds } } },
      { $unwind: "$assigneeIds" },
      { $match: { assigneeIds: { $in: userIds } } },
      { $group: { _id: "$assigneeIds", open: { $sum: 1 }, overdue: { $sum: { $cond: [{ $and: [{ $gt: ["$dueDate", null] }, { $lt: ["$dueDate", now] }] }, 1, 0] } } } },
    ]);
    rows.forEach((r) => load.set(String(r._id), { open: r.open, overdue: r.overdue }));
  }

  const groups = new Map<string, any>();
  for (const m of members) {
    if (!m.userId) continue;
    const name = (m.profile?.department || "").trim();
    const key = name.toLowerCase();
    const g = groups.get(key) || { name, key, count: 0, members: [], ...(manager ? { openTasks: 0, overdue: 0 } : {}) };
    const l = load.get(String(m.userId._id));
    g.count++;
    g.members.push({
      memberId: m._id, userId: m.userId._id, name: m.userId.name, email: m.userId.email, profileImage: m.userId.profileImage,
      designation: m.profile?.designation, role: m.role, ...(manager ? { openTasks: l?.open || 0 } : {}),
    });
    if (manager) { g.openTasks += l?.open || 0; g.overdue += l?.overdue || 0; }
    groups.set(key, g);
  }

  const list = [...groups.values()];
  list.forEach((g) => g.members.sort((a: any, b: any) => a.name.localeCompare(b.name)));
  list.sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
  return sendSuccess(res, 200, list, "Departments");
});

/* ================================== org chart ================================== */

export const orgChart = catchAsync(async (req: Request, res: Response) => {
  const members: any[] = await WorkspaceMember.find({ workspaceId: req.params.workspaceId, status: "active" })
    .select("userId role profile.designation profile.department profile.reportingManagerId")
    .populate("userId", "name profileImage")
    .lean();
  const nodes = members
    .filter((m) => m.userId)
    .map((m) => ({
      memberId: m._id, userId: m.userId._id, name: m.userId.name, profileImage: m.userId.profileImage,
      designation: m.profile?.designation, department: m.profile?.department, role: m.role,
      managerUserId: m.profile?.reportingManagerId ? String(m.profile.reportingManagerId) : null,
    }));
  return sendSuccess(res, 200, nodes, "Org chart");
});

/* ============================ add people to a project ============================ */

/** POST /workspaces/:id/members/add-to-project  body: { projectId, userIds: [], role } (used for "add the whole department"). */
export const addToProject = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const actorId = req.user!.id;
  const { projectId, userIds, role = "MEMBER" } = req.body;

  if (!["ADMIN", "MEMBER", "VIEWER"].includes(role)) throw ApiError.badRequest("Unknown project role");
  if (!ID.test(String(projectId))) throw ApiError.badRequest("Choose a project");
  const ids: string[] = Array.isArray(userIds) ? [...new Set(userIds.map(String).filter((i) => ID.test(i)))].slice(0, 200) : [];
  if (!ids.length) throw ApiError.badRequest("Choose at least one person");

  const project: any = await Project.findOne({ _id: projectId, workspaceId });
  if (!project) throw ApiError.notFound("Project not found");

  const valid = (await WorkspaceMember.find({ workspaceId, userId: { $in: ids }, status: "active" }).distinct("userId")).map(String);
  const have = new Set((project.members || []).map(String));
  const fresh = valid.filter((i) => !have.has(i));

  if (fresh.length) {
    await Project.updateOne(
      { _id: project._id },
      { $addToSet: { members: { $each: fresh } }, $push: { memberRoles: { $each: fresh.map((userId) => ({ userId, role })) } } }
    );
    await logActivity({ workspaceId: project.workspaceId, projectId: project._id, actorId, action: "members_added_in_bulk", entity: "member", metadata: { title: `${fresh.length} people`, role } });
    const byName = await getName(actorId);
    const url = buildProjectUrl(String(project.workspaceId), String(project._id));
    void sendToUsers(fresh, actorId, () => projectMemberAddedEmail({ projectName: project.name, byName, role, url }));
  }

  return sendSuccess(
    res, 200,
    { added: fresh.length, alreadyInProject: valid.length - fresh.length, skipped: ids.length - valid.length },
    fresh.length ? `${fresh.length} added to ${project.name}` : "Everyone chosen is already in this project"
  );
});