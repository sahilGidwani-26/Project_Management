import { RequestHandler, Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireAnyPermission, requirePermission } from "../middleware/workspaceRole";
import { validate } from "../middleware/validate";
import { createWorkspaceSchema, inviteMemberSchema } from "../validations/workspace.validation";
import { bulkImportSchema, createMemberSchema, updateMemberSchema } from "../validations/people.validation";
import {
  createWorkspace,
  listMyWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  listMembers,
  getMember,
  createMember,
  updateMember,
  deactivateMember,
  reactivateMember,
  removeMember,
  resendCredentials,
  memberProgress,
  listInvitations,
  inviteMember,
  resendInvitation,
  cancelInvitation,
  acceptInvitation,
} from "../controllers/workspace.controller";
import { addToProject, bulkImport, exportMembers, listDepartments, orgChart } from "../controllers/peopleBulk.controller";
import { assignableRoles, assignRole, createRole, deleteRole, getCatalog, listRoles, myPermissions, resetRole, updateRole } from "../controllers/roles.controller";

const router = Router();
router.use(requireAuth);

/** Loads the person's access in the workspace, then needs ALL the listed permissions. */
const need = (...perms: string[]): RequestHandler[] => [loadWorkspaceRole, requirePermission(...perms)];

router.post("/", validate(createWorkspaceSchema), createWorkspace);
router.get("/", listMyWorkspaces);
router.post("/invitations/:token/accept", acceptInvitation);

/* ---- roles & permissions ---- */
router.get("/:workspaceId/permissions/me", loadWorkspaceRole, myPermissions);
router.get("/:workspaceId/permissions/catalog", loadWorkspaceRole, getCatalog);
router.get("/:workspaceId/roles", ...need("roles.view"), listRoles);
router.get("/:workspaceId/roles/assignable", loadWorkspaceRole, requireAnyPermission("roles.assign", "people.invite"), assignableRoles);
router.post("/:workspaceId/roles", ...need("roles.manage"), createRole);
router.patch("/:workspaceId/roles/:roleId", ...need("roles.manage"), updateRole);
router.post("/:workspaceId/roles/:roleId/reset", ...need("roles.manage"), resetRole);
router.delete("/:workspaceId/roles/:roleId", ...need("roles.manage"), deleteRole);
router.put("/:workspaceId/members/:memberId/role", ...need("roles.assign"), assignRole);

/* ---- the workspace itself ---- */
router.get("/:workspaceId", loadWorkspaceRole, getWorkspace); // every member needs the workspace name
router.patch("/:workspaceId", ...need("workspace.edit"), updateWorkspace);
router.delete("/:workspaceId", ...need("workspace.delete"), deleteWorkspace);

/* ---- people overviews (fixed paths first, they must come before /members/:memberId) ---- */
router.get("/:workspaceId/departments", ...need("people.view"), listDepartments);
router.get("/:workspaceId/org-chart", ...need("people.view"), orgChart);

/* ---- members ---- */
router.get("/:workspaceId/members", ...need("people.view"), listMembers);
router.get("/:workspaceId/members/export", ...need("people.bulk"), exportMembers); // private columns need people.private (checked inside)
router.post("/:workspaceId/members/bulk-import", validate(bulkImportSchema), ...need("people.bulk", "people.invite"), bulkImport);
router.post("/:workspaceId/members/add-to-project", ...need("projects.members"), addToProject);
router.post("/:workspaceId/members", validate(createMemberSchema), ...need("people.invite"), createMember);
// one person: people.view OR your own profile (checked inside)
router.get("/:workspaceId/members/:memberId", loadWorkspaceRole, getMember);
// progress: people.progress OR your own (checked inside)
router.get("/:workspaceId/members/:memberId/progress", loadWorkspaceRole, memberProgress);
// profile: everybody edits their own limited fields, people.edit changes others (checked inside)
router.patch("/:workspaceId/members/:memberId", validate(updateMemberSchema), loadWorkspaceRole, updateMember);
router.post("/:workspaceId/members/:memberId/deactivate", ...need("people.deactivate"), deactivateMember);
router.post("/:workspaceId/members/:memberId/reactivate", ...need("people.deactivate"), reactivateMember);
router.post("/:workspaceId/members/:memberId/resend-credentials", ...need("people.invite"), resendCredentials);
router.delete("/:workspaceId/members/:memberId", ...need("people.deactivate"), removeMember);

/* ---- invitations ---- */
router.get("/:workspaceId/invitations", ...need("people.invite"), listInvitations);
router.post("/:workspaceId/invitations", validate(inviteMemberSchema), ...need("people.invite"), inviteMember);
router.post("/:workspaceId/invitations/:invitationId/resend", ...need("people.invite"), resendInvitation);
router.delete("/:workspaceId/invitations/:invitationId", ...need("people.invite"), cancelInvitation);

export default router;