import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requirePermission } from "../middleware/workspaceRole";
import { workspaceFromDoc } from "../middleware/resourceAccess";
import { createLabel, listLabels, updateLabel, deleteLabel } from "../controllers/label.controller";

const router = Router();
router.use(requireAuth);

// labels belong to tasks: tasks.view to see them, tasks.edit to manage them
router.post("/", loadWorkspaceRole, requirePermission("tasks.edit"), createLabel);
router.get("/workspace/:workspaceId", loadWorkspaceRole, requirePermission("tasks.view"), listLabels);
router.patch("/:labelId", workspaceFromDoc("Label", "labelId"), requirePermission("tasks.edit"), updateLabel);
router.delete("/:labelId", workspaceFromDoc("Label", "labelId"), requirePermission("tasks.edit"), deleteLabel);

export default router;