import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type Size = "s" | "m" | "l" | "xl";
export interface LayoutItem { id: string; size: Size; hidden: boolean }

export interface DashProject {
  _id: string; name: string; color?: string; icon?: string; status: string; priority?: string; endDate: string | null;
  total: number; done: number; overdue: number; progress: number; finished: boolean;
}
export interface DashTask {
  _id: string; title: string; taskNumber: number; status: string; priority?: string; dueDate: string | null; type: string; projectId: string | null; projectName: string | null;
}
export interface DashOverview {
  today: string;
  timezone: string;
  stats: {
    projects: number | null; activeProjects: number | null; members: number | null; openTasks: number; myOpen: number; myOverdue: number; overdue: number; myDueWeek: number;
    completed7: number; completedPrev7: number; totalTasks: number; doneTasks: number; completionRate: number;
  };
  byStatus: { status: string; count: number }[];
  byPriority: { priority: string; count: number }[];
  trend: { date: string; created: number; completed: number }[];
  heat: { date: string; count: number }[];
  projects: DashProject[];
  attention: (DashProject & { reasons: string[] })[];
  deadlines: { _id: string; name: string; color?: string; endDate: string; progress: number; daysLeft: number }[];
  tasks: DashTask[];
  bugs: { severity: string; count: number }[] | null;
  workload: { userId: string; name: string; profileImage?: string; open: number; overdue: number }[] | null;
  activity: { _id: string; action: string; resourceType: string; title: string; actor: { name: string; profileImage?: string } | null; createdAt: string }[];
}

export interface WidgetProps { ov?: DashOverview; workspaceId: string }

export interface WidgetDef {
  id: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  size: Size;
  group: "Numbers" | "Charts" | "Lists" | "People & time";
  perm?: string;
  any?: string[];
  hiddenByDefault?: boolean;
  component: ComponentType<WidgetProps>;
}