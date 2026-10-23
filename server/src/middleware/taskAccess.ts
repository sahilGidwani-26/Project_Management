import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError";
import { catchAsync } from "../utils/catchAsync";
import { Task } from "../models/Task";
import { Project } from "../models/Project";
import { WorkspaceRole } from "../models/WorkspaceMember";
import { getAccess } from "../services/permissions";

export const NOT_VIEWER: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER"];
export const MANAGERS_ONLY: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER"];

/**
 * For routes identified by :taskId (not :workspaceId), this looks up the
 * task's workspace, then the requester's access in that workspace, and
 * attaches it to req.workspaceRole and req.access -- same contract as
 * loadWorkspaceRole, so requireWorkspaceRole / requirePermission work after this runs.
 */
export const loadTaskWorkspaceRole = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const task = await Task.findById(req.params.taskId).select("workspaceId");
  if (!task) throw ApiError.notFound("Task not found");

  const access = await getAccess(task.workspaceId, req.user!.id);
  if (!access) throw ApiError.forbidden("You are not a member of this workspace");

  req.workspaceRole = access.legacyRole;
  req.access = access;
  next();
});

/** Same pattern, resolved through a Project's workspaceId for :projectId routes. */
export const loadProjectWorkspaceRole = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const project = await Project.findById(req.params.projectId).select("workspaceId");
  if (!project) throw ApiError.notFound("Project not found");

  const access = await getAccess(project.workspaceId, req.user!.id);
  if (!access) throw ApiError.forbidden("You are not a member of this workspace");

  req.workspaceRole = access.legacyRole;
  req.access = access;
  next();
});