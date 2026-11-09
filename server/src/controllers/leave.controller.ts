import { Request, Response } from "express";
import { Types } from "mongoose";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { ActivityLog } from "../models/ActivityLog";
import { Notification } from "../models/Notification";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { Holiday, LeaveRequest, LeaveType } from "../models/Attendance";
import { addDays, dayKeyIn, daysBetween, getSettings, isDate, leaveDaysCount } from "../services/attendanceCalc";
import { usersWithPerm } from "../services/attendanceMembers";
import { sendToUsers } from "../services/projectEvents";
import { attendanceUrl, leaveCancelledEmail, leaveDecisionEmail, leaveRequestedEmail } from "../utils/attendanceEmailTemplates";

const ID = /^[a-f\d]{24}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const wsName = async (id: string) => ((await Workspace.findById(id).select("name").lean()) as any)?.name || "your workspace";
const userName = async (id: string) => ((await User.findById(id).select("name").lean()) as any)?.name || "Someone";
const log = (workspaceId: string, actorId: string, action: string, resourceId: unknown, metadata: Record<string, unknown> = {}) =>
  ActivityLog.create({ workspaceId, actorId, action, resourceType: "Leave", resourceId, metadata }).catch(() => undefined);

async function notify(userIds: string[], io: any, workspaceId: string, title: string, message: string) {
  for (const id of userIds) {
    await (Notification as any).create({ userId: id, type: "leave", title, message, relatedWorkspaceId: workspaceId }).catch(() => undefined);
    io?.to(`user:${id}`).emit("notification:new", { title });
  }
}

/* ------------------------------- balances ------------------------------- */

/** Quota, used (approved) and pending days per leave type for one calendar year. */
export async function balances(workspaceId: string, userId: string, year: number) {
  const [types, rows]: [any[], any[]] = await Promise.all([
    LeaveType.find({ workspaceId, active: true }).sort({ order: 1, name: 1 }).lean() as any,
    LeaveRequest.aggregate([
      { $match: { workspaceId: new Types.ObjectId(workspaceId), userId: new Types.ObjectId(userId), from: { $gte: `${year}-01-01`, $lte: `${year}-12-31` }, status: { $in: ["approved", "pending"] } } },
      { $group: { _id: { t: "$typeId", s: "$status" }, days: { $sum: "$days" } } },
    ]),
  ]);
  const get = (t: any, s: string) => rows.find((r) => String(r._id.t) === String(t._id) && r._id.s === s)?.days || 0;
  return types.map((t) => {
    const used = get(t, "approved");
    const pending = get(t, "pending");
    return {
      typeId: String(t._id), name: t.name, code: t.code, color: t.color, paid: t.paid, quota: t.yearlyQuota,
      used, pending, remaining: t.yearlyQuota > 0 ? Math.max(t.yearlyQuota - used - pending, 0) : null,
    };
  });
}

export const myBalance = catchAsync(async (req: Request, res: Response) => {
  const s = await getSettings(req.params.workspaceId, req.user!.id);
  const year = /^\d{4}$/.test(String(req.query.year)) ? Number(req.query.year) : Number(dayKeyIn(Date.now(), s.timezone).slice(0, 4));
  return sendSuccess(res, 200, { year, balances: await balances(req.params.workspaceId, req.user!.id, year) }, "Leave balance");
});

/* ---------------------------------- types ---------------------------------- */

export const listTypes = catchAsync(async (req: Request, res: Response) => {
  await getSettings(req.params.workspaceId, req.user!.id); // makes sure the default types exist
  const items = await LeaveType.find({ workspaceId: req.params.workspaceId }).sort({ order: 1, name: 1 }).lean();
  return sendSuccess(res, 200, items, "Leave types");
});

function typeFields(b: any, partial = false) {
  const out: Record<string, unknown> = {};
  if (b.name !== undefined || !partial) {
    const n = str(b.name, 40);
    if (n.length < 2) throw ApiError.badRequest("Leave type name must be 2 to 40 characters");
    out.name = n;
    out.nameLower = n.toLowerCase();
  }
  if (b.code !== undefined) out.code = str(b.code, 6).toUpperCase() || "L";
  if (b.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(b.color))) throw ApiError.badRequest("Color must look like #1A2B3C");
    out.color = b.color;
  }
  if (b.yearlyQuota !== undefined) {
    const q = Math.round(Number(b.yearlyQuota));
    if (!Number.isFinite(q) || q < 0 || q > 366) throw ApiError.badRequest("Yearly quota must be between 0 and 366 (0 = no limit)");
    out.yearlyQuota = q;
  }
  if (typeof b.paid === "boolean") out.paid = b.paid;
  if (typeof b.active === "boolean") out.active = b.active;
  return out;
}

export const createType = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  await getSettings(workspaceId, req.user!.id);
  const f = typeFields(req.body || {});
  try {
    const t = await LeaveType.create({ workspaceId, ...f, order: await LeaveType.countDocuments({ workspaceId }) });
    await log(workspaceId, req.user!.id, "leave_type_created", t._id, { title: t.name });
    return sendSuccess(res, 201, t, "Leave type created");
  } catch (e: any) {
    if (e?.code === 11000) throw ApiError.conflict("A leave type with this name already exists");
    throw e;
  }
});

export const updateType = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, typeId } = req.params;
  if (!ID.test(typeId)) throw ApiError.notFound("Leave type not found");
  try {
    const t = await LeaveType.findOneAndUpdate({ _id: typeId, workspaceId }, { $set: typeFields(req.body || {}, true) }, { new: true });
    if (!t) throw ApiError.notFound("Leave type not found");
    await log(workspaceId, req.user!.id, "leave_type_updated", t._id, { title: t.name });
    return sendSuccess(res, 200, t, "Saved");
  } catch (e: any) {
    if (e?.code === 11000) throw ApiError.conflict("A leave type with this name already exists");
    throw e;
  }
});

/** A leave type that was ever used is only switched off (history stays). An unused one is deleted. */
export const deleteType = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, typeId } = req.params;
  if (!ID.test(typeId)) throw ApiError.notFound("Leave type not found");
  const t: any = await LeaveType.findOne({ _id: typeId, workspaceId });
  if (!t) throw ApiError.notFound("Leave type not found");
  if (await LeaveRequest.exists({ workspaceId, typeId })) {
    t.active = false;
    await t.save();
    return sendSuccess(res, 200, { deactivated: true }, "This type was used before, so it was switched off instead of deleted");
  }
  await t.deleteOne();
  await log(workspaceId, req.user!.id, "leave_type_deleted", t._id, { title: t.name });
  return sendSuccess(res, 200, { deactivated: false }, "Leave type deleted");
});

/* -------------------------------- requests -------------------------------- */

const view = (r: any) => ({
  _id: r._id, from: r.from, to: r.to, half: r.half, days: r.days, reason: r.reason, status: r.status, reviewNote: r.reviewNote || "", reviewedAt: r.reviewedAt || null, createdAt: r.createdAt,
  user: r.userId && r.userId._id ? { _id: r.userId._id, name: r.userId.name, email: r.userId.email, profileImage: r.userId.profileImage } : r.userId,
  type: r.typeId && r.typeId._id ? { _id: r.typeId._id, name: r.typeId.name, code: r.typeId.code, color: r.typeId.color, paid: r.typeId.paid } : r.typeId,
  reviewedBy: r.reviewedBy && r.reviewedBy._id ? { _id: r.reviewedBy._id, name: r.reviewedBy.name } : null,
});

/** ?scope=mine (default) | all (needs leave.approve) &status= &year= &userId= */
export const listRequests = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const q = req.query as Record<string, string>;
  const all = q.scope === "all";
  if (all && !req.access!.perms.has("leave.approve")) throw ApiError.forbidden("You do not have permission to see everybody's leave");

  const filter: any = { workspaceId };
  if (!all) filter.userId = req.user!.id;
  else if (q.userId && ID.test(q.userId)) filter.userId = q.userId;
  if (["pending", "approved", "rejected", "cancelled"].includes(q.status)) filter.status = q.status;
  if (/^\d{4}$/.test(q.year || "")) filter.from = { $gte: `${q.year}-01-01`, $lte: `${q.year}-12-31` };

  const items = await LeaveRequest.find(filter).sort({ from: -1, createdAt: -1 }).limit(300)
    .populate("userId", "name email profileImage").populate("typeId", "name code color paid").populate("reviewedBy", "name").lean();
  const pending = all ? await LeaveRequest.countDocuments({ workspaceId, status: "pending" }) : undefined;
  return sendSuccess(res, 200, { items: items.map(view), pending }, "Leave requests");
});

/** body: { typeId, from, to, half: none|first|second, reason } */
export const createRequest = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  const b = req.body || {};

  if (!ID.test(String(b.typeId))) throw ApiError.badRequest("Choose a leave type");
  if (!isDate(b.from) || !isDate(b.to)) throw ApiError.badRequest("Choose the dates of your leave");
  if (b.to < b.from) throw ApiError.badRequest("The last day is before the first day");
  if (daysBetween(b.from, b.to) > 60) throw ApiError.badRequest("A single request can cover at most 60 days");
  if (b.from.slice(0, 4) !== b.to.slice(0, 4)) throw ApiError.badRequest("A request cannot cross the new year. Make one request for each year.");
  const reason = str(b.reason, 500);
  if (reason.length < 3) throw ApiError.badRequest("Please write a short reason");
  const half = b.from === b.to && ["first", "second"].includes(b.half) ? b.half : "none";

  const s = await getSettings(workspaceId, uid);
  const today = dayKeyIn(Date.now(), s.timezone);
  if (b.from < addDays(today, -60)) throw ApiError.badRequest("You cannot apply for leave more than 60 days in the past");
  if (b.to > addDays(today, 366)) throw ApiError.badRequest("That date is too far ahead");

  const type: any = await LeaveType.findOne({ _id: b.typeId, workspaceId, active: true }).lean();
  if (!type) throw ApiError.badRequest("That leave type is not available");

  const hol = await Holiday.find({ workspaceId, date: { $gte: b.from, $lte: b.to } }).distinct("date");
  const days = leaveDaysCount(s, new Set<string>(hol), b.from, b.to, half);
  if (days <= 0) throw ApiError.badRequest("These dates are all holidays or week-offs, so no leave is needed");

  if (await LeaveRequest.exists({ workspaceId, userId: uid, status: { $in: ["pending", "approved"] }, from: { $lte: b.to }, to: { $gte: b.from } })) {
    throw ApiError.conflict("You already have a leave request for some of these dates");
  }
  if (type.yearlyQuota > 0) {
    const bal = (await balances(workspaceId, uid, Number(b.from.slice(0, 4)))).find((x) => x.typeId === String(type._id));
    const left = bal?.remaining ?? type.yearlyQuota;
    if (days > left) throw ApiError.badRequest(`You have only ${left} day(s) of ${type.name} left this year. This request needs ${days}.`);
  }

  const doc: any = await LeaveRequest.create({ workspaceId, userId: uid, typeId: type._id, from: b.from, to: b.to, half, days, reason });

  const [approvers, name, wname] = await Promise.all([usersWithPerm(workspaceId, "leave.approve"), userName(uid), wsName(workspaceId)]);
  const targets = approvers.filter((i) => i !== uid);
  void sendToUsers(targets, uid, () => leaveRequestedEmail({ employee: name, workspaceName: wname, type: type.name, from: b.from, to: b.to, days, reason, url: attendanceUrl(workspaceId, "leave") }));
  await notify(targets, req.app.get("io"), workspaceId, "New leave request", `${name} requested ${days} day(s) of ${type.name}`);
  await log(workspaceId, uid, "leave_requested", doc._id, { title: `${type.name} ${b.from} to ${b.to}`, days });

  return sendSuccess(res, 201, view(doc.toObject()), "Leave requested");
});

export const cancelRequest = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, requestId } = req.params;
  const uid = req.user!.id;
  if (!ID.test(requestId)) throw ApiError.notFound("Request not found");
  const r: any = await LeaveRequest.findOne({ _id: requestId, workspaceId }).populate("typeId", "name");
  if (!r) throw ApiError.notFound("Request not found");

  const mine = String(r.userId) === uid;
  const approver = req.access!.perms.has("leave.approve");
  if (!mine && !approver) throw ApiError.forbidden("You can only cancel your own requests");
  if (!["pending", "approved"].includes(r.status)) throw ApiError.badRequest("This request is already closed");
  const s = await getSettings(workspaceId, uid);
  if (mine && !approver && r.status === "approved" && r.from <= dayKeyIn(Date.now(), s.timezone)) {
    throw ApiError.badRequest("Leave that has already started can only be cancelled by an approver");
  }

  const wasApproved = r.status === "approved";
  r.status = "cancelled";
  await r.save();

  const [by, owner, wname] = await Promise.all([userName(uid), userName(String(r.userId)), wsName(workspaceId)]);
  const type = r.typeId?.name || "Leave";
  if (!mine) {
    void sendToUsers([String(r.userId)], uid, () => leaveCancelledEmail({ by, employee: owner, workspaceName: wname, type, from: r.from, to: r.to, revoked: true, url: attendanceUrl(workspaceId, "leave") }));
  } else if (wasApproved) {
    const targets = (await usersWithPerm(workspaceId, "leave.approve")).filter((i) => i !== uid);
    void sendToUsers(targets, uid, () => leaveCancelledEmail({ by, employee: owner, workspaceName: wname, type, from: r.from, to: r.to, revoked: false, url: attendanceUrl(workspaceId, "leave") }));
  }
  await log(workspaceId, uid, "leave_cancelled", r._id, { title: `${owner} · ${r.from} to ${r.to}` });
  return sendSuccess(res, 200, null, "Leave cancelled");
});

/** POST /leave/requests/:id/review body { decision: "approve" | "reject", note } */
export const reviewRequest = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, requestId } = req.params;
  const uid = req.user!.id;
  if (!ID.test(requestId)) throw ApiError.notFound("Request not found");
  const approve = req.body?.decision === "approve";
  if (!approve && req.body?.decision !== "reject") throw ApiError.badRequest("Choose approve or reject");
  const note = str(req.body?.note, 300);
  if (!approve && note.length < 3) throw ApiError.badRequest("Please write a short reason for declining");

  const r: any = await LeaveRequest.findOne({ _id: requestId, workspaceId }).populate("typeId", "name yearlyQuota");
  if (!r) throw ApiError.notFound("Request not found");
  if (r.status !== "pending") throw ApiError.badRequest("This request was already reviewed");
  if (String(r.userId) === uid && !req.access!.isOwner) throw ApiError.forbidden("You cannot review your own leave request");

  if (approve && r.typeId?.yearlyQuota > 0) {
    const bal = (await balances(workspaceId, String(r.userId), Number(r.from.slice(0, 4)))).find((x) => x.typeId === String(r.typeId._id));
    const used = (bal?.used ?? 0) + r.days;
    if (used > r.typeId.yearlyQuota) throw ApiError.badRequest(`Not enough balance: ${bal?.used ?? 0} of ${r.typeId.yearlyQuota} days are already used. Raise the quota or decline.`);
  }

  const done = await LeaveRequest.updateOne(
    { _id: r._id, status: "pending" },
    { $set: { status: approve ? "approved" : "rejected", reviewedBy: uid, reviewedAt: new Date(), reviewNote: note } }
  );
  if (!done.matchedCount) throw ApiError.conflict("Somebody else just reviewed this request");

  const [by, user, wname]: [string, any, string] = await Promise.all([userName(uid), User.findById(r.userId).select("name"), wsName(workspaceId)]);
  const type = r.typeId?.name || "Leave";
  void sendToUsers([String(r.userId)], undefined, () => leaveDecisionEmail({ approved: approve, workspaceName: wname, type, from: r.from, to: r.to, days: r.days, by, note, url: attendanceUrl(workspaceId, "leave") }));
  await notify([String(r.userId)], req.app.get("io"), workspaceId, approve ? "Leave approved" : "Leave declined", `${by} ${approve ? "approved" : "declined"} your ${type}`);
  await log(workspaceId, uid, approve ? "leave_approved" : "leave_rejected", r._id, { title: `${user?.name} · ${r.from} to ${r.to}`, note });
  return sendSuccess(res, 200, null, approve ? "Leave approved" : "Leave declined");
});