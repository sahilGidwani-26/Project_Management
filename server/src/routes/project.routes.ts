import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireWorkspaceRole } from "../middleware/workspaceRole";
import { loadProjectWorkspaceRole, MANAGERS_ONLY } from "../middleware/taskAccess";
import { validate } from "../middleware/validate";
import { projectAccess } from "../utils/projectAccess";
import { bulkSchema, createProjectSchema, memberSchema, timeEntrySchema, updateProjectSchema } from "../validations/project.validation";
import * as core from "../controllers/project.controller";
import * as plan from "../controllers/projectPlanning.controller";
import * as collab from "../controllers/projectCollab.controller";

const router = Router();
router.use(requireAuth);

const view = projectAccess("VIEWER");
const edit = projectAccess("MEMBER");
const admin = projectAccess("ADMIN");

/* ---- workspace-level ---- */
router.post("/", validate(createProjectSchema), loadWorkspaceRole, requireWorkspaceRole(...MANAGERS_ONLY), core.createProject);
router.get("/workspace/:workspaceId", loadWorkspaceRole, core.listProjects);
router.get("/templates/:workspaceId", loadWorkspaceRole, core.listTemplates);
router.delete("/templates/:templateId", core.deleteTemplate);
router.post("/bulk/update", validate(bulkSchema), loadWorkspaceRole, requireWorkspaceRole(...MANAGERS_ONLY), core.bulkUpdate);
router.post("/bulk/delete", validate(bulkSchema), loadWorkspaceRole, requireWorkspaceRole("OWNER", "ADMIN"), core.bulkDelete);

/* ---- project ---- */
const P = "/:projectId";
router.get(P, view, core.getProject);
router.patch(P, validate(updateProjectSchema), admin, core.updateProject);
router.delete(P, loadProjectWorkspaceRole, requireWorkspaceRole("OWNER", "ADMIN"), admin, core.deleteProject);
router.post(`${P}/archive`, admin, core.archiveProject);
router.post(`${P}/restore`, admin, core.restoreProject);
router.post(`${P}/duplicate`, admin, core.duplicateProject);
router.post(`${P}/favorite`, view, core.toggleFavorite);
router.post(`${P}/save-as-template`, admin, core.saveAsTemplate);
router.get(`${P}/export`, view, core.exportProject);
router.get(`${P}/activity`, view, collab.listActivity);
router.get(`${P}/reports`, view, collab.getReports);

/* ---- members & roles ---- */
router.post(`${P}/members`, validate(memberSchema), admin, core.addMember);
router.patch(`${P}/members/:userId`, validate(memberSchema), admin, core.updateMemberRole);
router.delete(`${P}/members/:userId`, admin, core.removeMember);

/* ---- milestones ---- */
router.get(`${P}/milestones`, view, plan.listMilestones);
router.post(`${P}/milestones`, edit, plan.milestoneCrud.create);
router.patch(`${P}/milestones/:itemId`, edit, plan.milestoneCrud.update);
router.delete(`${P}/milestones/:itemId`, edit, plan.milestoneCrud.remove);
router.put(`${P}/milestones/:itemId/tasks`, edit, plan.setMilestoneTasks);
router.post(`${P}/milestones/:itemId/toggle`, edit, plan.toggleMilestone);

/* ---- sprints ---- */
router.get(`${P}/sprints`, view, plan.sprintCrud.list);
router.post(`${P}/sprints`, edit, plan.sprintCrud.create);
router.patch(`${P}/sprints/:itemId`, edit, plan.sprintCrud.update);
router.delete(`${P}/sprints/:itemId`, edit, plan.sprintCrud.remove);
router.put(`${P}/sprints/:itemId/tasks`, edit, plan.setSprintTasks);
router.post(`${P}/sprints/:itemId/start`, edit, plan.startSprint);
router.post(`${P}/sprints/:itemId/complete`, edit, plan.completeSprint);

/* ---- task dependencies ---- */
router.get(`${P}/dependencies`, view, plan.listDependencies);
router.post(`${P}/dependencies`, edit, plan.addDependency);
router.delete(`${P}/dependencies/:itemId`, edit, plan.removeDependency);

/* ---- time tracking ---- */
router.get(`${P}/time`, view, plan.timeCrud.list);
router.post(`${P}/time`, validate(timeEntrySchema), edit, plan.timeCrud.create);
router.delete(`${P}/time/:itemId`, edit, plan.timeCrud.remove);

/* ---- risks & issues ---- */
router.get(`${P}/risks`, view, collab.riskCrud.list);
router.post(`${P}/risks`, edit, collab.riskCrud.create);
router.patch(`${P}/risks/:itemId`, edit, collab.riskCrud.update);
router.delete(`${P}/risks/:itemId`, admin, collab.riskCrud.remove);

/* ---- discussion ---- */
router.get(`${P}/comments`, view, collab.commentCrud.list);
router.post(`${P}/comments`, edit, collab.commentCrud.create);
router.patch(`${P}/comments/:itemId`, edit, collab.commentCrud.update);
router.delete(`${P}/comments/:itemId`, edit, collab.commentCrud.remove);

/* ---- files (download authenticated hai, public static folder nahi) ---- */
router.get(`${P}/files`, view, collab.listFiles);
router.post(`${P}/files`, edit, collab.upload.array("files", 10), collab.uploadFiles);
router.get(`${P}/files/:itemId/download`, view, collab.downloadFile);
router.delete(`${P}/files/:itemId`, edit, collab.deleteFile);

/* ---- automation & recurring tasks ---- */
router.get(`${P}/automations`, view, plan.ruleCrud.list);
router.post(`${P}/automations`, admin, plan.ruleCrud.create);
router.patch(`${P}/automations/:itemId`, admin, plan.ruleCrud.update);
router.delete(`${P}/automations/:itemId`, admin, plan.ruleCrud.remove);
router.get(`${P}/recurring`, view, plan.recurringCrud.list);
router.post(`${P}/recurring`, edit, plan.recurringCrud.create);
router.patch(`${P}/recurring/:itemId`, edit, plan.recurringCrud.update);
router.delete(`${P}/recurring/:itemId`, edit, plan.recurringCrud.remove);

export default router;