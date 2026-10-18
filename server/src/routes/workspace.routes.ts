import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireWorkspaceRole } from "../middleware/workspaceRole";
import { validate } from "../middleware/validate";
import { createWorkspaceSchema, inviteMemberSchema } from "../validations/workspace.validation";
import { createMemberSchema, updateMemberSchema } from "../validations/people.validation";
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

const router = Router();

router.use(requireAuth);

const admins = requireWorkspaceRole("OWNER", "ADMIN");

router.post("/", validate(createWorkspaceSchema), createWorkspace);
router.get("/", listMyWorkspaces);
router.post("/invitations/:token/accept", acceptInvitation);

router.get("/:workspaceId", loadWorkspaceRole, getWorkspace);
router.patch("/:workspaceId", loadWorkspaceRole, admins, updateWorkspace);
router.delete("/:workspaceId", loadWorkspaceRole, requireWorkspaceRole("OWNER"), deleteWorkspace);

/* ---- members ---- */
router.get("/:workspaceId/members", loadWorkspaceRole, listMembers);
router.post("/:workspaceId/members", validate(createMemberSchema), loadWorkspaceRole, admins, createMember);
router.get("/:workspaceId/members/:memberId", loadWorkspaceRole, getMember);
router.get("/:workspaceId/members/:memberId/progress", loadWorkspaceRole, memberProgress);
// PATCH: admins can change anything, a person can edit their own profile; the controller enforces who may do what
router.patch("/:workspaceId/members/:memberId", validate(updateMemberSchema), loadWorkspaceRole, updateMember);
router.post("/:workspaceId/members/:memberId/deactivate", loadWorkspaceRole, admins, deactivateMember);
router.post("/:workspaceId/members/:memberId/reactivate", loadWorkspaceRole, admins, reactivateMember);
router.post("/:workspaceId/members/:memberId/resend-credentials", loadWorkspaceRole, admins, resendCredentials);
router.delete("/:workspaceId/members/:memberId", loadWorkspaceRole, admins, removeMember);

/* ---- invitations ---- */
router.get("/:workspaceId/invitations", loadWorkspaceRole, admins, listInvitations);
router.post("/:workspaceId/invitations", validate(inviteMemberSchema), loadWorkspaceRole, admins, inviteMember);
router.post("/:workspaceId/invitations/:invitationId/resend", loadWorkspaceRole, admins, resendInvitation);
router.delete("/:workspaceId/invitations/:invitationId", loadWorkspaceRole, admins, cancelInvitation);

export default router;