import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requirePermission } from "../middleware/workspaceRole";
import { workspaceFromDoc } from "../middleware/resourceAccess";
import { createMeeting, deleteMeeting, emailInvite, endMeeting, getMeeting, joinMeeting, listMeetings, lookup, updateMeeting } from "../controllers/meeting.controller";

const router = Router();

/* ---- the public link (no login needed for "anyone with the link" meetings; every rule is checked inside) ---- */
router.get("/public/lookup/:code", lookup);
router.post("/public/join/:code", joinMeeting);

/* ---- inside the workspace ---- */
router.use(requireAuth);
const W = "/workspace/:workspaceId";
router.get(W, loadWorkspaceRole, requirePermission("meetings.view"), listMeetings);
router.post(W, loadWorkspaceRole, requirePermission("meetings.create"), createMeeting);

// the host or somebody with "manage" is checked inside
const one = [workspaceFromDoc("Meeting", "meetingId"), requirePermission("meetings.view")];
router.get("/:meetingId", ...one, getMeeting);
router.patch("/:meetingId", ...one, updateMeeting);
router.post("/:meetingId/end", ...one, endMeeting);
router.post("/:meetingId/email-invite", ...one, requirePermission("meetings.create"), emailInvite);
router.delete("/:meetingId", ...one, deleteMeeting);

export default router;