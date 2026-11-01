import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../middleware/workspaceRole";
import { projectAccess } from "../utils/projectAccess";
import { projectFromBody, projectFromDoc } from "../middleware/resourceAccess";
import { createMilestone, listMilestones, updateMilestone, deleteMilestone } from "../controllers/milestone.controller";

const router = Router();
router.use(requireAuth);

// every milestone belongs to a project: the project's access rules (private, "only my projects") apply too
router.post("/", projectFromBody, projectAccess("MEMBER"), requirePermission("milestones.edit"), createMilestone);
router.get("/project/:projectId", projectAccess("VIEWER"), requirePermission("milestones.view"), listMilestones);
router.patch("/:milestoneId", projectFromDoc("Milestone", "milestoneId"), projectAccess("MEMBER"), requirePermission("milestones.edit"), updateMilestone);
router.delete("/:milestoneId", projectFromDoc("Milestone", "milestoneId"), projectAccess("MEMBER"), requirePermission("milestones.delete"), deleteMilestone);

export default router;