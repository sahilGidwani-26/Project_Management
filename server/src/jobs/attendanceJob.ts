import { Server as SocketIOServer } from "socket.io";
import { AttendanceRecord, AttendanceReminderLog, AttendanceSettings, Holiday, LeaveRequest } from "../models/Attendance";
import { Notification } from "../models/Notification";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { sendMail } from "../utils/mailer";
import { dayKeyIn, hmIn, hmToMin, isWorkingDay, minutesOfDay } from "../services/attendanceCalc";
import { trackedPeople } from "../services/attendanceMembers";
import { attendanceUrl, checkInReminderEmail, checkOutReminderEmail } from "../utils/attendanceEmailTemplates";

const EVERY = 5 * 60 * 1000;
const WINDOW = 120; // a reminder may still go out up to 2 hours after its time (so a server restart does not skip the day)

export function startAttendanceJob(io: SocketIOServer) {
  const run = async () => {
    try {
      const list: any[] = await AttendanceSettings.find({ $or: [{ reminderEnabled: true }, { checkoutReminderEnabled: true }] }).lean();
      for (const s of list) {
        try {
          await remind(s, io);
        } catch (e) {
          console.error(`[attendance] workspace ${s.workspaceId} skipped:`, (e as Error).message); // one workspace never stops the rest
        }
      }
    } catch (e) {
      console.error("[attendance] job failed:", e);
    }
  };
  setTimeout(run, 75_000);
  setInterval(run, EVERY);
}

/** True only for the first caller of the day for this person and kind, so nobody gets the same reminder twice. */
async function claim(workspaceId: unknown, userId: unknown, date: string, kind: "checkin" | "checkout") {
  try {
    await AttendanceReminderLog.create({ workspaceId, userId, date, kind });
    return true;
  } catch (e: any) {
    if (e?.code === 11000) return false;
    throw e;
  }
}

async function remind(s: any, io: SocketIOServer) {
  const wid = String(s.workspaceId);
  const tz = s.timezone || "UTC";
  const now = Date.now();
  const date = dayKeyIn(now, tz);
  const mins = minutesOfDay(now, tz);

  // nothing to remind on week-offs, holidays and before tracking starts
  if (!isWorkingDay(date, s)) return;
  if (s.trackingStartDate && date < s.trackingStartDate) return;
  if (await Holiday.exists({ workspaceId: wid, date })) return;

  const inAt = s.reminderEnabled ? hmToMin(s.reminderTime) : NaN;
  const outAt = s.checkoutReminderEnabled ? hmToMin(s.checkoutReminderTime) : NaN;
  const inDue = !Number.isNaN(inAt) && mins >= inAt && mins < inAt + WINDOW;
  const outDue = !Number.isNaN(outAt) && mins >= outAt && mins < outAt + WINDOW;
  if (!inDue && !outDue) return;

  const people = await trackedPeople(wid);
  if (!people.length) return;
  const ids = people.map((p) => p.userId);

  const [records, leaves, ws, users]: [any[], any[], any, any[]] = await Promise.all([
    AttendanceRecord.find({ workspaceId: wid, userId: { $in: ids }, date }).lean() as any,
    // full-day approved leave: a half-day leave still expects a check-in
    LeaveRequest.find({ workspaceId: wid, userId: { $in: ids }, status: "approved", half: "none", from: { $lte: date }, to: { $gte: date } }).select("userId").lean() as any,
    Workspace.findById(wid).select("name").lean(),
    User.find({ _id: { $in: ids }, accountStatus: "active" }).select("name email").lean() as any,
  ]);

  const recBy = new Map(records.map((r) => [String(r.userId), r]));
  const onLeave = new Set(leaves.map((l) => String(l.userId)));
  const userBy = new Map(users.map((u) => [String(u._id), u]));
  const workspaceName = ws?.name || "your workspace";
  const url = attendanceUrl(wid);

  const bell = async (userId: string, title: string, message: string) => {
    await (Notification as any).create({ userId, type: "attendance_reminder", title, message, relatedWorkspaceId: wid }).catch(() => undefined);
    io.to(`user:${userId}`).emit("notification:new", { title });
  };

  for (const p of people) {
    const u = userBy.get(p.userId);
    if (!u?.email || onLeave.has(p.userId)) continue;
    const rec = recBy.get(p.userId);
    const sessions: any[] = rec?.sessions || [];
    const open = sessions.find((x) => !x.out);

    // morning: has not checked in at all today (and nobody marked the day by hand)
    if (inDue && !sessions.length && !rec?.manualStatus && (await claim(wid, p.userId, date, "checkin"))) {
      const mail = checkInReminderEmail({ name: u.name, workspaceName, shiftStart: s.workStart, url });
      sendMail(u.email, mail.subject, mail.html).catch(() => {});
      await bell(p.userId, "Time to check in", `Your workday starts at ${s.workStart}. Don't forget to check in.`);
    }

    // evening: still checked in
    if (outDue && open && (await claim(wid, p.userId, date, "checkout"))) {
      const mail = checkOutReminderEmail({ name: u.name, workspaceName, since: hmIn(+new Date(open.in), tz), url });
      sendMail(u.email, mail.subject, mail.html).catch(() => {});
      await bell(p.userId, "You are still checked in", "Please check out so your hours are counted correctly.");
    }
  }
}