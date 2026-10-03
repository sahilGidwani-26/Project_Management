import { Request, Response, NextFunction } from "express";
import { Project, IProject, ProjectRole } from "../models/Project";
// ASSUMPTION: apne workspace-membership model ka naam/path yahan set karo.
import { WorkspaceMember } from "../models/WorkspaceMember";

export type PReq = Request & { project: IProject; projectRole: ProjectRole };

const RANK: Record<ProjectRole, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3 };
export const WORKSPACE_MANAGERS = ["OWNER", "ADMIN", "PROJECT_MANAGER"];

export const fail = (res: Response, message: string, code = 400) => res.status(code).json({ success: false, message });

export async function resolveProjectRole(project: IProject, userId: string): Promise<ProjectRole | null> {
  const wm: any = await WorkspaceMember.findOne({ workspaceId: project.workspaceId, userId }).select("role");
  if (!wm) return null;
  if (WORKSPACE_MANAGERS.includes(wm.role)) return "ADMIN";
  if (String(project.managerId) === userId || String(project.createdBy) === userId) return "ADMIN";
  const explicit = project.memberRoles.find((m) => String(m.userId) === userId);
  if (explicit) return explicit.role;
  const isMember = project.members.some((m) => String(m) === userId);
  if (isMember || project.visibility === "public") return wm.role === "VIEWER" ? "VIEWER" : "MEMBER";
  return null;
}

export const projectAccess = (min: ProjectRole = "VIEWER") => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.projectId;
    if (!/^[a-f\d]{24}$/i.test(id)) return fail(res, "Project not found", 404);
    const project = await Project.findById(id);
    if (!project) return fail(res, "Project not found", 404);
    const role = await resolveProjectRole(project, req.user!.id);
    if (!role) return fail(res, "You don't have access to this project", 403);
    if (RANK[role] < RANK[min]) return fail(res, "You don't have permission to do this in this project", 403);
    (req as PReq).project = project;
    (req as PReq).projectRole = role;
    next();
  } catch (e) {
    next(e);
  }
};