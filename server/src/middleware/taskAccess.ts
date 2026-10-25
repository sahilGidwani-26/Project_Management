import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError";
import { catchAsync } from "../utils/catchAsync";
import { Task } from "../models/Task";
import { Project } from "../models/Project";
import { WorkspaceRole } from "../models/WorkspaceMember";
import { getAccess } from "../services/permissions";
import { resolveProjectRole } from "../utils/projectAccess";

export const NOT_VIEWER: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER"];
export const MANAGERS_ONLY: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER"];

/**
 * Loads the requester's access for the workspace a TASK belongs to, and checks they may open the task's project
 * (private projects, "only my projects" roles). Sets req.access / req.workspaceRole and (for project tasks) req.projectRole.
 */
async function attachTaskAccess(req: Request, taskId: string) {
  if (!/^[a-f\d]{24}$/i.test(String(taskId))) throw ApiError.notFound("Task not found");
  const task = await Task.findById(taskId).select("workspaceId projectId");
  if (!task) throw ApiError.notFound("Task not found");

  const access = await getAccess(task.workspaceId, req.user!.id);
  if (!access) throw ApiError.forbidden("You are not a member of this workspace");

  if (task.projectId) {
    const project = await Project.findById(task.projectId);
    if (project) {
      const role = await resolveProjectRole(project, req.user!.id, access);
      if (!role) throw ApiError.forbidden("You do not have access to this project");
      (req as any).projectRole = role;
    }
  }
  req.workspaceRole = access.legacyRole;
  req.access = access;
}

export const loadTaskWorkspaceRole = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  await attachTaskAccess(req, req.params.taskId);
  next();
});

/** Same, for /comments/:commentId routes (the comment is looked up to find its task). */
export const loadCommentWorkspaceRole = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const Comment: any = (mongoose.models as any).Comment; // by name, so this file does not depend on the model's path
  if (!Comment) {
    console.warn("[access] Comment model not found, comment routes are only protected by login");
    return next();
  }
  const c: any = await Comment.findById(req.params.commentId).select("taskId");
  if (!c) throw ApiError.notFound("Comment not found");
  await attachTaskAccess(req, String(c.taskId));
  next();
});

/** Blocks writes for somebody who was made a read-only "Viewer" of this task's project. */
export const noProjectViewer = (req: Request, _res: Response, next: NextFunction) => {
  if ((req as any).projectRole === "VIEWER") return next(ApiError.forbidden("You have view-only access in this project"));
  next();
};

/** Same pattern, resolved through a Project's workspaceId for :projectId routes. */
export const loadProjectWorkspaceRole = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) throw ApiError.notFound("Project not found");

  const access = await getAccess(project.workspaceId, req.user!.id);
  if (!access) throw ApiError.forbidden("You are not a member of this workspace");
  const role = await resolveProjectRole(project, req.user!.id, access);
  if (!role) throw ApiError.forbidden("You do not have access to this project");

  (req as any).projectRole = role;
  req.workspaceRole = access.legacyRole;
  req.access = access;
  next();
});