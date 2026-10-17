import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { myStandup, saveNote, emailMe, getPrefs, patchPrefs } from "../controllers/standup.controller";

const router = Router();
router.use(requireAuth);

router.get("/workspace/:workspaceId/me", myStandup);
router.put("/workspace/:workspaceId/note", saveNote);
router.post("/workspace/:workspaceId/email-me", emailMe);
router.get("/preferences", getPrefs);
router.patch("/preferences", patchPrefs);

export default router;