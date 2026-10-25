import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireAnyPermission, requirePermission } from "../middleware/workspaceRole";
import { projectAccess } from "../utils/projectAccess";
import { workspaceAnalytics, projectAnalytics, teamWorkload, projectHealth, activityTimeline } from "../controllers/analytics.controller";
import { workspaceForecast } from "../controllers/projectForecast.controller";

const router = Router();
router.use(requireAuth);

router.get("/workspace/:workspaceId", loadWorkspaceRole, requireAnyPermission("dashboard.view", "analytics.view"), workspaceAnalytics);
router.get("/workspace/:workspaceId/workload", loadWorkspaceRole, requirePermission("analytics.view"), teamWorkload);
router.get("/workspace/:workspaceId/activity", loadWorkspaceRole, requirePermission("dashboard.view"), activityTimeline);
router.get("/workspace/:workspaceId/forecast", loadWorkspaceRole, requirePermission("forecast.view"), workspaceForecast);
router.get("/project/:projectId", projectAccess("VIEWER"), requirePermission("projects.view"), projectAnalytics);
router.get("/project/:projectId/health", projectAccess("VIEWER"), requirePermission("projects.view"), projectHealth);

export default router;