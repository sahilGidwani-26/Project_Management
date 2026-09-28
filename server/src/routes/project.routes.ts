import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireWorkspaceRole } from "../middleware/workspaceRole";
import { loadProjectWorkspaceRole, MANAGERS_ONLY } from "../middleware/taskAccess";
import { validate } from "../middleware/validate";
import { createProjectSchema } from "../validations/project.validation";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  archiveProject,
  deleteProject,
} from "../controllers/project.controller";

const router = Router();
router.use(requireAuth);

router.post(
  "/",
  validate(createProjectSchema),
  loadWorkspaceRole,
  requireWorkspaceRole(...MANAGERS_ONLY),
  createProject
);
// Reading projects is open to every workspace member, Viewers included.
router.get("/workspace/:workspaceId", loadWorkspaceRole, listProjects);
router.get("/:projectId", getProject);

router.patch("/:projectId", loadProjectWorkspaceRole, requireWorkspaceRole(...MANAGERS_ONLY), updateProject);
router.post("/:projectId/archive", loadProjectWorkspaceRole, requireWorkspaceRole(...MANAGERS_ONLY), archiveProject);
router.delete("/:projectId", loadProjectWorkspaceRole, requireWorkspaceRole("OWNER", "ADMIN"), deleteProject);

export default router;
