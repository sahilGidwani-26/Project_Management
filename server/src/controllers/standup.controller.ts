import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { PReq } from "../utils/projectAccess";
import { User } from "../models/User";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { StandupNote } from "../models/Standup";
import { buildMemberStandup, buildTeamStandup, localParts, safeTz, sendDigest } from "../services/standup";
import { env } from "../config/env";

async function assertMember(workspaceId: string, userId: string) {
  if (!/^[a-f\d]{24}$/i.test(workspaceId)) throw ApiError.badRequest("Invalid workspace id");
  const m = await WorkspaceMember.findOne({ workspaceId, userId, status: "active" }).select("_id");
  if (!m) throw ApiError.forbidden("You are not a member of this workspace");
}

const prefsOf = (u: any) => ({ standupDigest: !!u?.notificationPreferences?.standupDigest, standupHour: u?.notificationPreferences?.standupHour ?? 9 });

/** GET /standup/workspace/:workspaceId/me: my own standup across every project in the workspace. */
export const myStandup = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  await assertMember(workspaceId, uid);

  const me: any = await User.findById(uid).select("timezone notificationPreferences");
  const tz = safeTz(me?.timezone);
  const standup = await buildMemberStandup({ workspaceId, userId: uid, tz });
  const note: any = await StandupNote.findOne({ workspaceId, userId: uid, day: standup.day }).lean();

  return sendSuccess(
    res, 200,
    { ...standup, note: note ? { plan: note.plan, blockers: note.blockers, away: note.away } : null, timezone: tz, prefs: prefsOf(me), emailConfigured: !!env.SMTP_HOST },
    "standup"
  );
});

/** PUT /standup/workspace/:workspaceId/note: my own words for today. */
export const saveNote = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  await assertMember(workspaceId, uid);

  const me: any = await User.findById(uid).select("timezone");
  const day = localParts(Date.now(), safeTz(me?.timezone)).day;
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 1000) : "");
  const note = await StandupNote.findOneAndUpdate(
    { workspaceId, userId: uid, day },
    { $set: { plan: text(req.body.plan), blockers: text(req.body.blockers), away: !!req.body.away } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return sendSuccess(res, 200, { plan: note.plan, blockers: note.blockers, away: note.away, day }, "Note saved");
});

/** GET /projects/:projectId/standup: the whole team of one project. */
export const projectStandup = catchAsync(async (req: Request, res: Response) => {
  const me: any = await User.findById(req.user!.id).select("timezone");
  return sendSuccess(res, 200, await buildTeamStandup((req as PReq).project, safeTz(me?.timezone)), "team standup");
});

/** POST /standup/workspace/:workspaceId/email-me: send my digest right now (for testing / on demand). */
export const emailMe = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  await assertMember(workspaceId, uid);
  const me: any = await User.findById(uid).select("name email timezone");
  const result = await sendDigest(me, workspaceId, { force: true });
  if (!result.sent) throw ApiError.badRequest(result.reason || "Could not send the email");
  return sendSuccess(res, 200, null, `Sent to ${me.email}`);
});

export const getPrefs = catchAsync(async (req: Request, res: Response) => {
  const me: any = await User.findById(req.user!.id).select("notificationPreferences");
  return sendSuccess(res, 200, prefsOf(me), "prefs");
});

export const patchPrefs = catchAsync(async (req: Request, res: Response) => {
  const set: Record<string, unknown> = {};
  if (typeof req.body.standupDigest === "boolean") set["notificationPreferences.standupDigest"] = req.body.standupDigest;
  if (req.body.standupHour !== undefined) {
    const h = Math.round(Number(req.body.standupHour));
    if (!Number.isFinite(h) || h < 5 || h > 12) throw ApiError.badRequest("Choose an hour between 5 and 12");
    set["notificationPreferences.standupHour"] = h;
  }
  if (Object.keys(set).length) await User.updateOne({ _id: req.user!.id }, { $set: set });
  const me: any = await User.findById(req.user!.id).select("notificationPreferences");
  return sendSuccess(res, 200, prefsOf(me), "Preferences saved");
});