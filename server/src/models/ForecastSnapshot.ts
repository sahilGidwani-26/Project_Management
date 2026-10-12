import { Schema, model } from "mongoose";

/** One row per project per (UTC) day. Powers the trend chart, the at-risk list and de-duplicated alerts. */
const schema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    day: { type: String, required: true }, // yyyy-mm-dd (UTC)
    state: {
      type: String,
      enum: ["COMPLETE", "ON_TRACK", "NEEDS_ATTENTION", "AT_RISK", "NO_DEADLINE", "NOT_ENOUGH_DATA"],
      required: true,
    },
    remaining: Number,
    throughputPerWeek: Number,
    p50: Date,
    p85: Date,
    deadline: Date,
    probability: Number, // 0..100, chance to finish by the deadline
    alerted: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ projectId: 1, day: 1 }, { unique: true });
schema.index({ workspaceId: 1, day: 1 });

export const ForecastSnapshot = model<any>("ForecastSnapshot", schema);