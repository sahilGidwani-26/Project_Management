import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { loadWorkspaceRole, requireWorkspaceRole } from "../middleware/workspaceRole";
import { loadTaskWorkspaceRole, NOT_VIEWER, MANAGERS_ONLY } from "../middleware/taskAccess";
import { createTaskSchema, updateTaskStatusSchema } from "../validations/task.validation";
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  addSubtask,
  listSubtasks,
  addDependency,
  removeDependency,
  setRecurrence,
} from "../controllers/task.controller";

const router = Router();
router.use(requireAuth);

// Create needs workspaceId in the body -> resolve role from body/params directly.
router.post("/", validate(createTaskSchema), loadWorkspaceRole, requireWorkspaceRole(...NOT_VIEWER), createTask);

// Reading tasks/lists is open to every workspace member, Viewers included.
router.get("/", listTasks);
router.get("/:taskId", getTask);

router.patch("/:taskId", loadTaskWorkspaceRole, requireWorkspaceRole(...NOT_VIEWER), updateTask);
router.patch(
  "/:taskId/status",
  validate(updateTaskStatusSchema),
  loadTaskWorkspaceRole,
  requireWorkspaceRole(...NOT_VIEWER),
  updateTaskStatus
);
router.delete("/:taskId", loadTaskWorkspaceRole, requireWorkspaceRole(...MANAGERS_ONLY), deleteTask);

router.post("/:taskId/subtasks", loadTaskWorkspaceRole, requireWorkspaceRole(...NOT_VIEWER), addSubtask);
router.get("/:taskId/subtasks", listSubtasks);

router.post("/:taskId/dependencies", loadTaskWorkspaceRole, requireWorkspaceRole(...MANAGERS_ONLY), addDependency);
router.delete(
  "/:taskId/dependencies/:dependsOnTaskId",
  loadTaskWorkspaceRole,
  requireWorkspaceRole(...MANAGERS_ONLY),
  removeDependency
);
router.patch("/:taskId/recurrence", loadTaskWorkspaceRole, requireWorkspaceRole(...MANAGERS_ONLY), setRecurrence);

export default router;
