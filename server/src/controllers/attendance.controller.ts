import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { ActivityLog } from "../models/ActivityLog";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { AttendanceRecord, AttendanceSettings, Holiday, LeaveRequest } from "../models/Attendance";
import {
  MODES, addDays, buildContext, dayInfo, dayKeyIn, dayView, daysBetween, eachDay, getSettings, hmIn, hmToMin, isDate, minutesOfDay, monthRange,
  personStart, rating, summarize, validTz,
} from "../services/attendanceCalc";
import { listPeople, trackedPeople } from "../services/attendanceMembers";
import { balances } from "./leave.controller";
import { sendToUsers } from "../services/projectEvents";
import { attendanceEditedEmail, attendanceUrl } from "../utils/attendanceEmailTemplates";
import { buildReportFile } from "../services/attendanceExport";

const ID = /^[a-f\d]{24}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const log = (workspaceId: string, actorId: string, action: string, resourceId: unknown, metadata: Record<string, unknown> = {}) =>
  ActivityLog.create({ workspaceId, actorId, action, resourceType: "Attendance", resourceId, metadata }).catch(() => undefined);
const wsName = async (id: string) => ((await Workspace.findById(id).select("name").lean()) as any)?.name || "your workspace";

function needDate(v: unknown, name: string) {
  if (!isDate(v)) throw ApiError.badRequest(`${name} must be a date like 2026-11-30`);
  return v;
}

/** from/to of a request, default = this month, at most 366 days. */
function rangeOf(req: Request, tz: string) {
  const today = dayKeyIn(Date.now(), tz);
  const q = req.query as Record<string, string>;
  let from: string, to: string;
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) ({ from, to } = monthRange(q.month));
  else if (q.from || q.to) {
    from = needDate(q.from, "from");
    to = needDate(q.to, "to");
  } else ({ from, to } = monthRange(today.slice(0, 7)));
  if (to < from) throw ApiError.badRequest("The end date is before the start date");
  if (daysBetween(from, to) > 366) throw ApiError.badRequest("Choose a range of at most one year");
  return { from, to, today };
}

const publicSettings = (s: any) => ({
  timezone: s.timezone, workStart: s.workStart, workEnd: s.workEnd, workingDays: s.workingDays, offSaturdays: s.offSaturdays || [],
  graceMinutes: s.graceMinutes, fullDayMinutes: s.fullDayMinutes, halfDayMinutes: s.halfDayMinutes, trackingStartDate: s.trackingStartDate || null,
  reminderEnabled: !!s.reminderEnabled, reminderTime: s.reminderTime, checkoutReminderEnabled: !!s.checkoutReminderEnabled, checkoutReminderTime: s.checkoutReminderTime,
});

/* ================================= settings ================================= */

export const getSettingsCtl = catchAsync(async (req: Request, res: Response) => {
  const s = await getSettings(req.params.workspaceId, req.user!.id);
  return sendSuccess(res, 200, publicSettings(s), "Attendance settings");
});

export const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const b = req.body || {};
  const cur = await getSettings(workspaceId, req.user!.id);
  const set: Record<string, unknown> = {};

  if (b.timezone !== undefined) {
    if (!validTz(String(b.timezone))) throw ApiError.badRequest("Unknown timezone. Use a name like Asia/Kolkata");
    set.timezone = String(b.timezone);
  }
  for (const k of ["workStart", "workEnd", "reminderTime", "checkoutReminderTime"] as const) {
    if (b[k] !== undefined) {
      if (Number.isNaN(hmToMin(String(b[k])))) throw ApiError.badRequest("Times must look like 09:30");
      set[k] = String(b[k]).padStart(5, "0");
    }
  }
  if (b.workingDays !== undefined) {
    const days = Array.isArray(b.workingDays) ? [...new Set<number>(b.workingDays.map(Number))] : [];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw ApiError.badRequest("Choose at least one working day");
    set.workingDays = days.sort();
  }
  if (b.offSaturdays !== undefined) {
    const offs = Array.isArray(b.offSaturdays) ? [...new Set<number>(b.offSaturdays.map(Number))] : [];
    if (offs.some((d) => !Number.isInteger(d) || d < 1 || d > 5)) throw ApiError.badRequest("Off Saturdays must be between 1 and 5");
    set.offSaturdays = offs.sort();
  }
  const num = (k: string, min: number, max: number) => {
    if (b[k] === undefined) return;
    const n = Math.round(Number(b[k]));
    if (!Number.isFinite(n) || n < min || n > max) throw ApiError.badRequest(`${k} must be between ${min} and ${max}`);
    set[k] = n;
  };
  num("graceMinutes", 0, 240);
  num("fullDayMinutes", 60, 1440);
  num("halfDayMinutes", 30, 1440);
  if (b.trackingStartDate !== undefined) set.trackingStartDate = b.trackingStartDate ? needDate(b.trackingStartDate, "Tracking start date") : null;
  for (const k of ["reminderEnabled", "checkoutReminderEnabled"] as const) if (typeof b[k] === "boolean") set[k] = b[k];

  const start = hmToMin(String(set.workStart ?? cur.workStart));
  const end = hmToMin(String(set.workEnd ?? cur.workEnd));
  if (end <= start) throw ApiError.badRequest("The work day must end after it starts");
  const full = Number(set.fullDayMinutes ?? cur.fullDayMinutes);
  const half = Number(set.halfDayMinutes ?? cur.halfDayMinutes);
  if (half > full) throw ApiError.badRequest("Half day hours cannot be more than full day hours");

  set.updatedBy = req.user!.id;
  const s: any = await AttendanceSettings.findOneAndUpdate({ workspaceId }, { $set: set }, { new: true }).lean();
  await log(workspaceId, req.user!.id, "attendance_settings_updated", s._id, { title: "Attendance settings", fields: Object.keys(set).filter((k) => k !== "updatedBy") });
  return sendSuccess(res, 200, publicSettings(s), "Settings saved");
});

/* ================================== holidays ================================== */

export const listHolidays = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const s = await getSettings(workspaceId, req.user!.id);
  const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : dayKeyIn(Date.now(), s.timezone).slice(0, 4);
  const items = await Holiday.find({ workspaceId, date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).sort({ date: 1 }).lean();
  return sendSuccess(res, 200, { year, holidays: items }, "Holidays");
});

/** body: { date, name } or { holidays: [{ date, name }] } (up to 60). A date that already exists is renamed. */
export const addHolidays = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const list: any[] = Array.isArray(req.body?.holidays) ? req.body.holidays : [req.body];
  if (!list.length || list.length > 60) throw ApiError.badRequest("Add between 1 and 60 holidays at a time");

  const clean = list.map((h) => {
    const name = str(h?.name, 80);
    if (name.length < 2) throw ApiError.badRequest("Every holiday needs a name");
    return { date: needDate(h?.date, "Holiday date"), name };
  });
  await Holiday.bulkWrite(
    clean.map((h) => ({ updateOne: { filter: { workspaceId, date: h.date }, update: { $set: { name: h.name }, $setOnInsert: { createdBy: req.user!.id } }, upsert: true } }))
  );
  await log(workspaceId, req.user!.id, "attendance_holidays_added", workspaceId, { title: `${clean.length} holiday(s)` });
  return sendSuccess(res, 201, { added: clean.length }, "Holidays saved");
});

export const deleteHoliday = catchAsync(async (req: Request, res: Response) => {
  if (!ID.test(req.params.holidayId)) throw ApiError.notFound("Holiday not found");
  const h = await Holiday.findOneAndDelete({ _id: req.params.holidayId, workspaceId: req.params.workspaceId });
  if (!h) throw ApiError.notFound("Holiday not found");
  await log(req.params.workspaceId, req.user!.id, "attendance_holiday_deleted", h._id, { title: h.name });
  return sendSuccess(res, 200, null, "Holiday removed");
});

/* ============================= check in / check out ============================= */

async function todayState(workspaceId: string, userId: string) {
  const s = await getSettings(workspaceId, userId);
  const me: any = await WorkspaceMember.findOne({ workspaceId, userId, status: "active" }).select("joinedAt").lean();
  const ctx = await buildContext(s, workspaceId, ctx0(s), ctx0(s), [userId]);
  const info = dayInfo(ctx, userId, ctx.today, personStart(ctx, me?.joinedAt));
  const open = info.sessions.find((x) => x.out == null);
  return {
    date: ctx.today,
    timezone: ctx.tz,
    now: ctx.nowMs,
    shift: { start: s.workStart, end: s.workEnd, graceMinutes: s.graceMinutes, fullDayMinutes: s.fullDayMinutes, halfDayMinutes: s.halfDayMinutes },
    holiday: info.holiday,
    onLeave: info.status === "leave",
    isWorkingDay: info.status !== "holiday" && info.status !== "weekoff",
    openSince: open ? open.in : null,
    day: dayView(info),
  };
}
const ctx0 = (s: any) => dayKeyIn(Date.now(), s.timezone);

export const getToday = catchAsync(async (req: Request, res: Response) => sendSuccess(res, 200, await todayState(req.params.workspaceId, req.user!.id), "Today"));

export const checkIn = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  const s = await getSettings(workspaceId, uid);
  const now = Date.now();
  const date = dayKeyIn(now, s.timezone);
  const mode = MODES.includes(req.body?.mode) ? req.body.mode : "Office";
  const note = str(req.body?.note, 200);

  const state = await todayState(workspaceId, uid);
  if (state.onLeave) throw ApiError.badRequest("You are on approved leave today. Ask an admin to cancel the leave if you are working.");

  try {
    await AttendanceRecord.findOneAndUpdate(
      { workspaceId, userId: uid, date, sessions: { $not: { $elemMatch: { out: null } } } },
      { $push: { sessions: { in: new Date(now), out: null, mode, note: note || undefined, by: "self" } } },
      { upsert: true, new: true }
    );
  } catch (e: any) {
    if (e?.code === 11000) throw ApiError.conflict("You are already checked in. Check out first.");
    throw e;
  }
  return sendSuccess(res, 201, await todayState(workspaceId, uid), "Checked in");
});

export const checkOut = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  const s = await getSettings(workspaceId, uid);
  const now = Date.now();
  const date = dayKeyIn(now, s.timezone);

  const rec: any = await AttendanceRecord.findOne({ workspaceId, userId: uid, date: { $in: [date, addDays(date, -1)] }, "sessions.out": null }).sort({ date: -1 });
  if (!rec) throw ApiError.badRequest("You are not checked in.");
  const idx = rec.sessions.findIndex((x: any) => !x.out);
  const started = +new Date(rec.sessions[idx].in);
  if (now - started > 16 * 3600e3) {
    throw ApiError.conflict(`Your check-in of ${rec.date} (${hmIn(started, s.timezone)}) was never closed. Ask an admin to correct it, then check in again.`);
  }

  const done = await AttendanceRecord.updateOne({ _id: rec._id, [`sessions.${idx}.out`]: null }, { $set: { [`sessions.${idx}.out`]: new Date(now) } });
  if (!done.matchedCount) throw ApiError.conflict("You were already checked out.");
  return sendSuccess(res, 200, await todayState(workspaceId, uid), "Checked out");
});

/* ============================== my attendance ============================== */

export const myMonth = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  const s = await getSettings(workspaceId, uid);
  const { from, to, today } = rangeOf(req, s.timezone);
  const me: any = await WorkspaceMember.findOne({ workspaceId, userId: uid, status: "active" }).select("joinedAt").lean();

  const ctx = await buildContext(s, workspaceId, from, to, [uid]);
  const start = personStart(ctx, me?.joinedAt);
  const days = eachDay(from, to).map((d) => dayInfo(ctx, uid, d, start));
  const summary = summarize(days, ctx);

  const upcoming = await Holiday.find({ workspaceId, date: { $gte: today } }).sort({ date: 1 }).limit(4).lean();
  const bal = await balances(workspaceId, uid, Number(today.slice(0, 4)));

  return sendSuccess(
    res, 200,
    { from, to, days: days.map(dayView), summary, rating: rating(summary.score), leaveBalances: bal, upcomingHolidays: upcoming.map((h: any) => ({ date: h.date, name: h.name })), shift: publicSettings(s) },
    "My attendance"
  );
});

/* ============================== admin: live board ============================== */

export const liveBoard = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const s = await getSettings(workspaceId, req.user!.id);
  const date = req.query.date ? needDate(req.query.date, "date") : dayKeyIn(Date.now(), s.timezone);

  const people = await trackedPeople(workspaceId);
  const ctx = await buildContext(s, workspaceId, date, date, people.map((p) => p.userId));

  const rows = people.map((p) => {
    const d = dayInfo(ctx, p.userId, date, personStart(ctx, p.joinedAt));
    return { userId: p.userId, memberId: p.memberId, name: p.name, email: p.email, profileImage: p.profileImage, designation: p.designation, ...dayView(d) };
  });
  const count = (f: (r: any) => boolean) => rows.filter(f).length;
  const summary = {
    total: rows.length,
    present: count((r) => ["present", "working", "incomplete"].includes(r.status)),
    late: count((r) => r.late && r.firstIn != null),
    halfDay: count((r) => r.status === "half_day"),
    absent: count((r) => r.status === "absent"),
    notYet: count((r) => r.status === "pending"),
    onLeave: count((r) => r.status === "leave"),
    stillIn: count((r) => r.sessions.some((x: any) => x.out == null)),
  };
  const dayType = ctx.holidays.get(date) ? "holiday" : rows.length && rows.every((r) => r.status === "weekoff") ? "weekoff" : "working";
  return sendSuccess(res, 200, { date, today: ctx.today, timezone: ctx.tz, dayType, holiday: ctx.holidays.get(date) || null, rows, summary, shift: publicSettings(s) }, "Live board");
});

/* ============================== admin: team summary ============================== */

export const teamSummary = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const s = await getSettings(workspaceId, req.user!.id);
  const { from, to } = rangeOf(req, s.timezone);

  const people = await trackedPeople(workspaceId);
  if (people.length > 500) throw ApiError.badRequest("Too many people for one report. Choose a shorter range.");
  const ctx = await buildContext(s, workspaceId, from, to, people.map((p) => p.userId));
  const end = to > ctx.today ? ctx.today : to;

  const rows = people.map((p) => {
    const start = personStart(ctx, p.joinedAt);
    const days = from <= end ? eachDay(from, end).map((d) => dayInfo(ctx, p.userId, d, start)) : [];
    const summary = summarize(days, ctx);
    return { userId: p.userId, memberId: p.memberId, name: p.name, email: p.email, profileImage: p.profileImage, designation: p.designation, summary, rating: rating(summary.score) };
  });

  const scored = rows.filter((r) => r.summary.score != null);
  const avg = (f: (r: (typeof rows)[number]) => number) => (scored.length ? Math.round(scored.reduce((a, r) => a + f(r), 0) / scored.length) : null);
  const overall = {
    people: rows.length,
    avgScore: avg((r) => r.summary.score as number),
    avgAttendance: avg((r) => r.summary.attendanceRate ?? 0),
    avgPunctuality: avg((r) => r.summary.punctuality),
    totalLate: rows.reduce((a, r) => a + r.summary.late, 0),
    totalAbsent: rows.reduce((a, r) => a + r.summary.absent, 0),
    totalLeaveDays: Math.round(rows.reduce((a, r) => a + r.summary.paidLeave + r.summary.unpaidLeave, 0) * 10) / 10,
    totalHours: Math.round(rows.reduce((a, r) => a + r.summary.workedMinutes, 0) / 60),
    ratingSpread: [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: rows.filter((r) => r.rating.stars === n).length })),
  };
  return sendSuccess(res, 200, { from, to, rows, overall, shift: publicSettings(s) }, "Team attendance");
});

/** One person's days in a range (admins use this for any person). */
export const employeeDetail = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, userId } = req.params;
  if (!ID.test(userId)) throw ApiError.notFound("Person not found");
  const s = await getSettings(workspaceId, req.user!.id);
  const { from, to } = rangeOf(req, s.timezone);

  const person = (await listPeople(workspaceId)).find((p) => p.userId === userId);
  if (!person) throw ApiError.notFound("Person not found");
  const ctx = await buildContext(s, workspaceId, from, to, [userId]);
  const start = personStart(ctx, person.joinedAt);
  const days = eachDay(from, to).map((d) => dayInfo(ctx, userId, d, start));
  const summary = summarize(days, ctx);
  const leave = await LeaveRequest.find({ workspaceId, userId, from: { $lte: to }, to: { $gte: from } }).populate("typeId", "name code color").sort({ from: -1 }).limit(50).lean();

  return sendSuccess(
    res, 200,
    {
      person: { userId, name: person.name, email: person.email, profileImage: person.profileImage, designation: person.designation, tracked: person.tracked, exempt: person.exempt },
      from, to, days: days.map(dayView), summary, rating: rating(summary.score), leaveRequests: leave,
    },
    "Attendance of a person"
  );
});

/** Month sheet: every person x every day (one short code per cell). */
export const monthMatrix = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const s = await getSettings(workspaceId, req.user!.id);
  const { from, to } = rangeOf(req, s.timezone);
  if (daysBetween(from, to) > 62) throw ApiError.badRequest("The month sheet shows at most two months");

  const people = await trackedPeople(workspaceId);
  const ctx = await buildContext(s, workspaceId, from, to, people.map((p) => p.userId));
  const dates = eachDay(from, to);
  const rows = people.map((p) => {
    const start = personStart(ctx, p.joinedAt);
    const days = dates.map((d) => dayInfo(ctx, p.userId, d, start));
    const code = (d: (typeof days)[number]) => {
      switch (d.status) {
        case "present": return d.late ? "PL" : "P";
        case "working": return d.late ? "PL" : "P";
        case "half_day": return "HD";
        case "absent": return "A";
        case "leave": return "L";
        case "holiday": return "H";
        case "weekoff": return "W";
        case "incomplete": return "I";
        case "pending": return "-";
        default: return "";
      }
    };
    const sum = summarize(days, ctx);
    return { userId: p.userId, name: p.name, profileImage: p.profileImage, codes: days.map(code), present: sum.present, halfDays: sum.halfDays, absent: sum.absent, late: sum.late, leave: sum.paidLeave + sum.unpaidLeave };
  });
  return sendSuccess(res, 200, { from, to, dates, rows, holidays: [...ctx.holidays].map(([date, name]) => ({ date, name })) }, "Month sheet");
});

/* ============================== admin: corrections ============================== */

/**
 * PUT /records  body { userId, date, sessions?: [{ in, out, mode }], manualStatus?: "" | present | half_day | absent, note }
 * Replaces the sessions of that day and/or sets a manual verdict. A reason is required, the person gets an email.
 */
export const editRecord = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const actor = req.user!.id;
  const b = req.body || {};
  if (!ID.test(String(b.userId))) throw ApiError.badRequest("Choose a person");
  const note = str(b.note, 300);
  if (note.length < 3) throw ApiError.badRequest("Write a short reason for the change");

  const s = await getSettings(workspaceId, actor);
  const date = needDate(b.date, "date");
  const today = dayKeyIn(Date.now(), s.timezone);
  if (date > today) throw ApiError.badRequest("You cannot edit a day in the future");
  const person = (await listPeople(workspaceId)).find((p) => p.userId === String(b.userId));
  if (!person) throw ApiError.notFound("Person not found in this workspace");

  const set: Record<string, unknown> = { editedBy: actor, editedAt: new Date() };
  const unset: Record<string, unknown> = {};

  if (b.sessions !== undefined) {
    if (!Array.isArray(b.sessions) || b.sessions.length > 8) throw ApiError.badRequest("A day can have at most 8 sessions");
    const clean = b.sessions
      .map((x: any) => {
        const i = +new Date(x?.in);
        const o = x?.out ? +new Date(x.out) : null;
        if (!Number.isFinite(i)) throw ApiError.badRequest("Every session needs a check-in time");
        if (dayKeyIn(i, s.timezone) !== date) throw ApiError.badRequest(`Check-in times must be on ${date} (${s.timezone})`);
        if (o != null && (!Number.isFinite(o) || o <= i)) throw ApiError.badRequest("A check-out must be after its check-in");
        if (o != null && o - i > 20 * 3600e3) throw ApiError.badRequest("A session cannot be longer than 20 hours");
        if (o != null && o > Date.now()) throw ApiError.badRequest("A check-out cannot be in the future");
        if (o == null && date !== today) throw ApiError.badRequest("Past days need a check-out time");
        return { in: new Date(i), out: o != null ? new Date(o) : null, mode: MODES.includes(x?.mode) ? x.mode : "Office", by: "admin" as const };
      })
      .sort((a: any, c: any) => +a.in - +c.in);
    for (let k = 1; k < clean.length; k++) if (!clean[k - 1].out || +clean[k - 1].out > +clean[k].in) throw ApiError.badRequest("Sessions cannot overlap");
    set.sessions = clean;
  }
  if (b.manualStatus !== undefined) {
    if (b.manualStatus === "" || b.manualStatus === null) { unset.manualStatus = ""; unset.manualNote = ""; }
    else if (["present", "half_day", "absent"].includes(b.manualStatus)) { set.manualStatus = b.manualStatus; set.manualNote = note; }
    else throw ApiError.badRequest("Status must be present, half_day or absent");
  }
  if (!("sessions" in set) && !("manualStatus" in set) && !("manualStatus" in unset)) throw ApiError.badRequest("Nothing to change");

  const rec: any = await AttendanceRecord.findOneAndUpdate(
    { workspaceId, userId: b.userId, date },
    { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $push: { editLog: { $each: [{ by: actor, at: new Date(), note }], $slice: -20 } } },
    { upsert: true, new: true }
  );

  const ctx = await buildContext(s, workspaceId, date, date, [person.userId]);
  const info = dayInfo(ctx, person.userId, date, "0000-00-00");
  const summary = `${info.status.replace("_", " ")}${info.firstIn ? `, in ${hmIn(info.firstIn, s.timezone)}` : ""}${info.lastOut ? `, out ${hmIn(info.lastOut, s.timezone)}` : ""}`;
   const byName = ((await User.findById(actor).select("name").lean()) as any)?.name || "An admin";
  const wname = await wsName(workspaceId);
  if (person.userId !== actor) {
    void sendToUsers([person.userId], actor, () => attendanceEditedEmail({ workspaceName: wname, date, by: byName, note, summary, url: attendanceUrl(workspaceId) }));
  }
  await log(workspaceId, actor, "attendance_corrected", rec._id, { title: `${person.name} · ${date}`, note });
  return sendSuccess(res, 200, dayView(info), "Attendance updated");
});

export const deleteRecord = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const userId = String(req.query.userId || "");
  if (!ID.test(userId)) throw ApiError.badRequest("Choose a person");
  const date = needDate(req.query.date, "date");
  const note = str(req.query.note, 300);
  if (note.length < 3) throw ApiError.badRequest("Write a short reason");
  const rec: any = await AttendanceRecord.findOneAndDelete({ workspaceId, userId, date });
  if (!rec) throw ApiError.notFound("There is no record for that day");
  await log(workspaceId, req.user!.id, "attendance_record_deleted", rec._id, { title: `${userId} · ${date}`, note });
  return sendSuccess(res, 200, null, "Record cleared");
});

/** People list for the settings page (who is tracked, who is exempt). */
export const trackingList = catchAsync(async (req: Request, res: Response) => {
  const people = await listPeople(req.params.workspaceId);
  return sendSuccess(
    res, 200,
    people.map((p) => ({ memberId: p.memberId, userId: p.userId, name: p.name, email: p.email, profileImage: p.profileImage, roleName: p.roleName, designation: p.designation, canMark: p.canMark, exempt: p.exempt, tracked: p.tracked })),
    "Tracking"
  );
});

export const setTracking = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  if (!ID.test(memberId)) throw ApiError.notFound("Member not found");
  const m: any = await WorkspaceMember.findOneAndUpdate({ _id: memberId, workspaceId, status: "active" }, { $set: { attendanceExempt: !!req.body?.exempt } }, { new: true });
  if (!m) throw ApiError.notFound("Member not found");
  await log(workspaceId, req.user!.id, m.attendanceExempt ? "attendance_member_exempted" : "attendance_member_tracked", m._id, { title: String(m.userId) });
  return sendSuccess(res, 200, { exempt: !!m.attendanceExempt }, "Saved");
});

/* ================================== export ================================== */

/** GET /export?format=xlsx|pdf&month= or from&to=, optional userId. Your own report needs only attendance.view, everyone's needs attendance.export. */
export const exportReport = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  const format = req.query.format === "pdf" ? "pdf" : "xlsx";
  const only = req.query.userId ? String(req.query.userId) : "";
  if (only && !ID.test(only)) throw ApiError.badRequest("Choose a person");
  if (!(only && only === uid) && !req.access!.perms.has("attendance.export")) {
    throw ApiError.forbidden("You do not have permission to download everybody's attendance (Attendance: Download reports)");
  }

  const s = await getSettings(workspaceId, uid);
  const { from, to } = rangeOf(req, s.timezone);
  const everyone = await listPeople(workspaceId);
  const people = only ? everyone.filter((p) => p.userId === only) : everyone.filter((p) => p.tracked);
  if (!people.length) throw ApiError.notFound("Nobody to report on");
  if (people.length > 300) throw ApiError.badRequest("Too many people for one file. Choose a shorter range.");

  const ctx = await buildContext(s, workspaceId, from, to, people.map((p) => p.userId));
  const end = to > ctx.today ? ctx.today : to;
  const rows = people.map((p) => {
    const start = personStart(ctx, p.joinedAt);
    const days = from <= end ? eachDay(from, end).map((d) => dayInfo(ctx, p.userId, d, start)) : [];
    const summary = summarize(days, ctx);
    return { name: p.name, email: p.email, designation: p.designation || "", summary, rating: rating(summary.score), days };
  });

  const file = await buildReportFile(format, { workspaceName: await wsName(workspaceId), from, to, tz: ctx.tz, single: !!only, rows, settings: publicSettings(s) });
  await log(workspaceId, uid, "attendance_exported", workspaceId, { title: `${format.toUpperCase()} ${from} to ${to}`, people: people.length });

  const name = `attendance-${only ? people[0].name.replace(/[^\w-]+/g, "-").toLowerCase() + "-" : ""}${from}_to_${to}.${format}`;
  res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(file);
});

// small helper kept here so the controller above reads top-down
export const _unused = { minutesOfDay, hmToMin };