import { Schema, model } from "mongoose";

const meetingSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, unique: true, lowercase: true }, // abc-defg-hij
    /** invited = only the host and the people chosen, workspace = every member, open = anyone with the link */
    access: { type: String, enum: ["invited", "workspace", "open"], default: "invited" },
    invitedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    passcodeHash: { type: String, select: false },
    hasPasscode: { type: Boolean, default: false },
    waitingRoom: { type: Boolean, default: true },
    locked: { type: Boolean, default: false },
    maxParticipants: { type: Number, default: 6, min: 2, max: 8 },
    shareBy: { type: String, enum: ["everyone", "host"], default: "everyone" },
    chatEnabled: { type: Boolean, default: true },
    scheduledAt: Date,
    expiresAt: { type: Date, default: null }, // null = the link never expires
    status: { type: String, enum: ["active", "ended"], default: "active" },
    endedAt: Date,
    endedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);
meetingSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
meetingSchema.index({ workspaceId: 1, invitedUserIds: 1 });
export const Meeting = model<any>("Meeting", meetingSchema);

/** Who joined a meeting and when (used for the "past meetings" list). */
const joinSchema = new Schema({
  meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  name: { type: String, required: true },
  guest: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
  leftAt: Date,
});
export const MeetingJoin = model<any>("MeetingJoin", joinSchema);