import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireAnyPermission } from "../middleware/workspaceRole";
import { globalSearch } from "../controllers/search.controller";

const router = Router();
router.use(requireAuth);

router.get("/workspace/:workspaceId", loadWorkspaceRole, requireAnyPermission("projects.view", "tasks.view", "bugs.view", "people.view"), globalSearch);

export default router;