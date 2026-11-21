import { Activity, AlertTriangle, Bug, CheckCircle2, FolderKanban, ListChecks, Target, TrendingUp, Users } from "lucide-react";
import type { WidgetDef } from "./dashTypes";
import {
  Attention, Bugs, Completion, Deadlines, Heatmap, KpiCompleted, KpiMyOpen, KpiOverdue, KpiProjects, KpiTeam, MyTasks, ProjectStatus, ProjectsProgress,
  RecentActivity, TasksByPriority, TasksByStatus, Trend, Workload,
} from "./widgetsWork";

/** Order here = the default order on the dashboard. */
export const WIDGETS: WidgetDef[] = [
  { id: "kpi-projects", title: "Active projects", desc: "How many projects are running", icon: FolderKanban, size: "s", group: "Numbers", perm: "projects.view", component: KpiProjects },
  { id: "kpi-my-open", title: "My open tasks", desc: "Your tasks that are not done", icon: ListChecks, size: "s", group: "Numbers", perm: "tasks.view", component: KpiMyOpen },
  { id: "kpi-overdue", title: "Overdue tasks", desc: "Tasks past their due date", icon: AlertTriangle, size: "s", group: "Numbers", perm: "tasks.view", component: KpiOverdue },
  { id: "kpi-completed", title: "Done this week", desc: "Tasks finished in 7 days, compared with last week", icon: CheckCircle2, size: "s", group: "Numbers", perm: "tasks.view", component: KpiCompleted },
  { id: "kpi-team", title: "Team members", desc: "People in this workspace", icon: Users, size: "s", group: "Numbers", perm: "people.view", hiddenByDefault: true, component: KpiTeam },

  { id: "trend", title: "Created vs completed", desc: "Tasks created and finished over 14 days", icon: TrendingUp, size: "l", group: "Charts", perm: "tasks.view", component: Trend },
  { id: "completion", title: "Completion", desc: "Share of all tasks that are done", icon: CheckCircle2, size: "s", group: "Charts", perm: "tasks.view", component: Completion },
  { id: "status", title: "Tasks by status", desc: "Bar chart of every status", icon: ListChecks, size: "m", group: "Charts", perm: "tasks.view", component: TasksByStatus },
  { id: "priority", title: "Priority", desc: "Open tasks by priority", icon: Target, size: "s", group: "Charts", perm: "tasks.view", component: TasksByPriority },
  { id: "project-status", title: "Projects by status", desc: "How your projects are spread", icon: FolderKanban, size: "s", group: "Charts", perm: "projects.view", component: ProjectStatus },

  { id: "projects-progress", title: "Project progress", desc: "Done tasks per project", icon: FolderKanban, size: "m", group: "Lists", perm: "projects.view", component: ProjectsProgress },
  { id: "attention", title: "Needs attention", desc: "Projects that are late or slipping, with the reason", icon: AlertTriangle, size: "m", group: "Lists", perm: "projects.view", component: Attention },
  { id: "my-tasks", title: "My tasks", desc: "Your next tasks by due date", icon: ListChecks, size: "m", group: "Lists", perm: "tasks.view", component: MyTasks },
  { id: "deadlines", title: "Project deadlines", desc: "Which project ends next", icon: Target, size: "m", group: "Lists", perm: "projects.view", component: Deadlines },

  { id: "heatmap", title: "Activity heatmap", desc: "Tasks finished per day over 12 weeks", icon: Activity, size: "l", group: "Charts", perm: "tasks.view", component: Heatmap },
  { id: "bugs", title: "Bugs by severity", desc: "Open bugs grouped by severity", icon: Bug, size: "s", group: "Charts", perm: "bugs.view", component: Bugs },
  { id: "workload", title: "Team workload", desc: "Open and overdue tasks per person", icon: Users, size: "m", group: "People & time", perm: "analytics.view", component: Workload },
  { id: "activity", title: "Recent activity", desc: "What happened lately", icon: Activity, size: "m", group: "Lists", component: RecentActivity },
];

export const widgetAllowed = (d: WidgetDef, can: (p: string) => boolean) => (d.perm ? can(d.perm) : true) && (d.any ? d.any.some(can) : true);