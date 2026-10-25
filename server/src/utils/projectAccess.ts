import { Request, Response, NextFunction } from "express";
import { Project, IProject, ProjectRole } from "../models/Project";
import { AccessCtx, getAccess, isManagerLevel } from "../services/permissions";

export type PReq = Request & { project: IProject; projectRole: ProjectRole };

const RANK: Record<ProjectRole, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3 };
export const WORKSPACE_MANAGERS = ["OWNER", "ADMIN", "PROJECT_MANAGER"];

export const fail = (res: Response, message: string, code = 400) => res.status(code).json({ success: false, message });

export const isInProject = (project: IProject, userId: string) =>
  String(project.managerId) === userId ||
  String(project.createdBy) === userId ||
  project.memberRoles.some((m) => String(m.userId) === userId) ||
  project.members.some((m) => String(m) === userId);

/**
 * Can this person open this project, and as what?
 *  - a role limited to "projects I am in" never sees other projects
 *  - Owner / Admin / Project Manager level people, the project's manager and its creator => ADMIN
 *  - an explicit per-project role (Members tab) => that role (a project "Viewer" stays read-only)
 *  - listed members and, for public projects, everybody else in the workspace => MEMBER
 *  - private project and not in it => no access (null)
 * What the person may DO is decided by their role's permissions (requirePermission), not by this.
 */
export async function resolveProjectRole(project: IProject, userId: string, access?: AccessCtx | null): Promise<ProjectRole | null> {
  const a = access ?? (await getAccess(project.workspaceId, userId));
  if (!a) return null;

  const inProject = isInProject(project, userId);
  if (a.scope === "member" && !a.isOwner && !inProject) return null;

  if (isManagerLevel(a) || String(project.managerId) === userId || String(project.createdBy) === userId) return "ADMIN";
  const explicit = project.memberRoles.find((m) => String(m.userId) === userId);
  if (explicit) return explicit.role;
  if (inProject || project.visibility === "public") return "MEMBER";
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
    if (RANK[role] < RANK[min]) return fail(res, "You have view-only access in this project", 403);
    (req as PReq).project = project;
    (req as PReq).projectRole = role;
    req.access = access!;
    req.workspaceRole = access!.legacyRole;
    next();
  } catch (e) {
    next(e);
  }
};