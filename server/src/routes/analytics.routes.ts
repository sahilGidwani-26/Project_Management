import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireAnyPermission, requirePermission } from "../middleware/workspaceRole";
import { projectAccess } from "../utils/projectAccess";
import { workspaceAnalytics, projectAnalytics, teamWorkload, projectHealth, activityTimeline } from "../controllers/analytics.controller";
import { workspaceForecast } from "../controllers/projectForecast.controller";
import { reportExport, reportMeta, reportSection } from "../controllers/analyticsReport.controller";

const router = Router();
router.use(requireAuth);

router.get("/workspace/:workspaceId", loadWorkspaceRole, requireAnyPermission("dashboard.view", "analytics.view"), workspaceAnalytics);
router.get("/workspace/:workspaceId/workload", loadWorkspaceRole, requirePermission("analytics.view"), teamWorkload);
router.get("/workspace/:workspaceId/activity", loadWorkspaceRole, requirePermission("dashboard.view"), activityTimeline);
router.get("/workspace/:workspaceId/forecast", loadWorkspaceRole, requirePermission("forecast.view"), workspaceForecast);
router.get("/project/:projectId", projectAccess("VIEWER"), requirePermission("projects.view"), projectAnalytics);
router.get("/project/:projectId/health", projectAccess("VIEWER"), requirePermission("projects.view"), projectHealth);
// the report system: every section checks its own permissions inside
router.get("/workspace/:workspaceId/reports/meta", loadWorkspaceRole, requireAnyPermission("analytics.view", "attendance.team"), reportMeta);
router.get("/workspace/:workspaceId/reports/section", loadWorkspaceRole, requireAnyPermission("analytics.view", "attendance.team"), reportSection);
router.get("/workspace/:workspaceId/reports/export", loadWorkspaceRole, requireAnyPermission("analytics.view", "attendance.team"), reportExport);

export default router;