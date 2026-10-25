import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requirePermission } from "../middleware/workspaceRole";
import { myStandup, saveNote, emailMe, getPrefs, patchPrefs } from "../controllers/standup.controller";

const router = Router();
router.use(requireAuth);

router.get("/workspace/:workspaceId/me", loadWorkspaceRole, requirePermission("standup.view"), myStandup);
router.put("/workspace/:workspaceId/note", loadWorkspaceRole, requirePermission("standup.view"), saveNote);
router.post("/workspace/:workspaceId/email-me", loadWorkspaceRole, requirePermission("standup.view"), emailMe);
router.get("/preferences", getPrefs);
router.patch("/preferences", patchPrefs);

export default router;