import { Schema, model, Document, Types } from "mongoose";

export interface ICalendarEvent extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  type: "meeting" | "event";
  title: string;
  description?: string;
  location?: string;
  meetingLink?: string;
  startTime: Date;
  endTime: Date;
  timezone: string; // organizer's IANA timezone, used to format times in emails
  organizerId: Types.ObjectId;
  attendeeIds: Types.ObjectId[];
  status: "scheduled" | "cancelled";
  notes?: string;
  notesUpdatedBy?: Types.ObjectId;
  notesUpdatedAt?: Date;
  sequence: number; // bumped on every change so calendar apps treat emails as updates
  createdAt: Date;
  updatedAt: Date;
}

const calendarEventSchema = new Schema<ICalendarEvent>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    type: { type: String, enum: ["meeting", "event"], default: "meeting" },
    title: { type: String, required: true, trim: true },
    description: String,
    location: String,
    meetingLink: String,
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    timezone: { type: String, default: "UTC" },
    organizerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    attendeeIds: [{ type: Schema.Types.ObjectId, ref: "User", index: true }],
    status: { type: String, enum: ["scheduled", "cancelled"], default: "scheduled" },
    notes: String,
    notesUpdatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    notesUpdatedAt: Date,
    sequence: { type: Number, default: 0 },
  },
  { timestamps: true }
);

calendarEventSchema.index({ workspaceId: 1, startTime: 1 });

export const CalendarEvent = model<ICalendarEvent>("CalendarEvent", calendarEventSchema);