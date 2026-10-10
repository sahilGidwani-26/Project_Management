import { Schema, model } from "mongoose";

const oid = (ref: string, extra: Record<string, unknown> = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });
const scope = () => ({
  projectId: oid("Project", { required: true, index: true }),
  workspaceId: oid("Workspace", { required: true }),
});

export const Milestone = model<any>(
  "Milestone",
  new Schema(
    {
      ...scope(),
      title: { type: String, required: true, trim: true },
      description: String,
      dueDate: Date,
      status: { type: String, enum: ["Open", "Completed"], default: "Open" },
      completedAt: Date,
      taskIds: [oid("Task")],
      order: { type: Number, default: 0 },
      dueSoonSentAt: Date,
      overdueSentAt: Date,
      createdBy: oid("User"),
    },
    { timestamps: true }
  )
);

export const Sprint = model<any>(
  "Sprint",
  new Schema(
    {
      ...scope(),
      name: { type: String, required: true, trim: true },
      goal: String,
      startDate: Date,
      endDate: Date,
      status: { type: String, enum: ["Planned", "Active", "Completed"], default: "Planned" },
      taskIds: [oid("Task")],
            // Snapshots for sprint reports
      committedTaskIds: [oid("Task")], // what was in the sprint when it started
      doneTaskIds: [oid("Task")], // what was Done when it was completed
      carriedOverTaskIds: [oid("Task")], // unfinished tasks when it was completed
      scopeLog: [{ _id: false, taskId: oid("Task"), action: { type: String, enum: ["add", "remove"] }, at: { type: Date, default: Date.now } }],
      committed: { type: Number, default: 0 },
      velocity: { type: Number, default: 0 },
      startedAt: Date,
      completedAt: Date,
      createdBy: oid("User"),
    },
    { timestamps: true }
  )
);

export const TimeEntry = model<any>(
  "TimeEntry",
  new Schema(
    {
      ...scope(),
      taskId: oid("Task"),
      userId: oid("User", { required: true, index: true }),
      minutes: { type: Number, required: true, min: 1 },
      note: String,
      date: { type: Date, default: Date.now },
      billable: { type: Boolean, default: false },
    },
    { timestamps: true }
  )
);

export const RiskIssue = model<any>(
  "RiskIssue",
  new Schema(
    {
      ...scope(),
      type: { type: String, enum: ["Risk", "Issue"], default: "Risk" },
      title: { type: String, required: true, trim: true },
      description: String,
      severity: { type: String, enum: ["Low", "Medium", "High", "Critical"], default: "Medium" },
      probability: { type: String, enum: ["Low", "Medium", "High"], default: "Medium" },
      status: { type: String, enum: ["Open", "Mitigating", "Resolved", "Closed"], default: "Open" },
      ownerId: oid("User"),
      mitigation: String,
      dueDate: Date,
      createdBy: oid("User"),
    },
    { timestamps: true }
  )
);

export const ProjectComment = model<any>(
  "ProjectComment",
  new Schema(
    {
      ...scope(),
      userId: oid("User", { required: true }),
      content: { type: String, required: true, trim: true, maxlength: 5000 },
      mentions: [oid("User")],
      pinned: { type: Boolean, default: false },
      editedAt: Date,
    },
    { timestamps: true }
  )
);

export const ProjectFile = model<any>(
  "ProjectFile",
  new Schema(
    {
      ...scope(),
      uploadedBy: oid("User", { required: true }),
      fileName: { type: String, required: true },
      storedName: { type: String, required: true },
      fileType: String,
      fileSize: Number,
    },
    { timestamps: true }
  )
);

const depSchema = new Schema(
  {
    ...scope(),
    taskId: oid("Task", { required: true }),
    dependsOnTaskId: oid("Task", { required: true }),
    createdBy: oid("User"),
  },
  { timestamps: true }
);
depSchema.index({ taskId: 1, dependsOnTaskId: 1 }, { unique: true });
export const TaskDependency = model<any>("TaskDependency", depSchema);

export const AutomationRule = model<any>(
  "AutomationRule",
  new Schema(
    {
      ...scope(),
      name: { type: String, required: true, trim: true },
      active: { type: Boolean, default: true },
      triggerType: { type: String, enum: ["task_created", "task_status_changed", "task_assigned"], required: true },
      triggerStatus: String,
      actionType: {
        type: String,
        enum: ["notify_assignees", "notify_manager", "set_priority", "add_label", "move_status", "assign_user"],
        required: true,
      },
      actionValue: String,
      runCount: { type: Number, default: 0 },
      lastRunAt: Date,
      createdBy: oid("User"),
    },
    { timestamps: true }
  )
);

export const RecurringTask = model<any>(
  "RecurringTask",
  new Schema(
    {
      ...scope(),
      title: { type: String, required: true, trim: true },
      description: String,
      priority: { type: String, enum: ["Low", "Medium", "High", "Urgent"], default: "Medium" },
      assigneeIds: [oid("User")],
      labels: [String],
      frequency: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
      dayOfWeek: { type: Number, min: 0, max: 6 },
      dayOfMonth: { type: Number, min: 1, max: 31 },
      dueInDays: { type: Number, default: 3 },
      nextRunAt: { type: Date, required: true, index: true },
      lastRunAt: Date,
      active: { type: Boolean, default: true },
      createdBy: oid("User"),
    },
    { timestamps: true }
  )
);

const releaseSchema = new Schema(
  {
    ...scope(),
    name: { type: String, required: true, trim: true },
    description: String,
    plannedDate: Date,
    status: { type: String, enum: ["Planned", "Released"], default: "Planned" },
    releasedAt: Date,
    releasedBy: oid("User"),
    dueSoonSentAt: Date,
    overdueSentAt: Date,
    createdBy: oid("User"),
  },
  { timestamps: true }
);
releaseSchema.index({ projectId: 1, name: 1 }, { unique: true });
export const Release = model<any>("ProjectRelease", releaseSchema);