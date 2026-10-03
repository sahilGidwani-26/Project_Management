import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { makeCrud } from "../utils/projectCrud";
import { PReq, fail } from "../utils/projectAccess";
import { Task } from "../models/Task";
import { ActivityLog } from "../models/ActivityLog";
import { ProjectComment, ProjectFile, RiskIssue, TimeEntry } from "../models/ProjectExtras";
// ASSUMPTION: apne workspace-membership model ka path set karo.
import { WorkspaceMember } from "../models/WorkspaceMember";
import { getName, logActivity, projectLeads, projectRecipients, sendToUsers } from "../services/projectEvents";
import { UPLOAD_DIR } from "../services/projectOps";
import { buildProjectUrl, projectFileEmail, projectMentionEmail, riskEmail } from "../utils/projectEmailTemplates";

const url = (r: PReq, tab: string) => buildProjectUrl(String(r.project.workspaceId), String(r.project._id), tab);
const actor = (r: PReq) => r.user!.id;

/* -------------------------------- Discussion -------------------------------- */

async function validMentions(r: PReq, list: unknown): Promise<string[]> {
  const ids = Array.isArray(list) ? list.map(String) : [];
  if (!ids.length) return [];
  return (await WorkspaceMember.find({ workspaceId: r.project.workspaceId, userId: { $in: ids } }).distinct("userId")).map(String);
}

export const commentCrud = makeCrud({
  model: ProjectComment,
  entity: "comment",
  fields: ["content", "mentions", "pinned"],
  sort: { pinned: -1, createdAt: 1 },
  ownerField: "userId",
  populate: [{ path: "userId", select: "name profileImage" }, { path: "mentions", select: "name" }],
  beforeCreate: async (r, d) => {
    d.userId = actor(r);
    d.mentions = await validMentions(r, d.mentions);
  },
  beforeUpdate: async (r, d, doc) => {
    if ("mentions" in d) d.mentions = await validMentions(r, d.mentions);
    if ("content" in d && d.content !== doc.content) d.editedAt = new Date();
  },
  afterCreate: async (r, doc) => {
    if (!doc.mentions?.length) return;
    const byName = await getName(actor(r));
    void sendToUsers(doc.mentions, actor(r), () =>
      projectMentionEmail({ projectName: r.project.name, byName, snippet: String(doc.content).slice(0, 300), url: url(r, "discussion") })
    );
  },
});

/* ----------------------------------- Files ----------------------------------- */

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const BLOCKED = [".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".sh", ".ps1", ".vbs", ".jar"];

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) =>
    BLOCKED.includes(path.extname(file.originalname).toLowerCase()) ? cb(new Error("This file type is not allowed")) : cb(null, true),
});

export const listFiles = catchAsync(async (req: Request, res: Response) =>
  sendSuccess(res, 200, await ProjectFile.find({ projectId: (req as PReq).project._id }).sort({ createdAt: -1 }).populate("uploadedBy", "name profileImage"), "files")
);

export const uploadFiles = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const files = ((req as any).files as Express.Multer.File[]) || [];
  if (!files.length) return fail(res, "No file uploaded");
  const docs = await ProjectFile.insertMany(
    files.map((f) => ({
      projectId: r.project._id, workspaceId: r.project.workspaceId, uploadedBy: actor(r),
      fileName: f.originalname, storedName: f.filename, fileType: f.mimetype, fileSize: f.size,
    }))
  );
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: actor(r), action: "file_uploaded", entity: "file", metadata: { title: files.map((f) => f.originalname).join(", ") } });
  const byName = await getName(actor(r));
  void sendToUsers(projectRecipients(r.project), actor(r), () => projectFileEmail({ projectName: r.project.name, fileNames: files.map((f) => f.originalname), byName, url: url(r, "files") }));
  return sendSuccess(res, 201, docs, "Uploaded");
});

export const downloadFile = catchAsync(async (req: Request, res: Response) => {
  const f = await ProjectFile.findOne({ _id: req.params.itemId, projectId: (req as PReq).project._id });
  if (!f) throw ApiError.notFound("File not found");
  const full = path.join(UPLOAD_DIR, path.basename(f.storedName));
  if (!fs.existsSync(full)) throw ApiError.notFound("File is missing on the server");
  return res.download(full, f.fileName);
});

export const deleteFile = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const f = await ProjectFile.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!f) throw ApiError.notFound("File not found");
  if (String(f.uploadedBy) !== actor(r) && r.projectRole !== "ADMIN") return fail(res, "Only the uploader or a project admin can delete this file", 403);
  await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(f.storedName))).catch(() => undefined);
  await f.deleteOne();
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: actor(r), action: "file_deleted", entity: "file", metadata: { title: f.fileName } });
  return sendSuccess(res, 200, null, "File deleted");
});

/* ------------------------------- Risks & issues ------------------------------- */

export const riskCrud = makeCrud({
  model: RiskIssue,
  entity: "risk",
  fields: ["type", "title", "description", "severity", "probability", "status", "ownerId", "mitigation", "dueDate"],
  sort: { createdAt: -1 },
  populate: { path: "ownerId", select: "name profileImage" },
  afterCreate: async (r, doc) => {
    const byName = await getName(actor(r));
    const base = { type: doc.type, title: doc.title, severity: doc.severity, projectName: r.project.name, byName, url: url(r, "risks") };
    if (doc.ownerId) void sendToUsers([doc.ownerId], actor(r), () => riskEmail({ kind: "assigned", ...base }));
    if (["High", "Critical"].includes(doc.severity)) void sendToUsers(projectLeads(r.project), actor(r), () => riskEmail({ kind: "raised", ...base }));
  },
  afterUpdate: async (r, doc, before) => {
    const byName = await getName(actor(r));
    const base = { type: doc.type, title: doc.title, severity: doc.severity, projectName: r.project.name, byName, url: url(r, "risks") };
    if (doc.ownerId && String(doc.ownerId) !== String(before.ownerId ?? "")) void sendToUsers([doc.ownerId], actor(r), () => riskEmail({ kind: "assigned", ...base }));
    if (doc.status === "Resolved" && before.status !== "Resolved") void sendToUsers([doc.createdBy, ...projectLeads(r.project)], actor(r), () => riskEmail({ kind: "resolved", ...base }));
  },
});

/* --------------------------------- Activity --------------------------------- */

export const listActivity = catchAsync(async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const items = await ActivityLog.find({ resourceType: "Project", resourceId: (req as PReq).project._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("actorId", "name profileImage");
  return sendSuccess(res, 200, items, "activity");
});

/* ---------------------------------- Reports ---------------------------------- */

const DAY = 864e5;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const endOfDay = (d: Date) => new Date(new Date(d).setHours(23, 59, 59, 999));

export const getReports = catchAsync(async (req: Request, res: Response) => {
  const p = (req as PReq).project;
  const now = new Date();
  const tasks: any[] = await Task.find({ projectId: p._id })
    .select("status priority createdAt updatedAt dueDate assigneeIds estimatedMinutes actualMinutes")
    .populate("assigneeIds", "name profileImage")
    .lean();

  const isDone = (t: any) => t.status === "Done";
  const isOverdue = (t: any) => t.dueDate && new Date(t.dueDate) < now && !isDone(t);
  const count = (key: string) => tasks.reduce<Record<string, number>>((a, t) => ((a[t[key]] = (a[t[key]] || 0) + 1), a), {});

  const wl = new Map<string, any>();
  tasks.forEach((t) =>
    (t.assigneeIds || []).forEach((u: any) => {
      const w = wl.get(String(u._id)) || { user: { _id: u._id, name: u.name, profileImage: u.profileImage }, open: 0, done: 0, overdue: 0, estimatedMinutes: 0, loggedMinutes: 0 };
      isDone(t) ? w.done++ : w.open++;
      if (isOverdue(t)) w.overdue++;
      w.estimatedMinutes += t.estimatedMinutes || 0;
      w.loggedMinutes += t.actualMinutes || 0;
      wl.set(String(u._id), w);
    })
  );

  // Burndown. Completion date ka approximation: updatedAt
  const created = tasks.map((t) => +new Date(t.createdAt));
  let start = p.startDate ? new Date(p.startDate) : new Date(created.length ? Math.min(...created) : now.getTime() - 14 * DAY);
  let end = p.endDate ? new Date(p.endDate) : new Date(now.getTime() + 14 * DAY);
  if (end < now) end = now;
  if (+end - +start > 120 * DAY) start = new Date(+end - 120 * DAY);
  const n = Math.max(Math.ceil((+end - +start) / DAY), 1);
  const total = tasks.length;
  const burndown = Array.from({ length: n + 1 }, (_, i) => {
    const day = new Date(+start + i * DAY);
    const eod = endOfDay(day);
    const future = eod > endOfDay(now);
    const added = tasks.filter((t) => new Date(t.createdAt) <= eod).length;
    const finished = tasks.filter((t) => isDone(t) && new Date(t.updatedAt) <= eod).length;
    return { date: dayKey(day), remaining: future ? null : added - finished, ideal: Math.max(Math.round(total * (1 - i / n) * 10) / 10, 0) };
  });

  const trend = Array.from({ length: 14 }, (_, i) => {
    const day = new Date(+now - (13 - i) * DAY);
    const k = dayKey(day);
    return {
      date: k,
      created: tasks.filter((t) => dayKey(new Date(t.createdAt)) === k).length,
      completed: tasks.filter((t) => isDone(t) && dayKey(new Date(t.updatedAt)) === k).length,
    };
  });

  const timeByUser = await TimeEntry.aggregate([
    { $match: { projectId: p._id } },
    { $group: { _id: "$userId", minutes: { $sum: "$minutes" }, billable: { $sum: { $cond: ["$billable", "$minutes", 0] } } } },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    { $project: { minutes: 1, billable: 1, name: "$user.name" } },
    { $sort: { minutes: -1 } },
  ]);

  const doneTasks = tasks.filter(isDone);
  const avgDays = doneTasks.length ? doneTasks.reduce((a, t) => a + (+new Date(t.updatedAt) - +new Date(t.createdAt)) / DAY, 0) / doneTasks.length : 0;

  return sendSuccess(
    res, 200,
    {
      summary: {
        total, done: doneTasks.length, overdue: tasks.filter(isOverdue).length,
        completionRate: total ? Math.round((doneTasks.length / total) * 100) : 0,
        estimatedMinutes: tasks.reduce((a, t) => a + (t.estimatedMinutes || 0), 0),
        loggedMinutes: tasks.reduce((a, t) => a + (t.actualMinutes || 0), 0),
        avgCompletionDays: Math.round(avgDays * 10) / 10,
      },
      statusCounts: count("status"), priorityCounts: count("priority"),
      workload: [...wl.values()].sort((a, b) => b.open - a.open), burndown, trend, timeByUser,
    },
    "reports"
  );
});