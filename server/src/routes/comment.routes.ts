import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadTaskWorkspaceRole, loadCommentWorkspaceRole, noProjectViewer } from "../middleware/taskAccess";
import { requireAnyPermission, requirePermission } from "../middleware/workspaceRole";
import { listComments, addComment, updateComment, deleteComment } from "../controllers/comment.controller";

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get("/:taskId/comments", loadTaskWorkspaceRole, requireAnyPermission("tasks.view", "bugs.view"), listComments);
router.post("/:taskId/comments", loadTaskWorkspaceRole, noProjectViewer, requirePermission("tasks.comment"), addComment);
router.patch("/comments/:commentId", loadCommentWorkspaceRole, noProjectViewer, requirePermission("tasks.comment"), updateComment);
router.delete("/comments/:commentId", loadCommentWorkspaceRole, noProjectViewer, requirePermission("tasks.comment"), deleteComment);

export default router;