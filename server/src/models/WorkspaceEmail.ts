import { Schema, model } from "mongoose";

/** One mail account per workspace. The password is stored encrypted and is never sent to the browser. */
const emailSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, unique: true },
    enabled: { type: Boolean, default: false },
    preset: { type: String, default: "custom" },
    host: String,
    port: { type: Number, default: 587 },
    secure: { type: Boolean, default: false }, // true = SSL from the start (port 465), false = STARTTLS (port 587)
    username: String,
    passwordEnc: { type: String, select: false },
    fromName: String,
    fromEmail: String,
    replyTo: String,
    lastStatus: { ok: Boolean, message: String, at: Date },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const WorkspaceEmail = model<any>("WorkspaceEmail", emailSchema);