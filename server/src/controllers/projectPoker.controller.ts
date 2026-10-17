import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { PReq } from "../utils/projectAccess";
import { Task } from "../models/Task";
import { User } from "../models/User";
import { Notification } from "../models/Notification";
import { PokerEstimate, PokerSession } from "../models/Poker";
import { getName, logActivity, projectLeads, projectRecipients, sendToUsers, uniqueIds } from "../services/projectEvents";
import { buildView, CARDS, human, isCard, voteStats } from "../services/poker";
import { buildProjectUrl, pokerStartedEmail, pokerSummaryEmail } from "../utils/projectEmailTemplates";

const ID = /^[a-f\d]{24}$/i;
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter((i) => ID.test(i)) : []);
const url = (r: PReq) => buildProjectUrl(String(r.project.workspaceId), String(r.project._id), "poker");
const log = (r: PReq, action: string, title: string, extra: Record<string, unknown> = {}) =>
  logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: r.user!.id, action, entity: "poker", metadata: { title, ...extra } });

const ping = (req: Request, sessionId: unknown, kind: string) => req.app.get("io")?.to(`poker:${sessionId}`).emit("poker:changed", { sessionId: String(sessionId), kind });
const refreshBoard = (req: Request, r: PReq, taskId: unknown) => req.app.get("io")?.to(`project:${r.project._id}`).emit("task:updated", { taskId: String(taskId) });

async function load(req: Request, requireActive = true) {
  const r = req as PReq;
  if (!ID.test(req.params.sessionId)) throw ApiError.notFound("Session not found");
  const s: any = await PokerSession.findOne({ _id: req.params.sessionId, projectId: r.project._id }).lean();
  if (!s) throw ApiError.notFound("Session not found");
  if (requireActive && s.status !== "active") throw ApiError.badRequest("This session has ended");
  return s;
}
const canControl = (r: PReq, s: any) => String(s.facilitatorId) === r.user!.id || r.projectRole === "ADMIN";
const needControl = (r: PReq, s: any) => {
  if (!canControl(r, s)) throw ApiError.forbidden("Only the facilitator can do that");
};

/** Only tasks of this project (top-level, not subtasks), in the order the user picked them. */
async function validTasks(r: PReq, list: string[]) {
  const clean = [...new Set(list)].slice(0, 100);
  if (!clean.length) return [];
  const found = new Set((await Task.find({ _id: { $in: clean }, projectId: r.project._id, parentTaskId: { $exists: false } }).distinct("_id")).map(String));
  return clean.filter((i) => found.has(i));
}

/* ------------------------------ overview / state ------------------------------ */

export const pokerOverview = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const [active, ended]: [any, any[]] = await Promise.all([
    PokerSession.findOne({ projectId: r.project._id, status: "active" }).lean() as any,
    PokerSession.find({ projectId: r.project._id, status: "ended" }).sort({ endedAt: -1 }).limit(10).lean() as any,
  ]);

  const agg: any[] = ended.length
    ? await PokerEstimate.aggregate([
        { $match: { sessionId: { $in: ended.map((s) => s._id) } } },
        { $group: { _id: "$sessionId", tasks: { $sum: 1 }, minutes: { $sum: "$minutes" } } },
      ])
    : [];
  const stat = new Map(agg.map((a) => [String(a._id), a]));
  const people: any[] = await User.find({ _id: { $in: [...(active ? [active.facilitatorId] : []), ...ended.map((s) => s.facilitatorId)] } }).select("name").lean();
  const nameOf = new Map(people.map((u) => [String(u._id), u.name]));

  return sendSuccess(
    res, 200,
    {
      active: active
        ? { _id: active._id, name: active.name, phase: active.phase, facilitator: nameOf.get(String(active.facilitatorId)) || "Someone", participants: (active.participants || []).length, queued: (active.queue || []).length, joined: (active.participants || []).map(String).includes(r.user!.id) }
        : null,
      recent: ended.map((s) => ({ _id: s._id, name: s.name, endedAt: s.endedAt, facilitator: nameOf.get(String(s.facilitatorId)) || "Someone", tasks: stat.get(String(s._id))?.tasks || 0, minutes: stat.get(String(s._id))?.minutes || 0 })),
      cards: CARDS,
    },
    "poker"
  );
});

export const sessionState = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req, false);
  return sendSuccess(res, 200, await buildView(s, r.user!.id, r.projectRole), "poker session");
});

/* -------------------------------- create / join -------------------------------- */

export const createSession = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const uid = r.user!.id;

  // free up a session that nobody touched for 12+ hours (so a forgotten session never blocks the project)
  await PokerSession.updateMany(
    { projectId: r.project._id, status: "active", updatedAt: { $lt: new Date(Date.now() - 12 * 3600e3) } },
    { $set: { status: "ended", endedAt: new Date(), phase: "idle" } }
  );

  const name = String(req.body.name || "").trim().slice(0, 120) || `Estimation · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  const queue = await validTasks(r, ids(req.body.taskIds));

  let session: any;
  try {
    session = await PokerSession.create({
      projectId: r.project._id, workspaceId: r.project.workspaceId, name, facilitatorId: uid, createdBy: uid, participants: [uid], queue,
    });
  } catch (e: any) {
    if (e?.code === 11000) throw ApiError.badRequest("A planning poker session is already running in this project. Join it instead.");
    throw e;
  }

  await log(r, "poker_started", name, { tasks: queue.length });

  // invite the team: bell notification + email
  const byName = await getName(uid);
  const others = projectRecipients(r.project).filter((i) => i !== uid);
  const io = req.app.get("io");
  for (const id of others) {
    await Notification.create({
      userId: id, type: "poker_started", title: "Planning poker started",
      message: `${byName} started "${name}" in ${r.project.name}`, relatedWorkspaceId: r.project.workspaceId, relatedProjectId: r.project._id,
    }).catch(() => undefined);
    io?.to(`user:${id}`).emit("notification:new", { title: "Planning poker started" });
  }
  void sendToUsers(others, uid, () => pokerStartedEmail({ projectName: r.project.name, sessionName: name, byName, taskCount: queue.length, url: url(r) }));

  return sendSuccess(res, 201, { _id: String(session._id) }, "Session started");
});

export const joinSession = catchAsync(async (req: Request, res: Response) => {
  const s = await load(req);
  await PokerSession.updateOne({ _id: s._id, status: "active" }, { $addToSet: { participants: (req as PReq).user!.id } });
  ping(req, s._id, "join");
  return sendSuccess(res, 200, null, "Joined");
});

export const leaveSession = catchAsync(async (req: Request, res: Response) => {
  const uid = (req as PReq).user!.id;
  const s = await load(req);
  // their vote is removed with them, so "x of y voted" stays correct
  await PokerSession.updateOne({ _id: s._id, status: "active" }, { $pull: { participants: uid }, $unset: { [`votes.${uid}`]: "" } });
  ping(req, s._id, "leave");
  return sendSuccess(res, 200, null, "You left the session");
});

export const takeOver = catchAsync(async (req: Request, res: Response) => {
  const uid = (req as PReq).user!.id;
  const s = await load(req);
  await PokerSession.updateOne({ _id: s._id, status: "active" }, { $set: { facilitatorId: uid }, $addToSet: { participants: uid } });
  ping(req, s._id, "takeover");
  return sendSuccess(res, 200, null, "You are the facilitator now");
});

/* ----------------------------------- queue ----------------------------------- */

export const editQueue = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req);
  needControl(r, s);

  const add = await validTasks(r, ids(req.body.add));
  const cur = s.currentTaskId ? String(s.currentTaskId) : null;
  const remove = ids(req.body.remove).filter((i) => i !== cur); // the task being voted on cannot be removed

  if (add.length) await PokerSession.updateOne({ _id: s._id, status: "active" }, { $addToSet: { queue: { $each: add } } });
  if (remove.length) await PokerSession.updateOne({ _id: s._id, status: "active" }, { $pull: { queue: { $in: remove }, skipped: { $in: remove } } });
  ping(req, s._id, "queue");
  return sendSuccess(res, 200, null, "Queue updated");
});

/* -------------------------------- the voting loop -------------------------------- */

export const startTask = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req);
  needControl(r, s);
  const [taskId] = await validTasks(r, ids([req.body.taskId]));
  if (!taskId) throw ApiError.badRequest("Choose a task from this project");

  await PokerSession.updateOne(
    { _id: s._id, status: "active" },
    { $set: { currentTaskId: taskId, phase: "voting", round: 1, votes: {} }, $addToSet: { queue: taskId }, $pull: { skipped: taskId } }
  );
  ping(req, s._id, "start-task");
  return sendSuccess(res, 200, null, "Voting started");
});

export const vote = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const uid = r.user!.id;
  const value = req.body.value === null ? null : req.body.value;
  if (value !== null && !isCard(value)) throw ApiError.badRequest("Unknown card");

  const s = await load(req);
  if (!(s.participants || []).map(String).includes(uid)) throw ApiError.forbidden("Join the session to vote");

  const result = await PokerSession.updateOne(
    { _id: s._id, status: "active", phase: "voting", round: s.round }, // a late vote can never land in a revealed or restarted round
    value === null ? { $unset: { [`votes.${uid}`]: "" } } : { $set: { [`votes.${uid}`]: value } }
  );
  if (!result.matchedCount) throw ApiError.badRequest("Voting is not open right now");
  ping(req, s._id, "vote");
  return sendSuccess(res, 200, null, "Vote saved");
});

export const reveal = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req);
  needControl(r, s);
  if (!Object.keys(s.votes || {}).length) throw ApiError.badRequest("Nobody has voted yet");

  const result = await PokerSession.updateOne({ _id: s._id, status: "active", phase: "voting" }, { $set: { phase: "revealed" } });
  if (!result.matchedCount) throw ApiError.badRequest("There is nothing to reveal");
  ping(req, s._id, "reveal");
  return sendSuccess(res, 200, null, "Votes revealed");
});

export const revote = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req);
  needControl(r, s);
  const result = await PokerSession.updateOne(
    { _id: s._id, status: "active", phase: "revealed" },
    { $set: { phase: "voting", votes: {} }, $inc: { round: 1 } }
  );
  if (!result.matchedCount) throw ApiError.badRequest("Reveal the votes first");
  ping(req, s._id, "revote");
  return sendSuccess(res, 200, null, "New round started");
});

export const finalize = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req);
  needControl(r, s);
  if (s.phase !== "revealed" || !s.currentTaskId) throw ApiError.badRequest("Reveal the votes first");

  const stats = voteStats(s.votes || {});
  let minutes = req.body.minutes === undefined || req.body.minutes === null ? stats.suggestedMinutes : Number(req.body.minutes);
  if (minutes == null || !Number.isFinite(minutes)) throw ApiError.badRequest("Nobody picked a time card. Choose the estimate yourself or start a new round");
  minutes = Math.round(minutes);
  if (minutes < 1 || minutes > 14400) throw ApiError.badRequest("Estimate must be between 1 minute and 10 days");

  const task: any = await Task.findOne({ _id: s.currentTaskId, projectId: r.project._id }).select("estimatedMinutes title taskNumber");
  if (!task) throw ApiError.badRequest("This task no longer exists. Skip it.");

  // claim the step first, so a double click cannot save the same estimate twice
  const claimed = await PokerSession.updateOne(
    { _id: s._id, status: "active", phase: "revealed", currentTaskId: s.currentTaskId, round: s.round },
    { $set: { phase: "idle", votes: {} }, $unset: { currentTaskId: "" } }
  );
  if (!claimed.matchedCount) throw ApiError.badRequest("This estimate was already saved");

  await Task.updateOne({ _id: task._id }, { $set: { estimatedMinutes: minutes } });
  await PokerEstimate.create({
    projectId: r.project._id, workspaceId: r.project.workspaceId, sessionId: s._id, taskId: task._id, minutes,
    previousMinutes: task.estimatedMinutes ?? undefined, rounds: s.round, facilitatorId: s.facilitatorId,
    votes: Object.entries(s.votes || {}).map(([userId, value]) => ({ userId, value })),
  });
  await log(r, "poker_estimate", `TASK-${task.taskNumber} ${task.title}: ${human(minutes)}`, { minutes });
  refreshBoard(req, r, task._id);
  ping(req, s._id, "finalize");
  return sendSuccess(res, 200, { minutes }, `Estimate saved: ${human(minutes)}`);
});

export const skip = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req);
  needControl(r, s);
  if (!s.currentTaskId) throw ApiError.badRequest("No task is being voted on");
  await PokerSession.updateOne(
    { _id: s._id, status: "active", currentTaskId: s.currentTaskId },
    { $set: { phase: "idle", votes: {} }, $unset: { currentTaskId: "" }, $addToSet: { skipped: s.currentTaskId } }
  );
  ping(req, s._id, "skip");
  return sendSuccess(res, 200, null, "Task skipped");
});

/* ------------------------------------ end ------------------------------------ */

export const endSession = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const s = await load(req);
  needControl(r, s);

  const result = await PokerSession.updateOne(
    { _id: s._id, status: "active" },
    { $set: { status: "ended", endedAt: new Date(), phase: "idle", votes: {} }, $unset: { currentTaskId: "" } }
  );
  if (!result.matchedCount) throw ApiError.badRequest("This session has already ended");

  const rows: any[] = await PokerEstimate.find({ sessionId: s._id }).sort({ at: 1 }).lean();
  const latest = new Map<string, any>();
  rows.forEach((e) => latest.set(String(e.taskId), e));
  await log(r, "poker_ended", s.name, { estimated: latest.size });

  if (latest.size) {
    const tasks: any[] = await Task.find({ _id: { $in: [...latest.keys()] } }).select("title taskNumber").lean();
    const byId = new Map(tasks.map((t) => [String(t._id), t]));
    const lines = [...latest.values()]
      .map((e) => {
        const t = byId.get(String(e.taskId));
        if (!t) return null;
        return `TASK-${t.taskNumber} ${t.title}: ${human(e.minutes)}${e.previousMinutes && e.previousMinutes !== e.minutes ? ` (was ${human(e.previousMinutes)})` : ""}`;
      })
      .filter(Boolean) as string[];
    const total = [...latest.values()].reduce((a, e) => a + e.minutes, 0);
    const byName = await getName(r.user!.id);
    const to = uniqueIds([...(s.participants || []), ...projectLeads(r.project)]);
    void sendToUsers(to, r.user!.id, () => pokerSummaryEmail({ projectName: r.project.name, sessionName: s.name, byName, lines, totalLabel: human(total), url: url(r) }));
  }

  ping(req, s._id, "end");
  return sendSuccess(res, 200, null, "Session ended");
});

/* ---------------------------------- accuracy ---------------------------------- */

/** How close poker estimates were to the time really logged (team level only, never per person). */
export const accuracy = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const rows: any[] = await PokerEstimate.find({ projectId: r.project._id }).sort({ at: 1 }).lean();
  const latest = new Map<string, any>();
  rows.forEach((e) => latest.set(String(e.taskId), e));

  const tasks: any[] = latest.size
    ? await Task.find({ _id: { $in: [...latest.keys()] }, status: "Done", actualMinutes: { $gt: 0 } }).select("title taskNumber actualMinutes").lean()
    : [];

  const items = tasks.map((t) => {
    const e = latest.get(String(t._id));
    return { _id: String(t._id), taskNumber: t.taskNumber, title: t.title, estimated: e.minutes, actual: t.actualMinutes, ratio: Math.round((t.actualMinutes / e.minutes) * 100) / 100 };
  });
  items.sort((a, b) => b.taskNumber - a.taskNumber);

  const ratios = items.map((i) => i.ratio).sort((a, b) => a - b);
  const median = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2) : null;
  const pct = (n: number) => (items.length ? Math.round((100 * n) / items.length) : 0);

  return sendSuccess(
    res, 200,
    {
      estimatedTasks: latest.size,
      measured: items.length,
      medianRatio: median == null ? null : Math.round(median * 100) / 100,
      within25: pct(items.filter((i) => i.ratio >= 0.75 && i.ratio <= 1.25).length),
      tookLonger: pct(items.filter((i) => i.ratio > 1.25).length),
      tookLess: pct(items.filter((i) => i.ratio < 0.75).length),
      totalEstimated: items.reduce((a, i) => a + i.estimated, 0),
      totalActual: items.reduce((a, i) => a + i.actual, 0),
      items: items.slice(0, 50),
    },
    "accuracy"
  );
});