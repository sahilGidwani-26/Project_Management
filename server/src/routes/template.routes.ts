import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requirePermission } from "../middleware/workspaceRole";
import { workspaceFromDoc } from "../middleware/resourceAccess";
import {
  createTemplate,
  listTemplates,
  deleteTemplate,
  createProjectFromTemplate,
} from "../controllers/template.controller";

const router = Router();
router.use(requireAuth);

router.post("/", loadWorkspaceRole, requirePermission("projects.templates"), createTemplate);
router.get("/workspace/:workspaceId", loadWorkspaceRole, requirePermission("projects.create"), listTemplates);
router.delete("/:templateId", workspaceFromDoc("ProjectTemplate", "templateId"), requirePermission("projects.templates"), deleteTemplate);
router.post("/:templateId/create-project", workspaceFromDoc("ProjectTemplate", "templateId"), requirePermission("projects.create"), createProjectFromTemplate);

export default router;