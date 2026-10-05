import { Project } from "../models/Project";
import { projectLeads, projectRecipients, sendToUsers } from "../services/projectEvents";
import { createTasksBulk, nextRun } from "../services/projectOps";
import { runAutomations } from "../services/automation";
import { buildTaskUrl, taskAssignedEmail } from "../utils/emailTemplates";
import { Milestone, RecurringTask, Release } from "../models/ProjectExtras";
import { buildProjectUrl, milestoneEmail, projectDeadlineEmail, releaseEmail } from "../utils/projectEmailTemplates";

const DAY = 864e5;
const OPEN = ["Planning", "Active", "On Hold"];

/** Server start hone ke baad ek baar call karo: startProjectJobs(). Har ghante chalta hai. */
export function startProjectJobs() {
  setTimeout(run, 30_000);
  setInterval(run, 60 * 60 * 1000);
}

async function run() {
    for (const job of [projectDeadlines, milestoneDeadlines, recurringTasks, releaseDeadlines]) {
    try {
      await job();
    } catch (e) {
      console.warn(`[projectJobs] ${job.name} failed:`, (e as Error).message);
    }
  }
}


async function releaseDeadlines() {
  const now = new Date();
  const soon = new Date(+now + 2 * DAY);
  const cache = new Map<string, any>();
  const projectOf = async (id: any) => {
    const k = String(id);
    if (!cache.has(k)) cache.set(k, await Project.findById(id));
    return cache.get(k);
  };

  const dueSoon: any[] = await Release.find({ status: "Planned", plannedDate: { $gte: now, $lte: soon }, dueSoonSentAt: null });
  for (const rel of dueSoon) {
    const p = await projectOf(rel.projectId);
    await Release.updateOne({ _id: rel._id }, { dueSoonSentAt: now });
    if (p && OPEN.includes(p.status))
      void sendToUsers(projectRecipients(p), undefined, () =>
        releaseEmail({ kind: "dueSoon", projectName: p.name, name: rel.name, plannedDate: rel.plannedDate, url: buildProjectUrl(p.workspaceId, p._id, "releases") })
      );
  }

  const overdue: any[] = await Release.find({ status: "Planned", plannedDate: { $lt: now }, overdueSentAt: null });
  for (const rel of overdue) {
    const p = await projectOf(rel.projectId);
    await Release.updateOne({ _id: rel._id }, { overdueSentAt: now });
    if (p && OPEN.includes(p.status))
      void sendToUsers(projectLeads(p), undefined, () =>
        releaseEmail({ kind: "overdue", projectName: p.name, name: rel.name, plannedDate: rel.plannedDate, url: buildProjectUrl(p.workspaceId, p._id, "releases") })
      );
  }
}

async function projectDeadlines() {
  const now = new Date();
  const soon = new Date(+now + 3 * DAY);
  const dueSoon = await Project.find({ status: { $in: OPEN }, endDate: { $gte: now, $lte: soon }, dueSoonSentAt: null });
  for (const p of dueSoon) {
    await Project.updateOne({ _id: p._id }, { dueSoonSentAt: now });
    void sendToUsers(projectRecipients(p), undefined, () =>
      projectDeadlineEmail({ projectName: p.name, endDate: p.endDate!, overdue: false, url: buildProjectUrl(p.workspaceId, p._id) })
    );
  }
  const overdue = await Project.find({ status: { $in: OPEN }, endDate: { $lt: now }, overdueSentAt: null });
  for (const p of overdue) {
    await Project.updateOne({ _id: p._id }, { overdueSentAt: now });
    void sendToUsers(projectLeads(p), undefined, () =>
      projectDeadlineEmail({ projectName: p.name, endDate: p.endDate!, overdue: true, url: buildProjectUrl(p.workspaceId, p._id) })
    );
  }
}

async function milestoneDeadlines() {
  const now = new Date();
  const soon = new Date(+now + 2 * DAY);
  const cache = new Map<string, any>();
  const projectOf = async (id: any) => {
    const k = String(id);
    if (!cache.has(k)) cache.set(k, await Project.findById(id));
    return cache.get(k);
  };

  const dueSoon: any[] = await Milestone.find({ status: "Open", dueDate: { $gte: now, $lte: soon }, dueSoonSentAt: null });
  for (const m of dueSoon) {
    const p = await projectOf(m.projectId);
    await Milestone.updateOne({ _id: m._id }, { dueSoonSentAt: now });
    if (p && OPEN.includes(p.status))
      void sendToUsers(projectRecipients(p), undefined, () =>
        milestoneEmail({ kind: "dueSoon", projectName: p.name, title: m.title, dueDate: m.dueDate, url: buildProjectUrl(p.workspaceId, p._id) })
      );
  }
  const overdue: any[] = await Milestone.find({ status: "Open", dueDate: { $lt: now }, overdueSentAt: null });
  for (const m of overdue) {
    const p = await projectOf(m.projectId);
    await Milestone.updateOne({ _id: m._id }, { overdueSentAt: now });
    if (p && OPEN.includes(p.status))
      void sendToUsers(projectLeads(p), undefined, () =>
        milestoneEmail({ kind: "overdue", projectName: p.name, title: m.title, dueDate: m.dueDate, url: buildProjectUrl(p.workspaceId, p._id) })
      );
  }
}

async function recurringTasks() {
  const now = new Date();
  const due: any[] = await RecurringTask.find({ active: true, nextRunAt: { $lte: now } });
  for (const rule of due) {
    const project = await Project.findById(rule.projectId);
    // hamesha aage badhao, taaki paused/archived project par baad mein ek saath tasks na bane
    await RecurringTask.updateOne({ _id: rule._id }, { lastRunAt: now, nextRunAt: nextRun(rule, now) });
    if (!project || !OPEN.includes(project.status)) continue;

    const [task]: any[] = await createTasksBulk(
      project,
      [{
        title: rule.title, description: rule.description, priority: rule.priority, labels: rule.labels,
        assigneeIds: rule.assigneeIds, status: "Todo", dueDate: new Date(+now + (rule.dueInDays ?? 3) * DAY),
      }],
      String(rule.createdBy)
    );
    if (!task) continue;
    const link = buildTaskUrl(String(project.workspaceId), String(project._id), String(task._id));
    void sendToUsers(rule.assigneeIds, undefined, () =>
      taskAssignedEmail({ taskTitle: rule.title, projectName: project.name, assignedByName: "Recurring task", dueDate: task.dueDate, taskUrl: link })
    );
    void runAutomations("task_created", task, String(rule.createdBy));
  }
}