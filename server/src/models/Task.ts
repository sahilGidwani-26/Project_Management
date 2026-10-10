import { Schema, model, Document, Types } from "mongoose";
import { TaskStatusEvent } from "./TaskStatusEvent";

export type TaskStatus = "Backlog" | "Todo" | "In Progress" | "In Review" | "Done";
export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type TaskType = "Task" | "Bug" | "Feature" | "Improvement";
export type BugSeverity = "Minor" | "Major" | "Critical";

export interface IBugDetails {
  severity?: BugSeverity;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  environment?: string;
  foundInVersion?: string;
  fixedInVersion?: string;
}

export interface ITask extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId?: Types.ObjectId;
  taskNumber: number;
  type: TaskType;
  bugDetails?: IBugDetails;
  title: string;
  description?: string;
  assigneeIds: Types.ObjectId[];
  reporterId: Types.ObjectId;
  status: TaskStatus;
  priority: Priority;
  startDate?: Date;
  dueDate?: Date;
  estimatedMinutes?: number;
  actualMinutes?: number;
  labels: string[];
  milestoneId?: Types.ObjectId;
  releaseId?: Types.ObjectId;
  parentTaskId?: Types.ObjectId;
  dependencies: Types.ObjectId[];
  order: number;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly" | "custom";
    intervalDays?: number;
    active: boolean;
  };
  recurrenceSourceId?: Types.ObjectId;
  dueReminderSentAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true }, // optional: tasks can exist without a project
    taskNumber: { type: Number, required: true, index: true },
    type: { type: String, enum: ["Task", "Bug", "Feature", "Improvement"], default: "Task" },
    bugDetails: {
      severity: { type: String, enum: ["Minor", "Major", "Critical"] },
      stepsToReproduce: String,
      expectedResult: String,
      actualResult: String,
      environment: String,
      foundInVersion: String,
      fixedInVersion: String,
    },
    title: { type: String, required: true, trim: true },
    description: String,
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: "User", index: true }],
    reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["Backlog", "Todo", "In Progress", "In Review", "Done"], default: "Todo", index: true },
    priority: { type: String, enum: ["Low", "Medium", "High", "Urgent"], default: "Medium" },
    startDate: Date,
    dueDate: Date,
    estimatedMinutes: Number,
    actualMinutes: { type: Number, default: 0 },
    labels: [String],
    milestoneId: { type: Schema.Types.ObjectId, ref: "Milestone" },
    releaseId: { type: Schema.Types.ObjectId, ref: "ProjectRelease", index: true },
    parentTaskId: { type: Schema.Types.ObjectId, ref: "Task", index: true },
    dependencies: [{ type: Schema.Types.ObjectId, ref: "Task" }],
    order: { type: Number, default: 0 },
    recurrence: {
      frequency: { type: String, enum: ["daily", "weekly", "monthly", "custom"] },
      intervalDays: Number,
      active: { type: Boolean, default: false },
    },
    recurrenceSourceId: { type: Schema.Types.ObjectId, ref: "Task" },
    dueReminderSentAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ projectId: 1, type: 1 });
taskSchema.index({ workspaceId: 1, taskNumber: 1 }, { unique: true });
taskSchema.index({ title: "text", description: "text" });

/* ------------------------------------------------------------------------- *
 * Status history. Every way a task's status can change is recorded here, so no
 * controller has to remember to do it: create / insertMany, doc.save(),
 * findOneAndUpdate (findByIdAndUpdate), updateOne and updateMany.
 * Only top-level tasks that belong to a project are tracked (no subtasks).
 * ------------------------------------------------------------------------- */
const hooks: any = taskSchema;
const STATUS_VALUES = ["Backlog", "Todo", "In Progress", "In Review", "Done"];

const tracked = (t: any) => !!t?.projectId && !t?.parentTaskId;
const ev = (t: any, from: string | null, to: string) => ({ taskId: t._id, projectId: t.projectId, workspaceId: t.workspaceId, from, to, at: new Date() });
const statusOf = (update: any) => {
  const v = update?.$set?.status ?? update?.status;
  return STATUS_VALUES.includes(v) ? (v as string) : null;
};
async function logEvents(events: any[]) {
  if (!events.length) return;
  try {
    await TaskStatusEvent.insertMany(events, { ordered: false });
  } catch (e) {
    console.warn("[status-history] could not record:", (e as Error).message); // never break the real request
  }
}

// new tasks (Task.create) and status changes through doc.save()
hooks.pre("save", async function (this: any) {
  this.$locals.wasNew = this.isNew;
  if (!this.isNew && this.isModified("status")) {
    const prev: any = await (this.constructor as any).findById(this._id).select("status").lean();
    this.$locals.statusFrom = prev?.status;
  }
});
hooks.post("save", async function (doc: any) {
  if (!tracked(doc)) return;
  if (doc.$locals?.wasNew) await logEvents([ev(doc, null, doc.status)]);
  else if (doc.$locals?.statusFrom && doc.$locals.statusFrom !== doc.status) await logEvents([ev(doc, doc.$locals.statusFrom, doc.status)]);
});

// Task.insertMany (templates, duplicate project, recurring tasks)
hooks.post("insertMany", async function (docs: any[]) {
  await logEvents((docs || []).filter(tracked).map((d) => ev(d, null, d.status)));
});

// findByIdAndUpdate / findOneAndUpdate
hooks.pre("findOneAndUpdate", async function (this: any) {
  if (!statusOf(this.getUpdate())) return;
  this._statusBefore = await this.model.findOne(this.getFilter()).select("_id workspaceId projectId parentTaskId status").lean();
});
hooks.post("findOneAndUpdate", async function (this: any) {
  const to = statusOf(this.getUpdate());
  const before = this._statusBefore;
  if (!to || !before || !tracked(before) || before.status === to) return;
  await logEvents([ev(before, before.status, to)]);
});

// updateOne / updateMany (automation rules, sprint start)
for (const op of ["updateOne", "updateMany"]) {
  hooks.pre(op, async function (this: any) {
    if (!statusOf(this.getUpdate())) return;
    const q = this.model.find(this.getFilter()).select("_id workspaceId projectId parentTaskId status").lean();
    this._statusBeforeMany = op === "updateOne" ? await q.limit(1) : await q;
  });
  hooks.post(op, async function (this: any) {
    const to = statusOf(this.getUpdate());
    const before: any[] = this._statusBeforeMany || [];
    if (!to || !before.length) return;
    await logEvents(before.filter((b) => tracked(b) && b.status !== to).map((b) => ev(b, b.status, to)));
  });
}

// deleting a task removes its history too
hooks.post("findOneAndDelete", async function (doc: any) {
  if (doc) await TaskStatusEvent.deleteMany({ taskId: doc._id }).catch(() => undefined);
});

export const Task = model<ITask>("Task", taskSchema);