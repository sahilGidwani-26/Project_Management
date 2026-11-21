import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { Meeting, MeetingJoin } from "../models/Meeting";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { Notification } from "../models/Notification";
import { ActivityLog } from "../models/ActivityLog";
import { sendMail } from "../utils/mailer";
import { sendToUsers } from "../services/projectEvents";
import { env } from "../config/env";
import { verifyToken } from "../utils/token";
import { cleanName, entryFor, iceServers, isExpired, limit, meetingLink, newCode, normCode, signMeetToken } from "../services/meeting";
import { forceEnd, liveCount, notifyChanged } from "../services/meetingRooms";
import { meetingGuestInviteEmail, meetingInviteEmail } from "../utils/meetingEmailTemplates";

const ID = /^[a-f\d]{24}$/i;
const PASS = /^[\x20-\x7E]{4,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = 864e5;
const tooMany = (res: Response) => res.status(429).json({ success: false, message: "Too many attempts. Please wait a few minutes and try again." });
const log = (workspaceId: unknown, actorId: string, action: string, id: unknown, metadata: Record<string, unknown> = {}) =>
  ActivityLog.create({ workspaceId, actorId, action, resourceType: "Meeting", resourceId: id, metadata }).catch(() => undefined);

async function bell(io: any, userIds: string[], workspaceId: unknown, title: string, message: string) {
  for (const id of userIds) {
    await (Notification as any).create({ userId: id, type: "meeting_invite", title, message, relatedWorkspaceId: workspaceId }).catch(() => undefined);
    io?.to(`user:${id}`).emit("notification:new", { title });
  }
}

const view = (m: any, extra: Record<string, unknown> = {}) => ({
  _id: m._id, workspaceId: m.workspaceId, title: m.title, code: m.code, link: meetingLink(m.code), access: m.access, hasPasscode: !!m.hasPasscode,
  waitingRoom: m.waitingRoom, locked: m.locked, maxParticipants: m.maxParticipants, shareBy: m.shareBy, chatEnabled: m.chatEnabled,
  scheduledAt: m.scheduledAt || null, expiresAt: m.expiresAt || null, status: m.status, endedAt: m.endedAt || null, createdAt: m.createdAt,
  host: m.hostId && m.hostId._id ? { _id: m.hostId._id, name: m.hostId.name, profileImage: m.hostId.profileImage } : { _id: m.hostId },
  live: liveCount(String(m._id)), ...extra,
});

/** The host and people with meetings.manage may change or end a meeting. */
const canControl = (req: Request, m: any) => String(m.hostId?._id || m.hostId) === req.user!.id || !!req.access?.perms.has("meetings.manage");

async function optionalUser(req: Request): Promise<{ id: string; name: string } | null> {
  try {
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.split(" ")[1] : undefined;
    const token = req.cookies?.[env.JWT_COOKIE_NAME] || bearer;
    if (!token) return null;
    const p = verifyToken(token);
    const u: any = await User.findById(p.userId).select("name accountStatus mustChangePassword").lean();
    if (!u || u.accountStatus === "suspended" || u.mustChangePassword) return null;
    return { id: String(u._id), name: u.name };
  } catch {
    return null;
  }
}

/* ============================== inputs ============================== */

async function pickInvited(workspaceId: string, hostId: string, raw: unknown) {
  if (raw === undefined) return undefined;
  const ids = Array.isArray(raw) ? [...new Set(raw.map(String).filter((i) => ID.test(i) && i !== hostId))].slice(0, 50) : [];
  if (!ids.length) return [];
  return (await WorkspaceMember.find({ workspaceId, userId: { $in: ids }, status: "active" }).distinct("userId")).map(String);
}

function fields(b: any, create: boolean) {
  const out: Record<string, unknown> = {};
  if (b.title !== undefined || create) {
    const t = String(b.title ?? "").trim().replace(/\s+/g, " ");
    if (create ? false : t.length < 2) throw ApiError.badRequest("The title must be 2 to 100 characters");
    if (t) out.title = t.slice(0, 100);
  }
  if (b.access !== undefined) {
    if (!["invited", "workspace", "open"].includes(b.access)) throw ApiError.badRequest("Choose who can join");
    out.access = b.access;
  }
  for (const k of ["waitingRoom", "chatEnabled", "locked"] as const) if (typeof b[k] === "boolean") out[k] = b[k];
  if (b.shareBy !== undefined) {
    if (!["everyone", "host"].includes(b.shareBy)) throw ApiError.badRequest("Screen share must be everyone or host");
    out.shareBy = b.shareBy;
  }
  if (b.maxParticipants !== undefined) {
    const n = Math.round(Number(b.maxParticipants));
    if (!Number.isFinite(n) || n < 2 || n > 8) throw ApiError.badRequest("A meeting can hold 2 to 8 people");
    out.maxParticipants = n;
  }
  if (b.scheduledAt !== undefined) {
    if (b.scheduledAt === null || b.scheduledAt === "") out.scheduledAt = null;
    else {
      const d = new Date(b.scheduledAt);
      if (isNaN(+d)) throw ApiError.badRequest("The meeting time is not a valid date");
      out.scheduledAt = d;
    }
  }
  if (b.neverExpires === true) out.expiresAt = null;
  else if (b.expiresAt !== undefined && b.expiresAt) {
    const d = new Date(b.expiresAt);
    if (isNaN(+d) || +d < Date.now()) throw ApiError.badRequest("The expiry must be a future date");
    out.expiresAt = d;
  }
  return out;
}

async function passcodeFields(b: any) {
  if (b.passcode === undefined) return {};
  if (b.passcode === "" || b.passcode === null) return { $set: { hasPasscode: false }, $unset: { passcodeHash: "" } };
  if (!PASS.test(String(b.passcode))) throw ApiError.badRequest("The passcode must be 4 to 20 letters, numbers or symbols");
  return { $set: { hasPasscode: true, passcodeHash: await bcrypt.hash(String(b.passcode), 10) } };
}

async function inviteEmails(req: Request, m: any, userIds: string[]) {
  if (!userIds.length) return;
  const [host, ws]: [any, any] = await Promise.all([User.findById(m.hostId).select("name").lean(), Workspace.findById(m.workspaceId).select("name").lean()]);
  void sendToUsers(userIds, req.user!.id, () =>
    meetingInviteEmail({ title: m.title, host: host?.name || "Someone", workspaceName: ws?.name || "your workspace", scheduledAt: m.scheduledAt, link: meetingLink(m.code), passcode: !!m.hasPasscode })
  );
  await bell(req.app.get("io"), userIds, m.workspaceId, "Meeting invitation", `${host?.name || "Someone"} invited you to ${m.title}`);
}

/* ============================== workspace side ============================== */

export const listMeetings = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  const past = req.query.tab === "past";
  const now = new Date();
  const manager = req.access!.perms.has("meetings.manage");
  const mine = [{ hostId: uid }, { invitedUserIds: uid }];

  const filter: any = past
    ? { workspaceId, $and: [manager ? {} : { $or: mine }, { $or: [{ status: "ended" }, { expiresAt: { $lt: now } }] }] }
    : { workspaceId, status: "active", $and: [{ $or: [...mine, { access: { $in: ["workspace", "open"] } }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] }] };

  const items: any[] = await Meeting.find(filter).sort({ createdAt: -1 }).limit(100).populate("hostId", "name profileImage").lean();
  const counts: any[] = past && items.length ? await MeetingJoin.aggregate([{ $match: { meetingId: { $in: items.map((m) => m._id) } } }, { $group: { _id: "$meetingId", people: { $addToSet: { $ifNull: ["$userId", "$name"] } } } }]) : [];
  const people = new Map(counts.map((c) => [String(c._id), c.people.length]));
  return sendSuccess(res, 200, items.map((m) => view(m, past ? { participants: people.get(String(m._id)) || 0 } : {})), "Meetings");
});

export const createMeeting = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  const b = req.body || {};
  const f: any = fields(b, true);
  const invited = (await pickInvited(workspaceId, uid, b.invitedUserIds)) || [];
  const access = f.access || "invited";
  const host: any = await User.findById(uid).select("name").lean();

  let scheduledAt: Date | null = f.scheduledAt || null;
  const expiresAt = b.neverExpires === true ? null : f.expiresAt || new Date((scheduledAt ? +scheduledAt : Date.now()) + DAY);

  const pass = await passcodeFields(b);
  const m: any = await Meeting.create({
    workspaceId, hostId: uid, title: f.title || `${host?.name || "My"}'s meeting`, code: await newCode(), access, invitedUserIds: invited,
    waitingRoom: typeof f.waitingRoom === "boolean" ? f.waitingRoom : access === "open",
    chatEnabled: f.chatEnabled ?? true, shareBy: f.shareBy || "everyone", maxParticipants: f.maxParticipants || 6, scheduledAt, expiresAt,
    ...((pass as any).$set || {}),
  });

  await inviteEmails(req, m, invited);
  await log(workspaceId, uid, "meeting_created", m._id, { title: m.title, access });
  return sendSuccess(res, 201, view(m.toObject(), { invitedUserIds: invited }), "Meeting created");
});

export const getMeeting = catchAsync(async (req: Request, res: Response) => {
  const m: any = await Meeting.findById(req.params.meetingId).populate("hostId", "name profileImage").populate("invitedUserIds", "name email profileImage").lean();
  if (!m) throw ApiError.notFound("Meeting not found");
  const uid = req.user!.id;
  const invited = (m.invitedUserIds || []).some((u: any) => String(u._id) === uid);
  if (!canControl(req, m) && !invited && !(m.access !== "invited" && req.access!.perms.has("meetings.view"))) throw ApiError.forbidden("You are not invited to this meeting");
  return sendSuccess(res, 200, view(m, { invited: m.invitedUserIds, expired: isExpired(m) }), "Meeting");
});

export const updateMeeting = catchAsync(async (req: Request, res: Response) => {
  const m: any = await Meeting.findById(req.params.meetingId);
  if (!m) throw ApiError.notFound("Meeting not found");
  if (!canControl(req, m)) throw ApiError.forbidden("Only the host can change this meeting");
  if (m.status === "ended") throw ApiError.badRequest("This meeting has ended");
  const b = req.body || {};

  const f: any = fields(b, false);
  const pass: any = await passcodeFields(b);
  const before = (m.invitedUserIds || []).map(String);
  const invited = await pickInvited(String(m.workspaceId), String(m.hostId), b.invitedUserIds);

  const set: any = { ...f, ...(pass.$set || {}) };
  if (invited) set.invitedUserIds = invited;
  const update: any = { $set: set };
  if (pass.$unset) update.$unset = pass.$unset;
  if (b.neverExpires === true) set.expiresAt = null;
  const fresh: any = await Meeting.findByIdAndUpdate(m._id, update, { new: true }).populate("hostId", "name profileImage").lean();

  if (invited) await inviteEmails(req, fresh, invited.filter((i) => !before.includes(i)));
  notifyChanged(String(m._id));
  await log(m.workspaceId, req.user!.id, "meeting_updated", m._id, { title: fresh.title });
  return sendSuccess(res, 200, view(fresh), "Meeting saved");
});

export const endMeeting = catchAsync(async (req: Request, res: Response) => {
  const m: any = await Meeting.findById(req.params.meetingId);
  if (!m) throw ApiError.notFound("Meeting not found");
  if (!canControl(req, m)) throw ApiError.forbidden("Only the host can end this meeting");
  if (m.status !== "ended") {
    m.status = "ended";
    m.endedAt = new Date();
    m.endedBy = req.user!.id;
    await m.save();
    forceEnd(String(m._id), "ended");
    await log(m.workspaceId, req.user!.id, "meeting_ended", m._id, { title: m.title });
  }
  return sendSuccess(res, 200, null, "Meeting ended. The link no longer works.");
});

export const deleteMeeting = catchAsync(async (req: Request, res: Response) => {
  const m: any = await Meeting.findById(req.params.meetingId);
  if (!m) throw ApiError.notFound("Meeting not found");
  if (!canControl(req, m)) throw ApiError.forbidden("Only the host can delete this meeting");
  if (liveCount(String(m._id)) > 0) throw ApiError.conflict("People are in this meeting right now. End it first.");
  await Promise.all([m.deleteOne(), MeetingJoin.deleteMany({ meetingId: m._id })]);
  await log(m.workspaceId, req.user!.id, "meeting_deleted", m._id, { title: m.title });
  return sendSuccess(res, 200, null, "Meeting deleted");
});

/** Emails the link to any addresses. Only for "anyone with the link" meetings (a private meeting cannot be joined by outsiders anyway). */
export const emailInvite = catchAsync(async (req: Request, res: Response) => {
  const m: any = await Meeting.findById(req.params.meetingId);
  if (!m) throw ApiError.notFound("Meeting not found");
  if (!canControl(req, m)) throw ApiError.forbidden("Only the host can invite people");
  if (m.status === "ended" || isExpired(m)) throw ApiError.badRequest("This meeting is no longer active");
  if (m.access !== "open") throw ApiError.badRequest("Change “who can join” to “Anyone with the link” first, otherwise outsiders cannot get in.");

  const emails: string[] = Array.isArray(req.body?.emails) ? [...new Set<string>(req.body.emails.map((e: unknown) => String(e).trim().toLowerCase()))] : [];
  if (!emails.length || emails.length > 20) throw ApiError.badRequest("Add between 1 and 20 email addresses");
  if (emails.some((e) => !EMAIL.test(e) || e.length > 200)) throw ApiError.badRequest("One of the email addresses looks wrong");
  if (!limit(`inv:${m._id}`, 5, 3600e3)) throw ApiError.conflict("You sent many invitations already. Try again in an hour.");

  const host: any = await User.findById(m.hostId).select("name").lean();
  for (const to of emails) {
    const mail = meetingGuestInviteEmail({ title: m.title, host: host?.name || "Someone", scheduledAt: m.scheduledAt, link: meetingLink(m.code), passcode: !!m.hasPasscode });
    sendMail(to, mail.subject, mail.html).catch(() => {});
  }
  await log(m.workspaceId, req.user!.id, "meeting_guests_invited", m._id, { title: m.title, count: emails.length });
  return sendSuccess(res, 200, { sent: emails.length, emailConfigured: !!env.SMTP_HOST }, "Invitations sent");
});

/* ============================== public side (the link) ============================== */

async function findLive(codeRaw: unknown) {
  const code = normCode(codeRaw);
  const m: any = code ? await Meeting.findOne({ code }) : null;
  if (!m || m.status !== "active" || isExpired(m)) throw ApiError.notFound("This meeting link is not valid, or the meeting has ended");
  return m;
}

/** What the join page shows before anyone enters. Tells outsiders nothing about private meetings. */
export const lookup = catchAsync(async (req: Request, res: Response) => {
  if (!limit(`look:${req.ip}`, 60, 10 * 60e3)) return tooMany(res);
  const m = await findLive(req.params.code);
  const user = await optionalUser(req);
  if (!user && m.access !== "open") return sendSuccess(res, 200, { requiresLogin: true }, "Log in to join");

  const e = await entryFor(m, user?.id);
  if (!e.allowed) throw ApiError.forbidden("You are not invited to this meeting");
  const host: any = await User.findById(m.hostId).select("name").lean();
  return sendSuccess(
    res, 200,
    {
      title: m.title, hostName: host?.name || "", access: m.access, requiresPasscode: !!m.hasPasscode && !e.trusted, waiting: m.waitingRoom && !e.trusted,
      locked: m.locked && !e.isHost, guest: !user, displayName: user?.name || "", live: liveCount(String(m._id)), maxParticipants: m.maxParticipants, scheduledAt: m.scheduledAt || null,
    },
    "Meeting"
  );
});

/** body { name?, passcode? } -> a short-lived token for the live room, plus the ICE servers. */
export const joinMeeting = catchAsync(async (req: Request, res: Response) => {
  if (!limit(`join:${req.ip}:${req.params.code}`, 20, 10 * 60e3)) return tooMany(res);
  const m = await findLive(req.params.code);
  const user = await optionalUser(req);
  if (!user && m.access !== "open") throw ApiError.unauthorized("Log in to join this meeting");

  const e = await entryFor(m, user?.id);
  if (!e.allowed) throw ApiError.forbidden("You are not invited to this meeting");
  if (m.locked && !e.isHost) return res.status(423).json({ success: false, message: "The host has locked this meeting" });

  if (m.hasPasscode && !e.trusted) {
    if (!limit(`pw:${req.ip}:${m._id}`, 8, 10 * 60e3)) return tooMany(res);
    const full: any = await Meeting.findById(m._id).select("+passcodeHash");
    const ok = typeof req.body?.passcode === "string" && !!full?.passcodeHash && (await bcrypt.compare(req.body.passcode, full.passcodeHash));
    if (!ok) throw ApiError.forbidden("The passcode is wrong");
  }

  const name = user ? user.name : cleanName(req.body?.name);
  if (name.length < 2) throw ApiError.badRequest("Please enter your name");

  const pid = crypto.randomUUID();
  const wait = !!m.waitingRoom && !e.trusted;
  const token = signMeetToken({ mid: String(m._id), pid, name, uid: user?.id, wait, host: e.isHost });
  return sendSuccess(
    res, 200,
    {
      token, participantId: pid, waiting: wait, isHost: e.isHost, guest: !user, name, iceServers: iceServers(pid),
      meeting: { _id: m._id, title: m.title, shareBy: m.shareBy, chatEnabled: m.chatEnabled, maxParticipants: m.maxParticipants },
    },
    wait ? "Wait for the host to let you in" : "Joined"
  );
});