import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError";
import { catchAsync } from "../utils/catchAsync";
import { WorkspaceRole } from "../models/WorkspaceMember";
import { PERM_LABELS, getAccess } from "../services/permissions";

/**
 * Loads the requester's access for req.params.workspaceId (or req.body.workspaceId).
 * Sets req.workspaceRole (the old built-in role) and req.access (the real permissions).
 * Backend is the source of truth for permissions -- frontend checks are UX only.
 */
export const loadWorkspaceRole = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const workspaceId = req.params.workspaceId || req.body.workspaceId;
  if (!workspaceId) throw ApiError.badRequest("workspaceId is required");

  const access = await getAccess(workspaceId, req.user!.id);
  if (!access) throw ApiError.forbidden("You are not a member of this workspace");

  req.workspaceRole = access.legacyRole;
  req.access = access;
  next();
});

export function requireWorkspaceRole(...allowed: WorkspaceRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.workspaceRole || !allowed.includes(req.workspaceRole as WorkspaceRole)) {
      return next(ApiError.forbidden("You do not have permission to perform this action"));
    }
    next();
  };
}

const deny = (missing: string) => ApiError.forbidden(`You do not have permission to do this (${PERM_LABELS.get(missing) || missing})`);

/** Needs ALL of the listed permissions. Run after loadWorkspaceRole (or any loader that sets req.access). */
export function requirePermission(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const a = req.access;
    if (!a) return next(ApiError.forbidden("You do not have permission to perform this action"));
    const missing = perms.find((p) => !a.perms.has(p));
    if (missing) return next(deny(missing));
    next();
  };
}

/** Needs AT LEAST ONE of the listed permissions. */
export function requireAnyPermission(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const a = req.access;
    if (!a || !perms.some((p) => a.perms.has(p))) return next(deny(perms[0]));
    next();
  };
}