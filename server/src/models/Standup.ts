import { Schema, model } from "mongoose";

/** A person's own words for the day (one per workspace per local day). */
const noteSchema = new Schema({
  workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  day: { type: String, required: true }, // yyyy-mm-dd in the user's own timezone
  plan: { type: String, default: "", maxlength: 1000 },
  blockers: { type: String, default: "", maxlength: 1000 },
  away: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 }, // notes disappear after 90 days
});
noteSchema.index({ workspaceId: 1, userId: 1, day: 1 }, { unique: true });
export const StandupNote = model<any>("StandupNote", noteSchema);

/** Makes sure the morning email goes out once per user per workspace per day. */
const digestSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
  day: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 14 },
});
digestSchema.index({ userId: 1, workspaceId: 1, day: 1 }, { unique: true });
export const StandupDigest = model<any>("StandupDigest", digestSchema);