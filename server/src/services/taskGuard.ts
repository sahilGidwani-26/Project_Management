import { Request } from "express";
import { ApiError } from "../utils/ApiError";
import { Project } from "../models/Project";
import { PERM_LABELS } from "./permissions";
import { resolveProjectRole } from "../utils/projectAccess";

const deny = (perm: string) => ApiError.forbidden(`You do not have permission to do this (${PERM_LABELS.get(perm) || perm})`);

/** A Bug is checked against the Bugs permissions, everything else against the Tasks permissions. */
export function assertCan(req: Request, task: { type?: string }, action: "view" | "create" | "edit" | "delete") {
  const perm = `${task?.type === "Bug" ? "bugs" : "tasks"}.${action}`;
  if (!req.access?.perms.has(perm)) throw deny(perm);
}

/** Giving a task to somebody else (or taking it from them) needs tasks.assign. Assigning yourself is always allowed. */
export function assertCanAssign(req: Request, changedUserIds: unknown, selfId: string) {
  const ids = Array.isArray(changedUserIds) ? changedUserIds.map(String) : [];
  if (ids.some((i) => i !== selfId) && !req.access?.perms.has("tasks.assign")) throw deny("tasks.assign");
}

/** The project must exist in this workspace, the person must be able to open it, and must not be a read-only viewer there. */
export async function assertProjectWritable(req: Request, projectId: string, workspaceId: string) {
  const project = await Project.findOne({ _id: projectId, workspaceId });
  if (!project) throw ApiError.badRequest("That project does not exist in this workspace");
  const role = await resolveProjectRole(project, req.user!.id, req.access);
  if (!role) throw ApiError.forbidden("You do not have access to that project");
  if (role === "VIEWER") throw ApiError.forbidden("You have view-only access in that project");
}