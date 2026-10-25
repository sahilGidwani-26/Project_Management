import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { loadWorkspaceRole, requireAnyPermission, requirePermission } from "../middleware/workspaceRole";
import { loadTaskWorkspaceRole, noProjectViewer } from "../middleware/taskAccess";
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
import { getTaskGithub } from "../controllers/projectGithub.controller";

const router = Router();
router.use(requireAuth);

// A Bug is checked against the Bugs permissions and any other task against the Tasks permissions.
// The route lets either one through, the controller then checks the right one for the task's type.
const view = requireAnyPermission("tasks.view", "bugs.view");
const edit = requireAnyPermission("tasks.edit", "bugs.edit");

// Create needs workspaceId in the body -> role is resolved from the body.
router.post("/", validate(createTaskSchema), loadWorkspaceRole, requireAnyPermission("tasks.create", "bugs.create"), createTask);

// The list checks the workspace, project, private-project and "only my projects" rules itself.
router.get("/", listTasks);
router.get("/:taskId", loadTaskWorkspaceRole, view, getTask);
router.get("/:taskId/github", loadTaskWorkspaceRole, requirePermission("github.view"), getTaskGithub);
router.get("/:taskId/subtasks", loadTaskWorkspaceRole, view, listSubtasks);

router.patch("/:taskId", loadTaskWorkspaceRole, noProjectViewer, edit, updateTask);
router.patch("/:taskId/status", validate(updateTaskStatusSchema), loadTaskWorkspaceRole, noProjectViewer, edit, updateTaskStatus);
router.delete("/:taskId", loadTaskWorkspaceRole, noProjectViewer, requireAnyPermission("tasks.delete", "bugs.delete"), deleteTask);

router.post("/:taskId/subtasks", loadTaskWorkspaceRole, noProjectViewer, requirePermission("tasks.create"), addSubtask);

router.post("/:taskId/dependencies", loadTaskWorkspaceRole, noProjectViewer, requirePermission("timeline.edit"), addDependency);
router.delete("/:taskId/dependencies/:dependsOnTaskId", loadTaskWorkspaceRole, noProjectViewer, requirePermission("timeline.edit"), removeDependency);
router.patch("/:taskId/recurrence", loadTaskWorkspaceRole, noProjectViewer, requirePermission("automation.edit"), setRecurrence);

export default router;