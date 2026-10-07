import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import { IProject } from "../models/Project";
import { Task } from "../models/Task";
import {
  Milestone, Sprint, TimeEntry, RiskIssue, ProjectComment, ProjectFile, TaskDependency, AutomationRule, RecurringTask, Release,
} from "../models/ProjectExtras";
import { GithubIntegration, GithubTaskLink } from "../models/GithubIntegration";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads", "projects");

export interface TemplateShape {
  name: string;
  description?: string;
  milestones: string[];
  tasks: { title: string; description?: string; milestoneTitle?: string; estimatedMinutes?: number }[];
}

export const BUILT_IN_TEMPLATES: (TemplateShape & { id: string })[] = [
  { id: "blank", name: "Blank project", description: "Start from scratch", milestones: [], tasks: [] },
  {
    id: "website-launch",
    name: "Website launch",
    description: "Requirements, design, build, QA and go-live",
    milestones: ["Discovery", "Design", "Development", "QA", "Launch"],
    tasks: [
      { title: "Collect requirements", milestoneTitle: "Discovery", estimatedMinutes: 180 },
      { title: "Sitemap & content plan", milestoneTitle: "Discovery", estimatedMinutes: 120 },
      { title: "Wireframes", milestoneTitle: "Design", estimatedMinutes: 240 },
      { title: "UI design", milestoneTitle: "Design", estimatedMinutes: 480 },
      { title: "Frontend development", milestoneTitle: "Development", estimatedMinutes: 960 },
      { title: "Backend & CMS setup", milestoneTitle: "Development", estimatedMinutes: 720 },
      { title: "Cross-browser & mobile testing", milestoneTitle: "QA", estimatedMinutes: 240 },
      { title: "Fix QA issues", milestoneTitle: "QA", estimatedMinutes: 240 },
      { title: "Deploy to production", milestoneTitle: "Launch", estimatedMinutes: 120 },
      { title: "Post-launch monitoring", milestoneTitle: "Launch", estimatedMinutes: 120 },
    ],
  },
  {
    id: "sprint-planning",
    name: "Sprint planning",
    description: "Recurring agile sprint with ceremonies",
    milestones: ["Sprint 1"],
    tasks: [
      { title: "Groom backlog", milestoneTitle: "Sprint 1", estimatedMinutes: 90 },
      { title: "Sprint planning meeting", milestoneTitle: "Sprint 1", estimatedMinutes: 60 },
      { title: "Daily stand-ups", milestoneTitle: "Sprint 1", estimatedMinutes: 150 },
      { title: "Sprint review / demo", milestoneTitle: "Sprint 1", estimatedMinutes: 60 },
      { title: "Sprint retrospective", milestoneTitle: "Sprint 1", estimatedMinutes: 60 },
    ],
  },
  {
    id: "marketing-campaign",
    name: "Marketing campaign",
    description: "Plan, create, launch and measure a campaign",
    milestones: ["Strategy", "Content", "Launch", "Report"],
    tasks: [
      { title: "Define goals & audience", milestoneTitle: "Strategy", estimatedMinutes: 120 },
      { title: "Channel & budget plan", milestoneTitle: "Strategy", estimatedMinutes: 120 },
      { title: "Create creatives", milestoneTitle: "Content", estimatedMinutes: 480 },
      { title: "Write copy", milestoneTitle: "Content", estimatedMinutes: 240 },
      { title: "Schedule posts / ads", milestoneTitle: "Launch", estimatedMinutes: 120 },
      { title: "Go live", milestoneTitle: "Launch", estimatedMinutes: 60 },
      { title: "Performance report", milestoneTitle: "Report", estimatedMinutes: 180 },
    ],
  },
];

/**
 * ASSUMPTION: taskNumber workspace-wide badhta number hai.
 * Agar aapke task controller mein counter collection hai to yahan wahi helper use karo.
 */
export async function nextTaskNumber(workspaceId: Types.ObjectId | string) {
  const last: any = await Task.findOne({ workspaceId }).sort({ taskNumber: -1 }).select("taskNumber").lean();
  return (last?.taskNumber ?? 0) + 1;
}

export async function createTasksBulk(
  project: IProject,
  items: { title: string; description?: string; priority?: string; labels?: string[]; estimatedMinutes?: number; status?: string; assigneeIds?: any[]; dueDate?: Date }[],
  userId: string
) {
  if (!items.length) return [];
  const first = await nextTaskNumber(project.workspaceId);
  const inStatus: Record<string, number> = {};
  const docs = items.map((t, i) => {
    const status = t.status || "Todo";
    inStatus[status] = (inStatus[status] ?? 0) + 1;
    return {
      workspaceId: project.workspaceId,
      projectId: project._id,
      taskNumber: first + i,
      title: t.title,
      description: t.description,
      status,
      priority: t.priority || "Medium",
      labels: t.labels || [],
      assigneeIds: t.assigneeIds || [],
      estimatedMinutes: t.estimatedMinutes,
      dueDate: t.dueDate,
      order: inStatus[status] - 1,
      reporterId: userId,
      createdBy: userId,
    };
  });
  return (await Task.insertMany(docs)) as any[];
}

export async function applyTemplate(project: IProject, tpl: TemplateShape, userId: string) {
  const milestones: any[] = tpl.milestones.length
    ? await Milestone.insertMany(
        tpl.milestones.map((title, order) => ({ projectId: project._id, workspaceId: project.workspaceId, title, order, createdBy: userId }))
      )
    : [];
  const tasks = await createTasksBulk(project, tpl.tasks.map((t) => ({ title: t.title, description: t.description, estimatedMinutes: t.estimatedMinutes })), userId);
  tasks.forEach((t, i) => {
    const m = milestones.find((x) => x.title === tpl.tasks[i].milestoneTitle);
    if (m) m.taskIds.push(t._id);
  });
  await Promise.all(milestones.map((m) => m.save()));
}

/** Project aur uske saare related data delete. */
export async function purgeProject(projectId: Types.ObjectId | string) {
  const files: any[] = await ProjectFile.find({ projectId });
  await Promise.all(files.map((f) => fs.promises.unlink(path.join(UPLOAD_DIR, f.storedName)).catch(() => undefined)));
  const q = { projectId };
  await Promise.all([
    Task.deleteMany(q), Milestone.deleteMany(q), Sprint.deleteMany(q), TimeEntry.deleteMany(q), RiskIssue.deleteMany(q),
    ProjectComment.deleteMany(q), ProjectFile.deleteMany(q), TaskDependency.deleteMany(q), AutomationRule.deleteMany(q), RecurringTask.deleteMany(q) , GithubIntegration.deleteMany(q), GithubTaskLink.deleteMany(q),
  ]);
}

const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** `from` ke baad agla run (subah 6 baje, server time). */
export function nextRun(rule: { frequency: string; dayOfWeek?: number | null; dayOfMonth?: number | null }, from: Date): Date {
  const d = new Date(from);
  d.setHours(6, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (
    (rule.frequency === "weekly" && d.getDay() !== (rule.dayOfWeek ?? 1)) ||
    (rule.frequency === "monthly" && d.getDate() !== Math.min(rule.dayOfMonth ?? 1, daysInMonth(d)))
  );
  return d;
}