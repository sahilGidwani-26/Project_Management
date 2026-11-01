import fs from "fs";
import mongoose from "mongoose";
import { Request, RequestHandler } from "express";
import { ApiError } from "../utils/ApiError";
import { catchAsync } from "../utils/catchAsync";
import { Project } from "../models/Project";
import { PERM_LABELS, getAccess } from "../services/permissions";
import { resolveProjectRole } from "../utils/projectAccess";
import { attachTaskAccess } from "./taskAccess";

const OID = /^[a-f\d]{24}$/i;
const deny = (p: string) => ApiError.forbidden(`You do not have permission to do this (${PERM_LABELS.get(p) || p})`);

/** Models are looked up by name. If one is missing the request is refused (never silently allowed). */
function model(name: string): any {
  const m = (mongoose.models as any)[name];
  if (!m) throw ApiError.internal(`Access check unavailable: model ${name} not found`);
  return m;
}

/** For routes like /labels/:labelId: finds the workspace of the item and loads the person's access there. */
export const workspaceFromDoc = (modelName: string, param: string): RequestHandler =>
  catchAsync(async (req, _res, next) => {
    const id = req.params[param];
    if (!OID.test(id)) throw ApiError.notFound("Not found");
    const doc: any = await model(modelName).findById(id).select("workspaceId").lean();
    if (!doc) throw ApiError.notFound("Not found");
    const access = await getAccess(doc.workspaceId, req.user!.id);
    if (!access) throw ApiError.forbidden("You are not a member of this workspace");
    req.access = access;
    req.workspaceRole = access.legacyRole;
    next();
  });

/** For routes that send the project in the body: lets projectAccess() run afterwards. */
export const projectFromBody: RequestHandler = (req, _res, next) => {
  const id = String(req.body?.projectId || "");
  if (!OID.test(id)) return next(ApiError.badRequest("projectId is required"));
  req.params.projectId = id;
  next();
};

/** For routes like /milestones/:milestoneId: finds the item's project so projectAccess() can run afterwards. */
export const projectFromDoc = (modelName: string, param: string, field = "projectId"): RequestHandler =>
  catchAsync(async (req, _res, next) => {
    const id = req.params[param];
    if (!OID.test(id)) throw ApiError.notFound("Not found");
    const doc: any = await model(modelName).findById(id).select(field).lean();
    if (!doc || !doc[field]) throw ApiError.notFound("Not found");
    req.params.projectId = String(doc[field]);
    next();
  });

/* --------------------------------- chat --------------------------------- */

/** Loads access for the channel's workspace. Private channels and DMs are only open to their members. */
async function openChannel(req: Request, channelId: string) {
  if (!OID.test(channelId)) throw ApiError.notFound("Channel not found");
  const ch: any = await model("Channel").findById(channelId).select("workspaceId type isPrivate members").lean();
  if (!ch) throw ApiError.notFound("Channel not found");
  const access = await getAccess(ch.workspaceId, req.user!.id);
  if (!access) throw ApiError.forbidden("You are not a member of this workspace");
  const restricted = ch.type === "dm" || ch.isPrivate;
  if (restricted && !(ch.members || []).map(String).includes(req.user!.id)) throw ApiError.forbidden("You are not in this channel");
  req.access = access;
  req.workspaceRole = access.legacyRole;
}

export const channelGate = (perm: string): RequestHandler =>
  catchAsync(async (req, _res, next) => {
    await openChannel(req, req.params.channelId);
    if (!req.access!.perms.has(perm)) throw deny(perm);
    next();
  });

export const messageGate = (perm: string): RequestHandler =>
  catchAsync(async (req, _res, next) => {
    if (!OID.test(req.params.messageId)) throw ApiError.notFound("Message not found");
    const msg: any = await model("Message").findById(req.params.messageId).select("channelId").lean();
    if (!msg) throw ApiError.notFound("Message not found");
    await openChannel(req, String(msg.channelId));
    if (!req.access!.perms.has(perm)) throw deny(perm);
    next();
  });

/* ------------------------------ attachments ------------------------------ */

/**
 * Task / project attachments. Where the task or project id comes from: the body (upload, run AFTER multer), the query, or the attachment itself.
 * If the request is refused after a file was already saved by multer, that file is deleted again.
 */
export const attachmentGate = (perm: string, from: "body" | "query" | "doc"): RequestHandler => async (req, _res, next) => {
  try {
    let taskId: unknown;
    let projectId: unknown;
    if (from === "doc") {
      if (!OID.test(String(req.params.id))) throw ApiError.notFound("Attachment not found");
      const d: any = await model("Attachment").findById(req.params.id).select("taskId projectId").lean();
      if (!d) throw ApiError.notFound("Attachment not found");
      taskId = d.taskId;
      projectId = d.projectId;
    } else {
      const src: any = from === "body" ? req.body : req.query;
      taskId = src?.taskId;
      projectId = src?.projectId;
    }

    if (taskId) {
      await attachTaskAccess(req, String(taskId));
    } else if (projectId && OID.test(String(projectId))) {
      const project = await Project.findById(String(projectId));
      if (!project) throw ApiError.notFound("Project not found");
      const access = await getAccess(project.workspaceId, req.user!.id);
      if (!access) throw ApiError.forbidden("You are not a member of this workspace");
      const role = await resolveProjectRole(project, req.user!.id, access);
      if (!role) throw ApiError.forbidden("You do not have access to this project");
      (req as any).projectRole = role;
      req.access = access;
      req.workspaceRole = access.legacyRole;
    } else {
      throw ApiError.badRequest("taskId or projectId is required");
    }

    if (!perm.endsWith(".view") && (req as any).projectRole === "VIEWER") throw ApiError.forbidden("You have view-only access in this project");
    if (!req.access!.perms.has(perm)) throw deny(perm);
    next();
  } catch (e) {
    const f = (req as any).file;
    if (f?.path) fs.unlink(f.path, () => undefined);
    next(e);
  }
};