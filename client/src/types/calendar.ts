import { User, ProjectStatus } from "@/types";

export type EventType = "meeting" | "event";

export interface CalendarEvent {
  _id: string;
  workspaceId: string;
  type: EventType;
  title: string;
  description?: string;
  location?: string;
  meetingLink?: string;
  startTime: string;
  endTime: string;
  timezone: string;
  organizerId: User;
  attendeeIds: User[];
  status: "scheduled" | "cancelled";
  notes?: string;
  notesUpdatedBy?: User;
  notesUpdatedAt?: string;
  createdAt: string;
}

export interface DeadlineProject {
  _id: string;
  name: string;
  color: string;
  endDate: string;
  status: ProjectStatus;
}