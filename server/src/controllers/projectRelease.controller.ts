import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { makeCrud } from "../utils/projectCrud";
import { PReq, fail } from "../utils/projectAccess";
import { Task } from "../models/Task";
import { Release } from "../models/ProjectExtras";
import { getName, logActivity, projectRecipients, sendToUsers } from "../services/projectEvents";
import { buildChangelog, stampFixVersion } from "../services/releaseOps";
import { buildProjectUrl, releaseEmail } from "../utils/projectEmailTemplates";

const url = (r: PReq) => buildProjectUrl(String(r.project.workspaceId), String(r.project._id), "releases");
const actor = (r: PReq) => r.user!.id;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const doneTasks = (releaseId: unknown) =>
  Task.find({ releaseId, status: "Done", parentTaskId: { $exists: false } }).select("title taskNumber type").sort({ taskNumber: 1 }).lean();

async function assertUniqueName(r: PReq, name: string, exceptId?: string) {
  const clash = await Release.exists({ projectId: r.project._id, name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (clash) throw ApiError.badRequest(`A release named "${name}" already exists in this project`);
}

/* create / update / delete (list is custom below) */
export const releaseCrud = makeCrud({
  model: Release,
  entity: "release",
  fields: ["name", "description", "plannedDate"],
  beforeCreate: async (r, d) => {
    d.name = String(d.name || "").trim();
    if (!d.name) throw ApiError.badRequest("Release name is required");
    await assertUniqueName(r, d.name);
    d.status = "Planned";
  },
  beforeUpdate: async (r, d, doc) => {
    if ("name" in d) {
      d.name = String(d.name || "").trim();
      if (!d.name) throw ApiError.badRequest("Release name is required");
      if (d.name !== doc.name) await assertUniqueName(r, d.name, String(doc._id));
    }
    if ("plannedDate" in d) {
      d.dueSoonSentAt = null;
      d.overdueSentAt = null;
    }
  },
  afterCreate: async (r, doc) => {
    const byName = await getName(actor(r));
    void sendToUsers(projectRecipients(r.project), actor(r), () =>
      releaseEmail({ kind: "planned", projectName: r.project.name, name: doc.name, plannedDate: doc.plannedDate, byName, url: url(r) })
    );
  },
  afterDelete: async (_r, doc) => {
    await Task.updateMany({ releaseId: doc._id }, { $unset: { releaseId: 1 } });
  },
});

/* list with progress + the tasks of each release */
export const listReleases = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const [releases, tasks]: [any[], any[]] = await Promise.all([
    Release.find({ projectId: r.project._id }).lean(),
    Task.find({ projectId: r.project._id, releaseId: { $ne: null }, parentTaskId: { $exists: false } })
      .select("releaseId status type title taskNumber")
      .sort({ taskNumber: 1 })
      .lean() as any,
  ]);

  const byRelease = new Map<string, any[]>();
  tasks.forEach((t) => byRelease.set(String(t.releaseId), [...(byRelease.get(String(t.releaseId)) || []), t]));

  const out = releases.map((rel) => {
    const ts = byRelease.get(String(rel._id)) || [];
    const done = ts.filter((t) => t.status === "Done");
    return {
      ...rel,
      tasks: ts.map((t) => ({ _id: t._id, title: t.title, taskNumber: t.taskNumber, type: t.type || "Task", status: t.status })),
      stats: {
        total: ts.length,
        done: done.length,
        open: ts.length - done.length,
        bugs: done.filter((t) => t.type === "Bug").length,
        features: done.filter((t) => t.type === "Feature").length,
        improvements: done.filter((t) => t.type === "Improvement").length,
        progress: ts.length ? Math.round((done.length / ts.length) * 100) : 0,
      },
    };
  });

  // Planned first (earliest date first), then Released (newest first)
  const time = (v?: Date) => (v ? +new Date(v) : 8.64e15);
  out.sort((a, b) =>
    a.status !== b.status
      ? a.status === "Planned" ? -1 : 1
      : a.status === "Planned" ? time(a.plannedDate) - time(b.plannedDate) : time(b.releasedAt) - time(a.releasedAt)
  );
  return sendSuccess(res, 200, out, "releases");
});

/* add / remove tasks: body { add: [taskId], remove: [taskId] } */
export const setReleaseTasks = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const rel = await Release.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!rel) throw ApiError.notFound("Release not found");

  const add = ids(req.body.add).length
    ? (await Task.find({ _id: { $in: ids(req.body.add) }, projectId: r.project._id }).distinct("_id")).map(String)
    : [];
  if (add.length) await Task.updateMany({ _id: { $in: add } }, { releaseId: rel._id });
  const remove = ids(req.body.remove);
  if (remove.length) await Task.updateMany({ _id: { $in: remove }, releaseId: rel._id }, { $unset: { releaseId: 1 } });
  if (rel.status === "Released" && add.length) await stampFixVersion(rel, add);

  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: actor(r), action: "release_tasks_updated", entity: "release", metadata: { title: rel.name, added: add.length, removed: remove.length } });
  return sendSuccess(res, 200, { added: add.length, removed: remove.length }, "Release updated");
});

/* "Put all finished tasks that are in no release into this one" */
export const addDoneTasks = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const rel = await Release.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!rel) throw ApiError.notFound("Release not found");
  const found: any[] = await Task.find({
    projectId: r.project._id,
    status: "Done",
    parentTaskId: { $exists: false },
    $or: [{ releaseId: { $exists: false } }, { releaseId: null }],
  }).select("_id").lean();
  const taskIds = found.map((t) => String(t._id));
  if (taskIds.length) await Task.updateMany({ _id: { $in: taskIds } }, { releaseId: rel._id });
  if (rel.status === "Released" && taskIds.length) await stampFixVersion(rel, taskIds);
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: actor(r), action: "release_tasks_updated", entity: "release", metadata: { title: rel.name, added: taskIds.length } });
  return sendSuccess(res, 200, { added: taskIds.length }, `${taskIds.length} finished task(s) added`);
});

/* publish: body { moveOpenTo: "unlink" | <plannedReleaseId> } decides what happens to unfinished tasks */
export const publishRelease = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const rel = await Release.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!rel) throw ApiError.notFound("Release not found");
  if (rel.status === "Released") return fail(res, "This release is already published");

  const open: any[] = await Task.find({ releaseId: rel._id, status: { $ne: "Done" }, parentTaskId: { $exists: false } }).select("_id").lean();
  if (open.length) {
    const target = req.body.moveOpenTo && req.body.moveOpenTo !== "unlink"
      ? await Release.findOne({ _id: req.body.moveOpenTo, projectId: r.project._id, status: "Planned" })
      : null;
    const openIds = open.map((t) => t._id);
    if (target) await Task.updateMany({ _id: { $in: openIds } }, { releaseId: target._id });
    else await Task.updateMany({ _id: { $in: openIds } }, { $unset: { releaseId: 1 } });
  }

  rel.status = "Released";
  rel.releasedAt = new Date();
  rel.releasedBy = actor(r);
  await rel.save();
  await stampFixVersion(rel);

  const changelog = buildChangelog(rel.toObject(), (await doneTasks(rel._id)) as any[]);
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: actor(r), action: "release_published", entity: "release", metadata: { title: rel.name, shipped: changelog.counts.total, movedOrUnlinked: open.length } });

  const byName = await getName(actor(r));
  void sendToUsers([...projectRecipients(r.project)], actor(r), () =>
    releaseEmail({ kind: "published", projectName: r.project.name, name: rel.name, byName, summary: changelog.summary || "No completed changes were attached to this release.", url: url(r) })
  );
  return sendSuccess(res, 200, { release: rel, changelog }, "Release published");
});

/* back to Planned (e.g. published by mistake) */
export const reopenRelease = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const rel = await Release.findOne({ _id: req.params.itemId, projectId: r.project._id });
  if (!rel) throw ApiError.notFound("Release not found");
  if (rel.status !== "Released") return fail(res, "Only published releases can be reopened");
  rel.status = "Planned";
  rel.releasedAt = undefined;
  rel.releasedBy = undefined;
  await rel.save();
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: actor(r), action: "release_reopened", entity: "release", metadata: { title: rel.name } });
  return sendSuccess(res, 200, rel, "Release reopened");
});

export const getChangelog = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const rel = await Release.findOne({ _id: req.params.itemId, projectId: r.project._id }).lean();
  if (!rel) throw ApiError.notFound("Release not found");
  const { markdown, groups, counts } = buildChangelog(rel, (await doneTasks((rel as any)._id)) as any[]);
  return sendSuccess(res, 200, { markdown, groups, counts }, "changelog");
});