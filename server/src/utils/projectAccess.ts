import { Request, Response, NextFunction } from "express";
import { Project, IProject, ProjectRole } from "../models/Project";
import { AccessCtx, getAccess } from "../services/permissions";

export type PReq = Request & { project: IProject; projectRole: ProjectRole };

const RANK: Record<ProjectRole, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3 };
export const WORKSPACE_MANAGERS = ["OWNER", "ADMIN", "PROJECT_MANAGER"];

export const fail = (res: Response, message: string, code = 400) => res.status(code).json({ success: false, message });

/**
 * Effective role of a user inside one project:
 *  - role limited to "projects I am in" and not in this project => no access
 *  - workspace OWNER / ADMIN / PROJECT_MANAGER (built-in base role), project manager and creator => ADMIN
 *  - explicit per-project role => that role
 *  - listed member => MEMBER (VIEWER if workspace role is VIEWER)
 *  - public project => any workspace member gets MEMBER (VIEWER for workspace viewers)
 *  - private project and not a member => no access (null)
 */
export async function resolveProjectRole(project: IProject, userId: string, access?: AccessCtx | null): Promise<ProjectRole | null> {
  const a = access ?? (await getAccess(project.workspaceId, userId));
  if (!a) return null;

  const isInProject =
    String(project.managerId) === userId ||
    String(project.createdBy) === userId ||
    project.memberRoles.some((m) => String(m.userId) === userId) ||
    project.members.some((m) => String(m) === userId);
  if (a.scope === "member" && !a.isOwner && !isInProject) return null;

  if (WORKSPACE_MANAGERS.includes(a.legacyRole)) return "ADMIN";
  if (String(project.managerId) === userId || String(project.createdBy) === userId) return "ADMIN";
  const explicit = project.memberRoles.find((m) => String(m.userId) === userId);
  if (explicit) return explicit.role;
  if (isInProject || project.visibility === "public") return a.legacyRole === "VIEWER" ? "VIEWER" : "MEMBER";
  return null;
}

export const projectAccess = (min: ProjectRole = "VIEWER") => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.projectId;
    if (!/^[a-f\d]{24}$/i.test(id)) return fail(res, "Project not found", 404);
    const project = await Project.findById(id);
    if (!project) return fail(res, "Project not found", 404);
    const access = await getAccess(project.workspaceId, req.user!.id);
    const role = await resolveProjectRole(project, req.user!.id, access);
    if (!role) return fail(res, "You don't have access to this project", 403);
    if (RANK[role] < RANK[min]) return fail(res, "You don't have permission to do this in this project", 403);
    (req as PReq).project = project;
    (req as PReq).projectRole = role;
    req.access = access!;
    req.workspaceRole = access!.legacyRole;
    next();
  } catch (e) {
    next(e);
  }
};