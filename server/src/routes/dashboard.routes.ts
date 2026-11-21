import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requirePermission } from "../middleware/workspaceRole";
import { getLayout, overview, resetLayout, saveLayout } from "../controllers/dashboard.controller";

const router = Router();
router.use(requireAuth);

const W = "/workspace/:workspaceId";
router.get(`${W}/overview`, loadWorkspaceRole, requirePermission("dashboard.view"), overview);

// a layout is the person's own, so being in the workspace is enough
router.get(`${W}/layout`, loadWorkspaceRole, getLayout);
router.put(`${W}/layout`, loadWorkspaceRole, saveLayout);
router.delete(`${W}/layout`, loadWorkspaceRole, resetLayout);

export default router;