export interface User {
  _id: string;
  name: string;
  email: string;
  profileImage?: string;
  jobTitle?: string;
  bio?: string;
  isSuperAdmin?: boolean;
  lastLoginAt?: string;
  mustChangePassword?: boolean;
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
  joinedAt?: string;
  addedVia?: "owner" | "invite" | "manual";
  profile?: MemberProfile;
  roleRefId?: string | null;
  roleName?: string;
  roleColor?: string | null;
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
  releaseId?: string;
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

export interface ReleaseTaskRef {
  _id: string;
  title: string;
  taskNumber: number;
  type: TaskType;
  status: TaskStatus;
}

export interface Release {
  _id: string;
  name: string;
  description?: string;
  plannedDate?: string;
  status: "Planned" | "Released";
  releasedAt?: string;
  tasks: ReleaseTaskRef[];
  stats: { total: number; done: number; open: number; bugs: number; features: number; improvements: number; progress: number };
}


export interface GithubIntegrationInfo {
  _id: string;
  repo: string;
  enabled: boolean;
  secret: string;
  automation: { onPrOpened: string | null; onPrMerged: string | null; onBranchPush: string | null };
  verifiedAt?: string;
  lastEventAt?: string;
  lastEventType?: string;
  eventsCount: number;
  webhookPath: string;
}

export interface GithubLink {
  _id: string;
  type: "pr" | "commit";
  externalId: string;
  repo?: string;
  title?: string;
  url?: string;
  state?: "open" | "draft" | "merged" | "closed" | "pushed";
  authorLogin?: string;
  authorAvatar?: string;
  branch?: string;
  baseBranch?: string;
  updatedAtExt?: string;
  mergedAt?: string;
  taskId: string | { _id: string; title: string; taskNumber: number };
}

export interface GithubActivity {
  prs: GithubLink[];
  commits: GithubLink[];
}

export type ReportUnit = "tasks" | "hours";

export interface ReportTaskRow {
  _id: string;
  taskNumber: number;
  title: string;
  type: TaskType;
  status: TaskStatus;
  weight: number;
}

export interface SprintSummary {
  legacy: boolean;
  committed: number | null;
  added: number;
  removed: number;
  completed: number;
  carriedOver: number | null;
  scopeTotal: number;
  completionRate: number | null;
  commitmentRate: number | null;
  lists?: Record<"committed" | "added" | "removed" | "completed" | "carriedOver", ReportTaskRow[]>;
}

export interface SprintBrief {
  _id: string;
  name: string;
  goal?: string;
  status: "Planned" | "Active" | "Completed";
  startDate?: string;
  endDate?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface SprintReportRow extends SprintBrief, Omit<SprintSummary, "lists"> {}

export interface SprintOverview {
  unit: ReportUnit;
  sprints: SprintReportRow[];
  activeSprintId: string | null;
  velocity: { average3: number | null; averageAll: number | null; completedSprints: number };
  estimates: { tasks: number; withEstimate: number };
}

export interface CycleItem {
  _id: string;
  taskNumber: number;
  title: string;
  type: TaskType;
  doneAt: number;
  leadDays: number;
  cycleDays: number | null;
}

export interface DayStats { count: number; avg: number | null; median: number | null; p85: number | null }

export interface CycleStatsData {
  cycle: DayStats;
  lead: DayStats;
  histogram: { label: string; count: number }[];
  timeInStatus: Record<string, number | null>;
  items: CycleItem[];
}

export type FlowRow = Record<string, number | string>;

export interface SprintDetail {
  planned: boolean;
  unit?: ReportUnit;
  sprint: SprintBrief;
  taskCount?: number;
  summary?: SprintSummary;
  burndown?: { date: string; remaining: number | null; scope: number | null; ideal: number }[];
  flow?: FlowRow[];
  cycle?: CycleStatsData;
  estimates?: { tasks: number; withEstimate: number };
}

export interface FlowReport {
  unit: ReportUnit;
  days: number;
  flow: FlowRow[];
  cycle: CycleStatsData;
  estimates: { tasks: number; withEstimate: number };
}

export type ForecastState = "COMPLETE" | "ON_TRACK" | "NEEDS_ATTENTION" | "AT_RISK" | "NO_DEADLINE" | "NOT_ENOUGH_DATA" | "PENDING";

export interface ForecastAnalysis {
  remaining: number;
  deadline: string | null;
  state: ForecastState;
  dates: { p50: string | null; p70: string | null; p85: string | null; p95: string | null };
  probability: number | null;
  daysLate85: number | null;
  fix: { capacity85: number; removeNeeded: number; speedNeededPct: number | null } | null;
  distribution: { date: string; p: number }[];
}

export interface ProjectForecast extends ForecastAnalysis {
  openTasks: number;
  totalTasks: number;
  reason: string | null;
  throughput: {
    perWeek: number;
    windowDays: number;
    doneInWindow: number;
    weekly: { weekStart: string; done: number }[];
    trend: "up" | "down" | "flat";
  };
  whatIf: (ForecastAnalysis & { remove: number; speed: number }) | null;
  generatedAt: string;
}

export interface ForecastHistoryRow {
  day: string;
  state: ForecastState;
  remaining?: number;
  p50?: string | null;
  p85?: string | null;
  deadline?: string | null;
  probability?: number | null;
  throughputPerWeek?: number;
}

export interface WorkspaceForecastRow {
  project: { _id: string; name: string; color: string; icon?: string; status: string; endDate?: string };
  state: ForecastState;
  remaining: number | null;
  p50: string | null;
  p85: string | null;
  deadline: string | null;
  probability: number | null;
  perWeek: number;
  fresh: boolean;
}

export interface WorkspaceForecast {
  projects: WorkspaceForecastRow[];
  summary: { atRisk: number; needsAttention: number; onTrack: number; complete: number; total: number };
}

export interface StandupRef {
  _id: string;
  taskNumber: number;
  title: string;
  type: string;
  status: string;
  projectId?: string;
  projectName?: string;
  dueDate: string | null;
}

export interface StandupBlocker {
  kind: "critical" | "dependency" | "overdue" | "review" | "stale" | "risk";
  task?: StandupRef;
  text: string;
  days?: number;
}

export interface StandupNote {
  plan: string;
  blockers: string;
  away: boolean;
}

export interface MemberStandup {
  day: string;
  windowHours: number;
  yesterday: {
    done: StandupRef[];
    inReview: StandupRef[];
    started: StandupRef[];
    timeMinutes: number;
    comments: number;
    commits: { sha: string; title: string; url?: string; taskNumber: number }[];
  };
  today: { dueToday: StandupRef[]; inProgress: StandupRef[]; soon: StandupRef[] };
  blockers: StandupBlocker[];
  counts: { done: number; blockers: number; open: number };
}

export interface MyStandup extends MemberStandup {
  note: StandupNote | null;
  timezone: string;
  prefs: { standupDigest: boolean; standupHour: number };
  emailConfigured: boolean;
}

export interface TeamStandupMember extends MemberStandup {
  user: { _id: string; name: string; profileImage?: string; jobTitle?: string };
  note: StandupNote | null;
}

export interface TeamStandup {
  day: string;
  windowHours: number;
  members: TeamStandupMember[];
  summary: { members: number; done: number; blockedPeople: number; away: number };
}

export interface PokerCard { id: string; minutes: number | null; label: string }

export interface PokerPerson { _id: string; name: string; profileImage?: string; jobTitle?: string }

export interface PokerStats {
  count: number;
  numeric: number;
  unsure: number;
  coffee: number;
  min: number | null;
  max: number | null;
  average: number | null;
  median: number | null;
  suggestedMinutes: number | null;
  agreed: boolean;
  bigSpread: boolean;
}

export interface PokerQueueItem {
  _id: string;
  taskNumber: number;
  title: string;
  type: string;
  status: string;
  state: "pending" | "current" | "estimated" | "skipped";
  estimatedMinutes: number | null;
  pokerMinutes: number | null;
}

export interface PokerView {
  _id: string;
  name: string;
  status: "active" | "ended";
  phase: "idle" | "voting" | "revealed";
  round: number;
  facilitator: PokerPerson | null;
  isFacilitator: boolean;
  canControl: boolean;
  canTakeOver: boolean;
  isParticipant: boolean;
  canVote: boolean;
  myVote: string | null;
  participants: { user: PokerPerson; voted: boolean; vote?: string | null }[];
  current: { _id: string; taskNumber: number; title: string; type: string; status: string; description: string; estimatedMinutes: number | null; actualMinutes: number } | null;
  reveal: { votes: { user: PokerPerson; value: string; label: string; minutes: number | null }[]; stats: PokerStats } | null;
  queue: PokerQueueItem[];
  progress: { estimated: number; skipped: number; remaining: number; totalMinutes: number };
  cards: PokerCard[];
  endedAt: string | null;
}

export interface PokerOverview {
  active: { _id: string; name: string; phase: string; facilitator: string; participants: number; queued: number; joined: boolean } | null;
  recent: { _id: string; name: string; endedAt: string; facilitator: string; tasks: number; minutes: number }[];
  cards: PokerCard[];
}

export interface PokerAccuracy {
  estimatedTasks: number;
  measured: number;
  medianRatio: number | null;
  within25: number;
  tookLonger: number;
  tookLess: number;
  totalEstimated: number;
  totalActual: number;
  items: { _id: string; taskNumber: number; title: string; estimated: number; actual: number; ratio: number }[];
}

export type EmploymentType = "full_time" | "part_time" | "contractor" | "intern" | "client" | "vendor";

export interface MemberProfile {
  designation?: string;
  department?: string;
  employeeId?: string;
  company?: string;
  employmentType?: EmploymentType;
  workLocation?: string;
  skills?: string[];
}

export interface MemberPersonal {
  phone?: string;
  alternatePhone?: string;
  dateOfBirth?: string;
  address?: { line1?: string; line2?: string; city?: string; state?: string; country?: string; postalCode?: string };
  emergencyContact?: { name?: string; phone?: string; relation?: string };
}

export interface MemberDetail {
  member: {
    _id: string;
    workspaceId: string;
    role: WorkspaceRole;
    roleRefId?: string | null;
    roleName?: string;
    roleColor?: string | null;
    status: "active" | "deactivated" | "removed";
    joinedAt?: string;
    addedVia?: string;
    userId: User & { createdAt?: string };
    profile?: MemberProfile;
  };
  reportingManager: { _id: string; name: string; profileImage?: string } | null;
  personal: MemberPersonal | null;
  awaitingFirstLogin: boolean;
  openTasks: number;
  permissions: {
    isSelf: boolean;
    canEdit: boolean;
    canEditAllFields: boolean;
    canChangeRole: boolean;
    canDeactivate: boolean;
    canReactivate: boolean;
    canRemove: boolean;
    canResendCredentials: boolean;
    canViewProgress: boolean;
  };
}

export interface MemberProgress {
  summary: {
    assigned: number;
    open: number;
    completed: number;
    overdue: number;
    completionRate: number;
    onTimeRate: number | null;
    onTimeSample: number;
    avgCycleDays: number | null;
    medianCycleDays: number | null;
    cycleSample: number;
    completedLast30Days: number;
  };
  workload: { openTasks: number; estimatedMinutes: number; byStatus: Record<string, number>; dueThisWeek: number };
  weekly: { weekStart: string; done: number }[];
  time: { weekMinutes: number; monthMinutes: number };
  development: { mergedPrs: number; commits: number; days: number };
  projects: { _id: string; name: string; color: string; icon?: string; status: string; role: string; assigned: number; done: number }[];
  upcoming: { _id: string; taskNumber: number; title: string; status: string; priority: string; type: string; dueDate: string | null; projectId: string | null; projectName: string | null }[];
  recent: { _id: string; action: string; metadata?: Record<string, any>; createdAt: string }[];
}

export interface InvitationItem {
  _id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  invitedBy?: { _id: string; name: string };
}

export interface BulkCheckRow {
  line: number;
  email: string;
  name: string;
  ok: boolean;
  role?: WorkspaceRole;
  error?: string;
  note?: string;
}

export interface BulkResultRow {
  line: number;
  email: string;
  name?: string;
  status: "created" | "added" | "invited" | "refreshed" | "failed";
  message?: string;
  temporaryPassword?: string;
}

export interface DepartmentGroup {
  name: string;
  key: string;
  count: number;
  openTasks?: number;
  overdue?: number;
  members: { memberId: string; userId: string; name: string; email: string; profileImage?: string; designation?: string; role: WorkspaceRole; openTasks?: number }[];
}

export interface OrgNodeData {
  memberId: string;
  userId: string;
  name: string;
  profileImage?: string;
  designation?: string;
  department?: string;
  role: WorkspaceRole;
  managerUserId: string | null;
}

export interface PermAction { key: string; perm: string; label: string; requires: string[] }
export interface PermModule { key: string; label: string; description: string; actions: PermAction[] }
export interface PermCatalog { modules: PermModule[]; total: number }

export interface AccessRoleItem {
  _id: string;
  name: string;
  description: string;
  color: string;
  scope: "all" | "member";
  systemKey: WorkspaceRole | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
  locked: boolean;
  editable: boolean;
  isMine: boolean;
  defaultPermissions?: string[];
}

export interface MyPermissions {
  role: { id: string | null; key: WorkspaceRole | null; name: string; color: string | null; isOwner: boolean };
  scope: "all" | "member";
  legacyRole: WorkspaceRole;
  permissions: string[];
}