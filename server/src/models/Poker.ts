import { Schema, model } from "mongoose";

const oid = (ref: string, extra: Record<string, unknown> = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

const sessionSchema = new Schema(
  {
    projectId: oid("Project", { required: true }),
    workspaceId: oid("Workspace", { required: true }),
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: ["active", "ended"], default: "active" },
    facilitatorId: oid("User", { required: true }),
    createdBy: oid("User", { required: true }),
    participants: [oid("User")],
    queue: [oid("Task")],
    skipped: [oid("Task")],
    currentTaskId: oid("Task"),
    phase: { type: String, enum: ["idle", "voting", "revealed"], default: "idle" },
    round: { type: Number, default: 1 },
    // { "<userId>": "<cardId>" }. Mixed on purpose so one vote is one atomic $set (no double votes on a double click)
    votes: { type: Schema.Types.Mixed, default: {} },
    endedAt: Date,
  },
  { timestamps: true, minimize: false }
);
sessionSchema.index({ projectId: 1, status: 1, createdAt: -1 });
// The database itself guarantees one running session per project, so two people pressing "Start" together cannot create two.
sessionSchema.index({ projectId: 1 }, { unique: true, partialFilterExpression: { status: "active" }, name: "one_active_poker_session_per_project" });

export const PokerSession = model<any>("PokerSession", sessionSchema);

/** One row per finished estimate (a task can be estimated again later, the newest row wins). */
const estimateSchema = new Schema({
  projectId: oid("Project", { required: true }),
  workspaceId: oid("Workspace", { required: true }),
  sessionId: oid("PokerSession", { required: true, index: true }),
  taskId: oid("Task", { required: true, index: true }),
  minutes: { type: Number, required: true },
  previousMinutes: Number,
  rounds: { type: Number, default: 1 },
  votes: [{ _id: false, userId: oid("User"), value: String }],
  facilitatorId: oid("User"),
  at: { type: Date, default: Date.now },
});
estimateSchema.index({ projectId: 1, at: -1 });

export const PokerEstimate = model<any>("PokerEstimate", estimateSchema);