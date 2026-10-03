import { Project } from "../models/Project";
import { Task } from "../models/Task";
import { AutomationRule, TaskDependency } from "../models/ProjectExtras";
import { sendToUsers, projectLeads } from "./projectEvents";
import { automationEmail } from "../utils/projectEmailTemplates";
import { buildTaskUrl, taskAssignedEmail } from "../utils/emailTemplates";

const idOf = (x: any) => String(x?._id ?? x);
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const STATUSES = ["Backlog", "Todo", "In Progress", "In Review", "Done"];

export type AutomationEvent = "task_created" | "task_status_changed" | "task_assigned";

/** Task controller se call karo (create / status change / assign ke BAAD). Kabhi throw nahi karta. */
export async function runAutomations(event: AutomationEvent, task: any, actorId?: string) {
  try {
    if (!task?.projectId) return;
    const projectId = idOf(task.projectId);
    const rules: any[] = await AutomationRule.find({ projectId, active: true, triggerType: event });
    if (!rules.length) return;
    const project: any = await Project.findById(projectId);
    if (!project) return;
    const url = buildTaskUrl(String(project.workspaceId), projectId, idOf(task));
    const assignees = (task.assigneeIds || []).map(idOf);

    for (const r of rules) {
      if (event === "task_status_changed" && r.triggerStatus && r.triggerStatus !== task.status) continue;
      const message = r.actionValue && r.actionType.startsWith("notify") ? r.actionValue : `Event: ${event.replace(/_/g, " ")} (status: ${task.status})`;
      const notify = (ids: string[]) =>
        sendToUsers(ids, undefined, () => automationEmail({ ruleName: r.name, projectName: project.name, taskTitle: task.title, message, url }));

      switch (r.actionType) {
        case "notify_assignees": await notify(assignees); break;
        case "notify_manager": await notify(projectLeads(project)); break;
        case "set_priority":
          if (PRIORITIES.includes(r.actionValue)) await Task.updateOne({ _id: task._id }, { priority: r.actionValue });
          break;
        case "move_status":
          if (STATUSES.includes(r.actionValue)) await Task.updateOne({ _id: task._id }, { status: r.actionValue });
          break;
        case "add_label":
          if (r.actionValue) await Task.updateOne({ _id: task._id }, { $addToSet: { labels: r.actionValue } });
          break;
        case "assign_user":
          if (r.actionValue) {
            await Task.updateOne({ _id: task._id }, { $addToSet: { assigneeIds: r.actionValue } });
            void sendToUsers([r.actionValue], actorId, () =>
              taskAssignedEmail({ taskTitle: task.title, projectName: project.name, assignedByName: `Automation "${r.name}"`, taskUrl: url })
            );
          }
          break;
      }
      await AutomationRule.updateOne({ _id: r._id }, { $inc: { runCount: 1 }, lastRunAt: new Date() });
    }
  } catch (e) {
    console.warn("[automation] failed:", (e as Error).message);
  }
}

/** Unfinished tasks jo `taskId` ko aage badhne se rok rahe hain. Khaali = free. */
export async function getBlockers(taskId: string, newStatus: string): Promise<string[]> {
  if (!["In Progress", "In Review", "Done"].includes(newStatus)) return [];
  const deps: any[] = await TaskDependency.find({ taskId }).lean();
  if (!deps.length) return [];
  const blockers: any[] = await Task.find({ _id: { $in: deps.map((d) => d.dependsOnTaskId) }, status: { $ne: "Done" } }).select("title taskNumber").lean();
  return blockers.map((t) => `TASK-${t.taskNumber} ${t.title}`);
}