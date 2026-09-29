import { Request, Response } from "express";
import crypto from "crypto";
import { Types } from "mongoose";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { CalendarEvent, ICalendarEvent } from "../models/CalendarEvent";
import { WorkspaceMember, WorkspaceRole } from "../models/WorkspaceMember";
import { User } from "../models/User";
import { Notification, NotificationType } from "../models/Notification";
import { Task } from "../models/Task";
import { Project } from "../models/Project";
import { sendMail } from "../utils/mailer";
import { buildIcs } from "../utils/ics";
import { meetingInviteEmail, meetingCancelledEmail, formatWhen, buildEventUrl } from "../utils/emailTemplates";

const MANAGER_ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER"];

// Meetings get a free Jitsi room by default. Organizers can paste their own Meet/Zoom link instead.
const AUTO_LINK_PREFIX = "https://meet.jit.si/Flowbase-";
const generateMeetingLink = () => `${AUTO_LINK_PREFIX}${crypto.randomBytes(8).toString("hex")}`;
const isAutoLink = (link?: string) => !!link && link.startsWith(AUTO_LINK_PREFIX);

function safeTimezone(tz?: string): string {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    // fall through
  }
  return "UTC";
}

const loadPopulated = (id: string) =>
  CalendarEvent.findById(id)
    .populate("organizerId", "name profileImage")
    .populate("attendeeIds", "name profileImage")
    .populate("notesUpdatedBy", "name");

async function getMemberRole(workspaceId: string | Types.ObjectId, userId: string): Promise<WorkspaceRole | undefined> {
  const member = await WorkspaceMember.findOne({ workspaceId, userId, status: "active" });
  return member?.role;
}

async function loadEventForUser(req: Request) {
  const event = await CalendarEvent.findById(req.params.eventId);
  if (!event) throw ApiError.notFound("Event not found");
  const role = await getMemberRole(event.workspaceId, req.user!.id);
  if (!role) throw ApiError.forbidden("You are not a member of this workspace");
  return { event, role };
}

/** Only real, active members of the workspace can be invited. */
async function sanitizeAttendees(workspaceId: string, ids: string[] = [], organizerId: string): Promise<string[]> {
  const unique = Array.from(new Set(ids)).filter((id) => id !== organizerId);
  if (!unique.length) return [];
  const members = await WorkspaceMember.find({ workspaceId, userId: { $in: unique }, status: "active" }).select("userId");
  return members.map((m) => m.userId.toString());
}

type NotifyKind = "invite" | "updated" | "cancelled";

const NOTIFICATION_TYPE: Record<NotifyKind, NotificationType> = {
  invite: "meeting_invite",
  updated: "meeting_updated",
  cancelled: "meeting_cancelled",
};

const NOTIFICATION_TITLE: Record<NotifyKind, string> = {
  invite: "Meeting invitation",
  updated: "Meeting updated",
  cancelled: "Meeting cancelled",
};

async function sendEventNotifications(
  req: Request,
  event: ICalendarEvent,
  targetIds: string[],
  kind: NotifyKind,
  icsAttendeeIds?: string[]
) {
  if (!targetIds.length) return;

  const [organizer, targets, icsUsers] = await Promise.all([
    User.findById(event.organizerId).select("name email"),
    User.find({ _id: { $in: targetIds } }).select("name email"),
    User.find({ _id: { $in: icsAttendeeIds ?? targetIds } }).select("name email"),
  ]);
  if (!organizer) return;

  const when = formatWhen(event.startTime, event.endTime, event.timezone);
  const eventUrl = buildEventUrl(event.workspaceId.toString(), event._id.toString());
  const ics = buildIcs({
    uid: event._id.toString(),
    sequence: event.sequence,
    method: kind === "cancelled" ? "CANCEL" : "REQUEST",
    title: event.title,
    description: event.description,
    location: event.meetingLink || event.location,
    url: event.meetingLink,
    start: event.startTime,
    end: event.endTime,
    organizer: { name: organizer.name, email: organizer.email },
    attendees: icsUsers.map((u) => ({ name: u.name, email: u.email })),
  });

  const io = req.app.get("io");

  await Promise.all(
    targets.map(async (u) => {
      await Notification.create({
        userId: u._id,
        type: NOTIFICATION_TYPE[kind],
        title: NOTIFICATION_TITLE[kind],
        message: `${organizer.name}: "${event.title}" — ${when}`,
        relatedWorkspaceId: event.workspaceId,
      });
      io.to(`user:${u._id}`).emit("notification:new", { title: NOTIFICATION_TITLE[kind] });

      const mail =
        kind === "cancelled"
          ? meetingCancelledEmail({ type: event.type, title: event.title, organizerName: organizer.name, when })
          : meetingInviteEmail({
              kind,
              type: event.type,
              title: event.title,
              organizerName: organizer.name,
              when,
              description: event.description,
              location: event.location,
              joinUrl: event.meetingLink,
              eventUrl,
            });

      sendMail(u.email, mail.subject, mail.html, {
        ics,
        icsMethod: kind === "cancelled" ? "CANCEL" : "REQUEST",
      }).catch(() => {});
    })
  );
}

function emitChange(req: Request, event: ICalendarEvent, extraUserIds: string[] = []) {
  const io = req.app.get("io");
  const ids = new Set([event.organizerId.toString(), ...event.attendeeIds.map(String), ...extraUserIds]);
  ids.forEach((id) => io.to(`user:${id}`).emit("event:changed", { eventId: event._id }));
}

function parseRange(req: Request) {
  const from = new Date(String(req.query.from ?? ""));
  const to = new Date(String(req.query.to ?? ""));
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw ApiError.badRequest("from and to (ISO dates) are required");
  if (to.getTime() - from.getTime() > 120 * 24 * 60 * 60 * 1000) throw ApiError.badRequest("Date range too large");
  return { from, to };
}

/* ------------------------------ handlers ------------------------------ */

export const createEvent = catchAsync(async (req: Request, res: Response) => {
  const b = req.body as {
    workspaceId: string;
    type: "meeting" | "event";
    title: string;
    description?: string;
    location?: string;
    meetingLink?: string;
    startTime: string;
    endTime: string;
    timezone?: string;
    attendeeIds: string[];
    notifyAttendees: boolean;
  };

  const attendeeIds = await sanitizeAttendees(b.workspaceId, b.attendeeIds, req.user!.id);

  const event = await CalendarEvent.create({
    workspaceId: b.workspaceId,
    type: b.type,
    title: b.title,
    description: b.description,
    location: b.location,
    meetingLink: b.meetingLink || (b.type === "meeting" ? generateMeetingLink() : undefined),
    startTime: new Date(b.startTime),
    endTime: new Date(b.endTime),
    timezone: safeTimezone(b.timezone),
    organizerId: req.user!.id,
    attendeeIds,
  });

  if (b.notifyAttendees !== false) await sendEventNotifications(req, event, attendeeIds, "invite");
  emitChange(req, event);

  return sendSuccess(res, 201, await loadPopulated(event._id.toString()), "Event created");
});

export const listEvents = catchAsync(async (req: Request, res: Response) => {
  const { from, to } = parseRange(req);
  const events = await CalendarEvent.find({
    workspaceId: req.params.workspaceId,
    status: "scheduled",
    startTime: { $lt: to },
    endTime: { $gt: from },
  })
    .sort({ startTime: 1 })
    .limit(500)
    .populate("organizerId", "name profileImage")
    .populate("attendeeIds", "name profileImage");
  return sendSuccess(res, 200, events, "Events");
});

/** Task due dates + project deadlines that fall in the range, shown read-only on the calendar. */
export const listDeadlines = catchAsync(async (req: Request, res: Response) => {
  const { from, to } = parseRange(req);
  const workspaceId = req.params.workspaceId;

  const [tasks, projects] = await Promise.all([
    Task.find({ workspaceId, dueDate: { $gte: from, $lt: to }, parentTaskId: { $exists: false } })
      .sort({ dueDate: 1 })
      .limit(300)
      .populate("assigneeIds", "name profileImage")
      .populate("projectId", "name color"),
    Project.find({ workspaceId, endDate: { $gte: from, $lt: to }, status: { $ne: "Archived" } })
      .select("name color endDate status")
      .limit(100),
  ]);

  return sendSuccess(res, 200, { tasks, projects }, "Deadlines");
});

export const getEvent = catchAsync(async (req: Request, res: Response) => {
  const { event } = await loadEventForUser(req);
  return sendSuccess(res, 200, await loadPopulated(event._id.toString()), "Event");
});

export const updateEvent = catchAsync(async (req: Request, res: Response) => {
  const { event, role } = await loadEventForUser(req);
  const isOrganizer = event.organizerId.toString() === req.user!.id;
  if (!isOrganizer && !MANAGER_ROLES.includes(role)) {
    throw ApiError.forbidden("Only the organizer or a workspace manager can edit this event");
  }
  if (event.status === "cancelled") throw ApiError.badRequest("This event was cancelled");

  const b = req.body as {
    type?: "meeting" | "event";
    title?: string;
    description?: string;
    location?: string;
    meetingLink?: string;
    startTime?: string;
    endTime?: string;
    timezone?: string;
    attendeeIds?: string[];
    notifyAttendees?: boolean;
  };

  const prevAttendees = event.attendeeIds.map(String);
  const prevLink = event.meetingLink;
  let significant = false; // something attendees should be told about (time, title, place, link)

  if (b.title !== undefined && b.title !== event.title) {
    event.title = b.title;
    significant = true;
  }
  if (b.description !== undefined) event.description = b.description;
  if (b.location !== undefined && b.location !== (event.location ?? "")) {
    event.location = b.location;
    significant = true;
  }
  if (b.type !== undefined) event.type = b.type;
  if (b.startTime) {
    const d = new Date(b.startTime);
    if (d.getTime() !== event.startTime.getTime()) {
      event.startTime = d;
      significant = true;
    }
  }
  if (b.endTime) {
    const d = new Date(b.endTime);
    if (d.getTime() !== event.endTime.getTime()) {
      event.endTime = d;
      significant = true;
    }
  }
  if (b.timezone) event.timezone = safeTimezone(b.timezone);
  if (event.endTime.getTime() <= event.startTime.getTime()) throw ApiError.badRequest("End time must be after start time");

  // Meeting link: keep the auto-generated link stable across edits so old invites keep working.
  if (b.meetingLink !== undefined) {
    if (b.meetingLink) {
      event.meetingLink = b.meetingLink;
    } else if (!isAutoLink(prevLink)) {
      event.meetingLink = event.type === "meeting" ? generateMeetingLink() : undefined;
    }
  }
  if (event.type === "meeting" && !event.meetingLink) event.meetingLink = generateMeetingLink();
  if (event.type === "event" && isAutoLink(event.meetingLink)) event.meetingLink = undefined;
  if (event.meetingLink !== prevLink) significant = true;

  if (b.attendeeIds) {
    const next = await sanitizeAttendees(event.workspaceId.toString(), b.attendeeIds, event.organizerId.toString());
    event.attendeeIds = next.map((id) => new Types.ObjectId(id));
  }

  const nextAttendees = event.attendeeIds.map(String);
  const added = nextAttendees.filter((id) => !prevAttendees.includes(id));
  const removed = prevAttendees.filter((id) => !nextAttendees.includes(id));
  const continuing = nextAttendees.filter((id) => prevAttendees.includes(id));

  if (significant || added.length || removed.length) event.sequence += 1;
  await event.save();

  if (b.notifyAttendees !== false) {
    await sendEventNotifications(req, event, added, "invite", nextAttendees);
    if (significant) await sendEventNotifications(req, event, continuing, "updated", nextAttendees);
    await sendEventNotifications(req, event, removed, "cancelled");
  }
  emitChange(req, event, removed);

  return sendSuccess(res, 200, await loadPopulated(event._id.toString()), "Event updated");
});

/** "Delete" = cancel: attendees get a cancellation email and the event disappears from the calendar. */
export const deleteEvent = catchAsync(async (req: Request, res: Response) => {
  const { event, role } = await loadEventForUser(req);
  const isOrganizer = event.organizerId.toString() === req.user!.id;
  if (!isOrganizer && !MANAGER_ROLES.includes(role)) {
    throw ApiError.forbidden("Only the organizer or a workspace manager can cancel this event");
  }

  if (event.status !== "cancelled") {
    event.status = "cancelled";
    event.sequence += 1;
    await event.save();
    if (req.query.notify !== "false") {
      await sendEventNotifications(req, event, event.attendeeIds.map(String), "cancelled");
    }
    emitChange(req, event);
  }

  return sendSuccess(res, 200, null, "Event cancelled");
});

export const updateNotes = catchAsync(async (req: Request, res: Response) => {
  const { event, role } = await loadEventForUser(req);
  const isOrganizer = event.organizerId.toString() === req.user!.id;
  const isAttendee = event.attendeeIds.map(String).includes(req.user!.id);
  const allowed = role !== "VIEWER" && (isOrganizer || isAttendee || MANAGER_ROLES.includes(role));
  if (!allowed) throw ApiError.forbidden("Only the organizer or attendees can edit meeting notes");

  event.notes = req.body.notes;
  event.notesUpdatedBy = new Types.ObjectId(req.user!.id);
  event.notesUpdatedAt = new Date();
  await event.save();

  emitChange(req, event);
  return sendSuccess(res, 200, await loadPopulated(event._id.toString()), "Notes saved");
});