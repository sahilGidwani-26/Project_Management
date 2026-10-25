import { RequestHandler, Router } from "express";
import { requireAuth } from "../middleware/auth";
import { loadWorkspaceRole, requireAnyPermission, requirePermission } from "../middleware/workspaceRole";
import { validate } from "../middleware/validate";
import { projectAccess } from "../utils/projectAccess";
import { bulkSchema, createProjectSchema, memberSchema, timeEntrySchema, updateProjectSchema } from "../validations/project.validation";
import * as core from "../controllers/project.controller";
import * as plan from "../controllers/projectPlanning.controller";
import * as collab from "../controllers/projectCollab.controller";
import * as rel from "../controllers/projectRelease.controller";
import * as gh from "../controllers/projectGithub.controller";
import * as sr from "../controllers/projectSprintReports.controller";
import * as fc from "../controllers/projectForecast.controller";
import * as st from "../controllers/standup.controller";
import * as pk from "../controllers/projectPoker.controller";

const router = Router();
router.use(requireAuth);

type Min = "VIEWER" | "MEMBER";
/** Opens the project (private / "only my projects" rules) and needs ALL listed permissions. "MEMBER" also blocks people who are read-only viewers of this project. */
const gate = (min: Min, ...perms: string[]): RequestHandler[] => [projectAccess(min), requirePermission(...perms)];
/** Same, but ONE of the listed permissions is enough. */
const gateAny = (min: Min, ...perms: string[]): RequestHandler[] => [projectAccess(min), requireAnyPermission(...perms)];

/* ---- workspace-level ---- */
router.post("/", validate(createProjectSchema), loadWorkspaceRole, requirePermission("projects.create"), core.createProject);
router.get("/workspace/:workspaceId", loadWorkspaceRole, requirePermission("projects.view"), core.listProjects);
router.get("/templates/:workspaceId", loadWorkspaceRole, requirePermission("projects.create"), core.listTemplates);
router.delete("/templates/:templateId", core.deleteTemplate); // checks projects.templates inside
router.post("/bulk/update", validate(bulkSchema), loadWorkspaceRole, requireAnyPermission("projects.edit", "projects.archive"), core.bulkUpdate);
router.post("/bulk/delete", validate(bulkSchema), loadWorkspaceRole, requirePermission("projects.delete"), core.bulkDelete);

/* ---- project ---- */
const P = "/:projectId";
router.get(P, ...gate("VIEWER", "projects.view"), core.getProject);
router.patch(P, validate(updateProjectSchema), ...gate("MEMBER", "projects.edit"), core.updateProject);
router.delete(P, ...gate("MEMBER", "projects.delete"), core.deleteProject);
router.post(`${P}/archive`, ...gate("MEMBER", "projects.archive"), core.archiveProject);
router.post(`${P}/restore`, ...gate("MEMBER", "projects.archive"), core.restoreProject);
router.post(`${P}/duplicate`, ...gate("MEMBER", "projects.create", "projects.templates"), core.duplicateProject);
router.post(`${P}/favorite`, ...gate("VIEWER", "projects.view"), core.toggleFavorite);
router.post(`${P}/save-as-template`, ...gate("MEMBER", "projects.templates"), core.saveAsTemplate);
router.get(`${P}/export`, ...gate("VIEWER", "projects.export"), core.exportProject);
router.get(`${P}/activity`, ...gate("VIEWER", "projects.view"), collab.listActivity);
router.get(`${P}/reports`, ...gate("VIEWER", "reports.view"), collab.getReports);

/* ---- members & roles of the project ---- */
router.post(`${P}/members`, validate(memberSchema), ...gate("MEMBER", "projects.members"), core.addMember);
router.patch(`${P}/members/:userId`, validate(memberSchema), ...gate("MEMBER", "projects.members"), core.updateMemberRole);
router.delete(`${P}/members/:userId`, ...gate("MEMBER", "projects.members"), core.removeMember);

/* ---- milestones ---- */
router.get(`${P}/milestones`, ...gate("VIEWER", "milestones.view"), plan.listMilestones);
router.post(`${P}/milestones`, ...gate("MEMBER", "milestones.edit"), plan.milestoneCrud.create);
router.patch(`${P}/milestones/:itemId`, ...gate("MEMBER", "milestones.edit"), plan.milestoneCrud.update);
router.delete(`${P}/milestones/:itemId`, ...gate("MEMBER", "milestones.delete"), plan.milestoneCrud.remove);
router.put(`${P}/milestones/:itemId/tasks`, ...gate("MEMBER", "milestones.edit"), plan.setMilestoneTasks);
router.post(`${P}/milestones/:itemId/toggle`, ...gate("MEMBER", "milestones.edit"), plan.toggleMilestone);

/* ---- sprints ---- */
router.get(`${P}/sprints`, ...gate("VIEWER", "sprints.view"), plan.sprintCrud.list);
router.post(`${P}/sprints`, ...gate("MEMBER", "sprints.edit"), plan.sprintCrud.create);
router.patch(`${P}/sprints/:itemId`, ...gate("MEMBER", "sprints.edit"), plan.sprintCrud.update);
router.delete(`${P}/sprints/:itemId`, ...gate("MEMBER", "sprints.delete"), plan.sprintCrud.remove);
router.put(`${P}/sprints/:itemId/tasks`, ...gate("MEMBER", "sprints.edit"), plan.setSprintTasks);
router.post(`${P}/sprints/:itemId/start`, ...gate("MEMBER", "sprints.run"), plan.startSprint);
router.post(`${P}/sprints/:itemId/complete`, ...gate("MEMBER", "sprints.run"), plan.completeSprint);

/* ---- task dependencies (timeline) ---- */
router.get(`${P}/dependencies`, ...gate("VIEWER", "timeline.view"), plan.listDependencies);
router.post(`${P}/dependencies`, ...gate("MEMBER", "timeline.edit"), plan.addDependency);
router.delete(`${P}/dependencies/:itemId`, ...gate("MEMBER", "timeline.edit"), plan.removeDependency);

/* ---- time tracking (deleting somebody else's entry also needs time.delete, checked inside) ---- */
router.get(`${P}/time`, ...gate("VIEWER", "time.view"), plan.timeCrud.list);
router.post(`${P}/time`, validate(timeEntrySchema), ...gate("MEMBER", "time.log"), plan.timeCrud.create);
router.delete(`${P}/time/:itemId`, ...gateAny("MEMBER", "time.log", "time.delete"), plan.timeCrud.remove);

/* ---- risks & issues ---- */
router.get(`${P}/risks`, ...gate("VIEWER", "risks.view"), collab.riskCrud.list);
router.post(`${P}/risks`, ...gate("MEMBER", "risks.edit"), collab.riskCrud.create);
router.patch(`${P}/risks/:itemId`, ...gate("MEMBER", "risks.edit"), collab.riskCrud.update);
router.delete(`${P}/risks/:itemId`, ...gate("MEMBER", "risks.delete"), collab.riskCrud.remove);

/* ---- discussion (editing or deleting other people's messages also needs discussion.moderate, checked inside) ---- */
router.get(`${P}/comments`, ...gate("VIEWER", "discussion.view"), collab.commentCrud.list);
router.post(`${P}/comments`, ...gate("MEMBER", "discussion.post"), collab.commentCrud.create);
router.patch(`${P}/comments/:itemId`, ...gateAny("MEMBER", "discussion.post", "discussion.moderate"), collab.commentCrud.update);
router.delete(`${P}/comments/:itemId`, ...gateAny("MEMBER", "discussion.post", "discussion.moderate"), collab.commentCrud.remove);

/* ---- files (deleting somebody else's file also needs files.delete, checked inside) ---- */
router.get(`${P}/files`, ...gate("VIEWER", "files.view"), collab.listFiles);
router.post(`${P}/files`, ...gate("MEMBER", "files.upload"), collab.upload.array("files", 10), collab.uploadFiles);
router.get(`${P}/files/:itemId/download`, ...gate("VIEWER", "files.view"), collab.downloadFile);
router.delete(`${P}/files/:itemId`, ...gateAny("MEMBER", "files.upload", "files.delete"), collab.deleteFile);

/* ---- automation rules & recurring tasks ---- */
router.get(`${P}/automations`, ...gate("VIEWER", "automation.view"), plan.ruleCrud.list);
router.post(`${P}/automations`, ...gate("MEMBER", "automation.edit"), plan.ruleCrud.create);
router.patch(`${P}/automations/:itemId`, ...gate("MEMBER", "automation.edit"), plan.ruleCrud.update);
router.delete(`${P}/automations/:itemId`, ...gate("MEMBER", "automation.edit"), plan.ruleCrud.remove);
router.get(`${P}/recurring`, ...gate("VIEWER", "automation.view"), plan.recurringCrud.list);
router.post(`${P}/recurring`, ...gate("MEMBER", "tasks.create"), plan.recurringCrud.create);
router.patch(`${P}/recurring/:itemId`, ...gate("MEMBER", "tasks.create"), plan.recurringCrud.update);
router.delete(`${P}/recurring/:itemId`, ...gate("MEMBER", "tasks.create"), plan.recurringCrud.remove);

/* ---- releases / changelog ---- */
router.get(`${P}/releases`, ...gate("VIEWER", "releases.view"), rel.listReleases);
router.post(`${P}/releases`, ...gate("MEMBER", "releases.edit"), rel.releaseCrud.create);
router.patch(`${P}/releases/:itemId`, ...gate("MEMBER", "releases.edit"), rel.releaseCrud.update);
router.delete(`${P}/releases/:itemId`, ...gate("MEMBER", "releases.delete"), rel.releaseCrud.remove);
router.put(`${P}/releases/:itemId/tasks`, ...gate("MEMBER", "releases.edit"), rel.setReleaseTasks);
router.post(`${P}/releases/:itemId/add-done`, ...gate("MEMBER", "releases.edit"), rel.addDoneTasks);
router.post(`${P}/releases/:itemId/publish`, ...gate("MEMBER", "releases.publish"), rel.publishRelease);
router.post(`${P}/releases/:itemId/reopen`, ...gate("MEMBER", "releases.publish"), rel.reopenRelease);
router.get(`${P}/releases/:itemId/changelog`, ...gate("VIEWER", "releases.view"), rel.getChangelog);

/* ---- GitHub (the settings page holds the webhook secret, so it needs configure) ---- */
router.get(`${P}/github`, ...gate("MEMBER", "github.configure"), gh.getIntegration);
router.put(`${P}/github`, ...gate("MEMBER", "github.configure"), gh.saveIntegration);
router.delete(`${P}/github`, ...gate("MEMBER", "github.configure"), gh.removeIntegration);
router.post(`${P}/github/regenerate-secret`, ...gate("MEMBER", "github.configure"), gh.regenerateSecret);
router.get(`${P}/github/activity`, ...gate("VIEWER", "github.view"), gh.listActivity);

/* ---- sprint reports, forecast, standup ---- */
router.get(`${P}/sprint-reports`, ...gate("VIEWER", "sprint_reports.view"), sr.sprintOverview);
router.get(`${P}/sprint-reports/flow`, ...gate("VIEWER", "sprint_reports.view"), sr.flowReport);
router.get(`${P}/sprint-reports/sprints/:sprintId`, ...gate("VIEWER", "sprint_reports.view"), sr.sprintDetail);
router.get(`${P}/forecast`, ...gate("VIEWER", "forecast.view"), fc.projectForecast);
router.get(`${P}/forecast/history`, ...gate("VIEWER", "forecast.view"), fc.forecastHistory);
router.get(`${P}/standup`, ...gate("VIEWER", "standup.team"), st.projectStandup);

/* ---- planning poker (running someone else's session is limited to the facilitator and project admins, checked inside) ---- */
router.get(`${P}/poker`, ...gate("VIEWER", "poker.view"), pk.pokerOverview);
router.get(`${P}/poker/accuracy`, ...gate("VIEWER", "poker.view"), pk.accuracy);
router.post(`${P}/poker/sessions`, ...gate("MEMBER", "poker.facilitate"), pk.createSession);
router.get(`${P}/poker/sessions/:sessionId`, ...gate("VIEWER", "poker.view"), pk.sessionState);
router.post(`${P}/poker/sessions/:sessionId/join`, ...gate("MEMBER", "poker.vote"), pk.joinSession);
router.post(`${P}/poker/sessions/:sessionId/leave`, ...gate("MEMBER", "poker.vote"), pk.leaveSession);
router.post(`${P}/poker/sessions/:sessionId/take-over`, ...gate("MEMBER", "poker.facilitate"), pk.takeOver);
router.put(`${P}/poker/sessions/:sessionId/queue`, ...gate("MEMBER", "poker.facilitate"), pk.editQueue);
router.post(`${P}/poker/sessions/:sessionId/start-task`, ...gate("MEMBER", "poker.facilitate"), pk.startTask);
router.post(`${P}/poker/sessions/:sessionId/vote`, ...gate("MEMBER", "poker.vote"), pk.vote);
router.post(`${P}/poker/sessions/:sessionId/reveal`, ...gate("MEMBER", "poker.facilitate"), pk.reveal);
router.post(`${P}/poker/sessions/:sessionId/revote`, ...gate("MEMBER", "poker.facilitate"), pk.revote);
router.post(`${P}/poker/sessions/:sessionId/finalize`, ...gate("MEMBER", "poker.facilitate"), pk.finalize);
router.post(`${P}/poker/sessions/:sessionId/skip`, ...gate("MEMBER", "poker.facilitate"), pk.skip);
router.post(`${P}/poker/sessions/:sessionId/end`, ...gate("MEMBER", "poker.facilitate"), pk.endSession);

export default router;