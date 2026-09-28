import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadTaskWorkspaceRole, NOT_VIEWER } from "../middleware/taskAccess";
import { requireWorkspaceRole } from "../middleware/workspaceRole";
import { listComments, addComment, updateComment, deleteComment } from "../controllers/comment.controller";

const router = Router({ mergeParams: true });
router.use(requireAuth);

// Anyone in the workspace (Viewers included) can read comments.
router.get("/:taskId/comments", listComments);
router.post("/:taskId/comments", loadTaskWorkspaceRole, requireWorkspaceRole(...NOT_VIEWER), addComment);
router.patch("/comments/:commentId", updateComment);
router.delete("/comments/:commentId", deleteComment);

export default router;
