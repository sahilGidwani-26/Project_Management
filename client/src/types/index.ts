export interface User {
  _id: string;
  name: string;
  email: string;
  profileImage?: string;
  jobTitle?: string;
  bio?: string;
  isSuperAdmin?: boolean;
}

export type WorkspaceRole = "OWNER" | "ADMIN" | "PROJECT_MANAGER" | "MEMBER" | "VIEWER";

export interface Workspace {
  _id: string;
  name: string;
  description?: string;
  slug: string;
  logo?: string;
  myRole?: WorkspaceRole;
}

export interface WorkspaceMember {
  _id: string;
  userId: User;
  role: WorkspaceRole;
  status: string;
}

export type ProjectStatus = "Planning" | "Active" | "On Hold" | "Completed" | "Cancelled" | "Archived";
export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type ProjectRole = "ADMIN" | "MEMBER" | "VIEWER";

export interface Project {
  _id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  managerId?: User;
  members: User[];
  memberRoles?: { userId: User; role: ProjectRole }[];
  status: ProjectStatus;
  priority: Priority;
  startDate?: string;
  endDate?: string;
  color: string;
  icon?: string;
  coverImage?: string;
  category?: string;
  tags?: string[];
  clientName?: string;
  budget?: number;
  currency?: string;
  visibility?: "public" | "private";
  progress: number;
  isFavorite?: boolean;
  myRole?: ProjectRole;
  taskStats?: { total: number; done: number; overdue: number };
  createdAt: string;
}

export interface ProjectStats {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  pending: number;
  milestones: { total: number; done: number };
  openRisks: number;
}

export interface ProjectTemplateInfo {
  id: string;
  name: string;
  description?: string;
  custom: boolean;
  milestoneCount: number;
  taskCount: number;
}

export type TaskStatus = "Backlog" | "Todo" | "In Progress" | "In Review" | "Done";

export interface TaskProjectRef {
  _id: string;
  name: string;
  color: string;
}

export interface Task {
  _id: string;
  workspaceId: string;
  projectId?: TaskProjectRef;
  taskNumber: number;
  parentTaskId?: string;
  title: string;
  description?: string;
  assigneeIds: User[];
  reporterId?: User;
  createdBy?: User;
  status: TaskStatus;
  priority: Priority;
  startDate?: string;
  dueDate?: string;
  labels: string[];
  order: number;
  estimatedMinutes?: number;
  actualMinutes?: number;
  createdAt: string;
  type?: TaskType;
  bugDetails?: BugDetails;
}

export interface Comment {
  _id: string;
  taskId: string;
  userId: User;
  content: string;
  mentions?: User[];
  createdAt: string;
}

export interface Attachment {
  _id: string;
  taskId?: string;
  projectId?: string;
  uploadedBy: User;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
}

export interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface Channel {
  _id: string;
  workspaceId: string;
  type: "channel" | "dm";
  name?: string;
  description?: string;
  isPrivate: boolean;
  members: string[];
  lastMessageAt?: string;
}

export interface Message {
  _id: string;
  channelId: string;
  senderId: User;
  content: string;
  reactions: { emoji: string; userId: string }[];
  editedAt?: string;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

/* ------------------------- Project module additions ------------------------- */

export interface Milestone {
  _id: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: "Open" | "Completed";
  taskIds: string[];
  tasks: Pick<Task, "_id" | "title" | "status" | "taskNumber" | "dueDate">[];
  taskTotal: number;
  taskDone: number;
  progress: number;
}

export interface Sprint {
  _id: string;
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  status: "Planned" | "Active" | "Completed";
  taskIds: string[];
  committed: number;
  velocity: number;
}

export interface TimeEntry {
  _id: string;
  userId: Pick<User, "_id" | "name" | "profileImage">;
  taskId?: { _id: string; title: string; taskNumber: number };
  minutes: number;
  note?: string;
  date: string;
  billable: boolean;
}

export interface RiskIssue {
  _id: string;
  type: "Risk" | "Issue";
  title: string;
  description?: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  probability: "Low" | "Medium" | "High";
  status: "Open" | "Mitigating" | "Resolved" | "Closed";
  ownerId?: Pick<User, "_id" | "name" | "profileImage">;
  mitigation?: string;
  dueDate?: string;
  createdAt: string;
}

export interface ProjectComment {
  _id: string;
  userId: Pick<User, "_id" | "name" | "profileImage">;
  content: string;
  mentions: { _id: string; name: string }[];
  pinned: boolean;
  editedAt?: string;
  createdAt: string;
}

export interface ProjectFile {
  _id: string;
  uploadedBy: Pick<User, "_id" | "name" | "profileImage">;
  fileName: string;
  fileType?: string;
  fileSize?: number;
  createdAt: string;
}

export interface TaskDependency {
  _id: string;
  taskId: string;
  dependsOnTaskId: string;
}

export interface AutomationRule {
  _id: string;
  name: string;
  active: boolean;
  triggerType: "task_created" | "task_status_changed" | "task_assigned";
  triggerStatus?: string;
  actionType: "notify_assignees" | "notify_manager" | "set_priority" | "add_label" | "move_status" | "assign_user";
  actionValue?: string;
  runCount: number;
  lastRunAt?: string;
}

export interface RecurringTask {
  _id: string;
  title: string;
  description?: string;
  priority: Priority;
  assigneeIds: Pick<User, "_id" | "name" | "profileImage">[];
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek?: number;
  dayOfMonth?: number;
  dueInDays: number;
  nextRunAt: string;
  active: boolean;
}

export interface ActivityItem {
  _id: string;
  action: string;
  actorId?: Pick<User, "_id" | "name" | "profileImage">;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface ProjectReports {
  summary: { total: number; done: number; overdue: number; completionRate: number; estimatedMinutes: number; loggedMinutes: number; avgCompletionDays: number };
  statusCounts: Record<string, number>;
  priorityCounts: Record<string, number>;
  workload: { user: Pick<User, "_id" | "name" | "profileImage">; open: number; done: number; overdue: number; estimatedMinutes: number; loggedMinutes: number }[];
  burndown: { date: string; remaining: number | null; ideal: number }[];
  trend: { date: string; created: number; completed: number }[];
  timeByUser: { _id: string; name?: string; minutes: number; billable: number }[];
}

export type TaskType = "Task" | "Bug" | "Feature" | "Improvement";
export type BugSeverity = "Minor" | "Major" | "Critical";

export interface BugDetails {
  severity?: BugSeverity;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  environment?: string;
  foundInVersion?: string;
  fixedInVersion?: string;
}