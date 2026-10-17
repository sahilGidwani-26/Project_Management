import { Task } from "../models/Task";
import { User } from "../models/User";
import { PokerEstimate } from "../models/Poker";

export const CARDS: { id: string; minutes: number | null; label: string }[] = [
  { id: "30", minutes: 30, label: "30m" },
  { id: "60", minutes: 60, label: "1h" },
  { id: "120", minutes: 120, label: "2h" },
  { id: "240", minutes: 240, label: "4h" },
  { id: "480", minutes: 480, label: "1d" }, // 1 working day = 8 hours
  { id: "960", minutes: 960, label: "2d" },
  { id: "1440", minutes: 1440, label: "3d" },
  { id: "2400", minutes: 2400, label: "1w" },
  { id: "?", minutes: null, label: "?" },
  { id: "coffee", minutes: null, label: "☕" },
];
const NUMERIC = CARDS.filter((c) => c.minutes !== null) as { id: string; minutes: number; label: string }[];

export const cardMinutes = (id: string) => CARDS.find((c) => c.id === id)?.minutes ?? null;
export const isCard = (id: unknown) => typeof id === "string" && CARDS.some((c) => c.id === id);

/** 90 -> "1h 30m", 480 -> "1d", 2400 -> "5d". */
export function human(m: number) {
  if (m >= 480 && m % 480 === 0) return `${m / 480}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Nearest card (a tie goes to the bigger one, estimates are safer when rounded up). */
export function snap(m: number) {
  let best = NUMERIC[0];
  for (const c of NUMERIC) {
    const d = Math.abs(c.minutes - m);
    const bd = Math.abs(best.minutes - m);
    if (d < bd || (d === bd && c.minutes > best.minutes)) best = c;
  }
  return best.minutes;
}

export function voteStats(votes: Record<string, string>) {
  const entries = Object.entries(votes || {});
  const nums = entries.map(([, v]) => cardMinutes(v)).filter((m): m is number => m != null).sort((a, b) => a - b);
  const unsure = entries.filter(([, v]) => v === "?").length;
  const coffee = entries.filter(([, v]) => v === "coffee").length;
  const base = { count: entries.length, numeric: nums.length, unsure, coffee };
  if (!nums.length) return { ...base, min: null, max: null, average: null, median: null, suggestedMinutes: null, agreed: false, bigSpread: false };

  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  const average = nums.reduce((a, b) => a + b, 0) / nums.length;
  return {
    ...base,
    min: nums[0],
    max: nums[nums.length - 1],
    average: Math.round(average),
    median: Math.round(median),
    suggestedMinutes: snap(median),
    agreed: nums[0] === nums[nums.length - 1] && unsure === 0,
    bigSpread: nums[nums.length - 1] / nums[0] >= 3,
  };
}

/**
 * The view ONE person gets. Everybody else's votes are left out until the votes are revealed
 * (a person only ever sees their own vote). This is the only place votes leave the server.
 */
export async function buildView(session: any, viewerId: string, projectRole: string) {
  const votes: Record<string, string> = session.votes || {};
  const participantIds: string[] = (session.participants || []).map(String);
  const userIds = [...new Set([String(session.facilitatorId), ...participantIds, ...Object.keys(votes)])];
  const cur = session.currentTaskId ? String(session.currentTaskId) : null;
  const taskIds = [...new Set([...(session.queue || []).map(String), ...(session.skipped || []).map(String), ...(cur ? [cur] : [])])];

  const [users, tasks, estimates]: [any[], any[], any[]] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select("name profileImage jobTitle").lean() as any,
    taskIds.length ? (Task.find({ _id: { $in: taskIds } }).select("title taskNumber type status estimatedMinutes actualMinutes description").lean() as any) : Promise.resolve([]),
    PokerEstimate.find({ sessionId: session._id }).sort({ at: 1 }).lean() as any,
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), { _id: String(u._id), name: u.name, profileImage: u.profileImage, jobTitle: u.jobTitle }]));
  const taskMap = new Map(tasks.map((t) => [String(t._id), t]));
  const est = new Map<string, any>();
  estimates.forEach((e) => est.set(String(e.taskId), e)); // newest wins
  const skipped = new Set((session.skipped || []).map(String));
  const revealed = session.phase === "revealed";
  const isFacilitator = String(session.facilitatorId) === viewerId;
  const isParticipant = participantIds.includes(viewerId);
  const active = session.status === "active";

  const participants = participantIds
    .map((id) => {
      const user = userMap.get(id);
      if (!user) return null;
      const has = Object.prototype.hasOwnProperty.call(votes, id);
      return { user, voted: has, vote: revealed || id === viewerId ? (has ? votes[id] : null) : undefined };
    })
    .filter(Boolean);

  const current = cur && taskMap.get(cur)
    ? (() => {
        const t = taskMap.get(cur);
        return {
          _id: cur, taskNumber: t.taskNumber, title: t.title, type: t.type || "Task", status: t.status,
          description: typeof t.description === "string" ? t.description.slice(0, 1500) : "",
          estimatedMinutes: t.estimatedMinutes ?? null, actualMinutes: t.actualMinutes ?? 0,
        };
      })()
    : null;

  const queue = (session.queue || [])
    .map(String)
    .map((id: string) => {
      const t = taskMap.get(id);
      if (!t) return null;
      const state = id === cur ? "current" : est.has(id) ? "estimated" : skipped.has(id) ? "skipped" : "pending";
      return { _id: id, taskNumber: t.taskNumber, title: t.title, type: t.type || "Task", status: t.status, state, estimatedMinutes: t.estimatedMinutes ?? null, pokerMinutes: est.get(id)?.minutes ?? null };
    })
    .filter(Boolean) as any[];

  const reveal = revealed
    ? {
        votes: Object.entries(votes)
          .map(([uid, value]) => ({ user: userMap.get(uid), value, label: CARDS.find((c) => c.id === value)?.label ?? value, minutes: cardMinutes(value) }))
          .filter((v) => v.user)
          .sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity)),
        stats: voteStats(votes),
      }
    : null;

  return {
    _id: String(session._id),
    name: session.name,
    status: session.status,
    phase: session.phase,
    round: session.round,
    facilitator: userMap.get(String(session.facilitatorId)) || null,
    isFacilitator,
    canControl: active && (isFacilitator || projectRole === "ADMIN"),
    canTakeOver: active && !isFacilitator && projectRole === "ADMIN",
    isParticipant,
    canVote: active && isParticipant && session.phase === "voting",
    myVote: votes[viewerId] ?? null,
    participants,
    current,
    reveal,
    queue,
    progress: {
      estimated: queue.filter((q) => q.state === "estimated").length,
      skipped: queue.filter((q) => q.state === "skipped").length,
      remaining: queue.filter((q) => q.state === "pending" || q.state === "current").length,
      totalMinutes: queue.reduce((a, q) => a + (q.pokerMinutes || 0), 0),
    },
    cards: CARDS,
    endedAt: session.endedAt || null,
  };
}