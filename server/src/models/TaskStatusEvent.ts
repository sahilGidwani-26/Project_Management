import { Schema, model } from "mongoose";

/** One row per status change of a task. Powers burndown, cumulative flow and cycle time. */
const schema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
  projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
  from: { type: String, default: null }, // null = the task was just created
  to: { type: String, required: true },
  at: { type: Date, default: Date.now },
  synthetic: { type: Boolean, default: false }, // true = reconstructed for tasks that existed before history tracking
});
schema.index({ taskId: 1, at: 1 });
schema.index({ projectId: 1, at: 1 });

export const TaskStatusEvent = model<any>("TaskStatusEvent", schema);