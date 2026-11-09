import { Schema, model } from "mongoose";

const oid = (ref: string, extra: Record<string, unknown> = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

/** One per workspace: the rules of attendance. Created on first use. */
export const AttendanceSettings = model<any>(
  "AttendanceSettings",
  new Schema(
    {
      workspaceId: oid("Workspace", { required: true, unique: true }),
      timezone: { type: String, default: "UTC" },
      workStart: { type: String, default: "09:00" },
      workEnd: { type: String, default: "18:00" },
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0 = Sunday ... 6 = Saturday
      offSaturdays: { type: [Number], default: [] }, // e.g. [2, 4] = 2nd and 4th Saturday are off
      graceMinutes: { type: Number, default: 15, min: 0, max: 240 },
      fullDayMinutes: { type: Number, default: 480, min: 60, max: 1440 },
      halfDayMinutes: { type: Number, default: 240, min: 30, max: 1440 },
      trackingStartDate: String, // yyyy-mm-dd: days before this are ignored
      reminderEnabled: { type: Boolean, default: false },
      reminderTime: { type: String, default: "09:30" },
      checkoutReminderEnabled: { type: Boolean, default: false },
      checkoutReminderTime: { type: String, default: "18:15" },
      updatedBy: oid("User"),
    },
    { timestamps: true }
  )
);

const holidaySchema = new Schema(
  {
    workspaceId: oid("Workspace", { required: true, index: true }),
    date: { type: String, required: true }, // yyyy-mm-dd
    name: { type: String, required: true, trim: true, maxlength: 80 },
    createdBy: oid("User"),
  },
  { timestamps: true }
);
holidaySchema.index({ workspaceId: 1, date: 1 }, { unique: true });
export const Holiday = model<any>("AttendanceHoliday", holidaySchema);

/** One per person per local day. A day can hold several check-in / check-out sessions. */
const recordSchema = new Schema(
  {
    workspaceId: oid("Workspace", { required: true }),
    userId: oid("User", { required: true }),
    date: { type: String, required: true }, // yyyy-mm-dd in the workspace timezone
    sessions: [
      {
        _id: false,
        in: { type: Date, required: true },
        out: { type: Date, default: null },
        mode: { type: String, enum: ["Office", "Remote", "On-site"], default: "Office" },
        note: { type: String, maxlength: 200 },
        by: { type: String, enum: ["self", "admin"], default: "self" },
      },
    ],
    manualStatus: { type: String, enum: ["present", "half_day", "absent"] },
    manualNote: { type: String, maxlength: 300 },
    editedBy: oid("User"),
    editedAt: Date,
    editLog: [{ _id: false, by: oid("User"), at: Date, note: String }],
  },
  { timestamps: true }
);
recordSchema.index({ workspaceId: 1, userId: 1, date: 1 }, { unique: true });
recordSchema.index({ workspaceId: 1, date: 1 });
export const AttendanceRecord = model<any>("AttendanceRecord", recordSchema);

const leaveTypeSchema = new Schema(
  {
    workspaceId: oid("Workspace", { required: true, index: true }),
    name: { type: String, required: true, trim: true, maxlength: 40 },
    nameLower: { type: String, required: true },
    code: { type: String, maxlength: 6, default: "L" },
    color: { type: String, default: "#2563EB" },
    yearlyQuota: { type: Number, default: 0, min: 0, max: 366 }, // 0 = no limit
    paid: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);
leaveTypeSchema.index({ workspaceId: 1, nameLower: 1 }, { unique: true });
export const LeaveType = model<any>("LeaveType", leaveTypeSchema);

const leaveRequestSchema = new Schema(
  {
    workspaceId: oid("Workspace", { required: true }),
    userId: oid("User", { required: true }),
    typeId: oid("LeaveType", { required: true }),
    from: { type: String, required: true },
    to: { type: String, required: true },
    half: { type: String, enum: ["none", "first", "second"], default: "none" },
    days: { type: Number, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending" },
    reviewedBy: oid("User"),
    reviewedAt: Date,
    reviewNote: { type: String, maxlength: 300 },
  },
  { timestamps: true }
);
leaveRequestSchema.index({ workspaceId: 1, userId: 1, from: 1 });
leaveRequestSchema.index({ workspaceId: 1, status: 1, from: 1 });
export const LeaveRequest = model<any>("LeaveRequest", leaveRequestSchema);

/** Makes sure a reminder email is sent only once per person per day (auto-deleted after 4 days). */
const reminderSchema = new Schema({
  workspaceId: oid("Workspace", { required: true }),
  userId: oid("User", { required: true }),
  date: { type: String, required: true },
  kind: { type: String, enum: ["checkin", "checkout"], required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 4 },
});
reminderSchema.index({ workspaceId: 1, userId: 1, date: 1, kind: 1 }, { unique: true });
export const AttendanceReminderLog = model<any>("AttendanceReminderLog", reminderSchema);