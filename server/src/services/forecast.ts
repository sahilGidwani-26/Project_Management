import { Task } from "../models/Task";
import { TaskStatusEvent } from "../models/TaskStatusEvent";
import { ForecastSnapshot } from "../models/ForecastSnapshot";
import { ensureStatusHistory } from "./sprintMetrics";

export const DAY = 864e5;
const MAX_DAYS = 365; // simulations stop after a year ("more than a year away")
const MIN_DONE = 5; // fewer finished tasks than this => not enough history
const MIN_DAYS = 7;
const WINDOW = 56; // look back 8 weeks
const SIMS = 3000;

export type ForecastState = "COMPLETE" | "ON_TRACK" | "NEEDS_ATTENTION" | "AT_RISK" | "NO_DEADLINE" | "NOT_ENOUGH_DATA";

export const utcDay = (ms: number) => Math.floor(ms / DAY) * DAY;
export const utcKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Seeded random numbers: the same data gives the same forecast on every refresh. */
function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
/** "done after d days" -> the calendar day that work finishes (day 1 = today). null = beyond a year. */
const dateFor = (todayStart: number, d: number) => (d > MAX_DAYS ? null : new Date(todayStart + (d - 1) * DAY).toISOString());

interface Data {
  total: number;
  remaining: number;
  daily: number[];
  days: number;
  doneInWindow: number;
  weekly: { weekStart: string; done: number }[];
  trend: "up" | "down" | "flat";
  enough: boolean;
  reason?: string;
  seed: number;
  todayStart: number;
}

async function loadData(project: any, now: number): Promise<Data> {
  await ensureStatusHistory(project._id);
  const tasks: any[] = await Task.find({ projectId: project._id, parentTaskId: { $exists: false } }).select("status").lean();
  const remaining = tasks.filter((t) => t.status !== "Done").length;
  const doneIds = tasks.filter((t) => t.status === "Done").map((t) => t._id);

  const todayStart = utcDay(now);
  const start = utcDay(Math.max(now - WINDOW * DAY, +new Date(project.createdAt)));
  const days = Math.max(Math.round((todayStart - start) / DAY), 0);
  const daily: number[] = new Array(days).fill(0);
  let doneInWindow = 0;

  // when did each currently-Done task LAST become Done
  if (doneIds.length && days) {
    const rows: any[] = await TaskStatusEvent.aggregate([
      { $match: { projectId: project._id, taskId: { $in: doneIds }, to: "Done" } },
      { $group: { _id: "$taskId", at: { $max: "$at" } } },
    ]);
    for (const r of rows) {
      const at = +new Date(r.at);
      if (at < start || at >= todayStart) continue; // today is a partial day, ignore it
      daily[Math.floor((at - start) / DAY)]++;
      doneInWindow++;
    }
  }

  const weekly: { weekStart: string; done: number }[] = [];
  for (let end = days; end - 7 >= 0 && weekly.length < 8; end -= 7) {
    weekly.unshift({ weekStart: utcKey(start + (end - 7) * DAY), done: daily.slice(end - 7, end).reduce((a, b) => a + b, 0) });
  }

  let trend: Data["trend"] = "flat";
  if (days >= 28) {
    const last = daily.slice(days - 14).reduce((a, b) => a + b, 0);
    const prev = daily.slice(days - 28, days - 14).reduce((a, b) => a + b, 0);
    if (prev > 0 && last / prev >= 1.25) trend = "up";
    else if (prev > 0 && last / prev <= 0.75) trend = "down";
    else if (prev === 0 && last > 0) trend = "up";
  }

  let reason: string | undefined;
  if (days < MIN_DAYS) reason = "This project is less than a week old. Forecasts start once there is a week of history.";
  else if (doneInWindow < MIN_DONE) reason = `Only ${doneInWindow} task(s) were finished recently. At least ${MIN_DONE} are needed for a reliable forecast.`;

  return {
    total: tasks.length, remaining, daily, days, doneInWindow, weekly, trend,
    enough: !reason, reason,
    seed: hash(`${project._id}:${utcKey(now)}:${doneInWindow}:${days}`),
    todayStart,
  };
}

/** Days needed to finish `remaining` tasks, sampled from real daily results (sorted ascending). */
function simulate(remaining: number, daily: number[], speed: number, seed: number) {
  const rand = rng(seed);
  const n = daily.length;
  const out = new Array<number>(SIMS);
  for (let s = 0; s < SIMS; s++) {
    let left = remaining;
    let d = 0;
    while (left > 0 && d < MAX_DAYS) {
      left -= daily[Math.floor(rand() * n)] * speed;
      d++;
    }
    out[s] = left > 0 ? MAX_DAYS + 1 : Math.max(d, 1);
  }
  return out.sort((a, b) => a - b);
}

/** How many tasks the team finishes in `horizon` days (sorted ascending). */
function capacity(daily: number[], horizon: number, speed: number, seed: number) {
  const rand = rng(seed);
  const n = daily.length;
  const out = new Array<number>(SIMS);
  for (let s = 0; s < SIMS; s++) {
    let t = 0;
    for (let i = 0; i < horizon; i++) t += daily[Math.floor(rand() * n)];
    out[s] = t * speed;
  }
  return out.sort((a, b) => a - b);
}

function analyze(data: Data, project: any, remove: number, speed: number) {
  const remaining = Math.max(data.remaining - remove, 0);
  const deadlineMs = project.endDate ? +new Date(project.endDate) : null;
  const deadline = deadlineMs != null ? new Date(deadlineMs).toISOString() : null;
  const empty = { remaining, deadline, dates: { p50: null, p70: null, p85: null, p95: null }, probability: null as number | null, daysLate85: null as number | null, fix: null as any, distribution: [] as any[] };

  if (data.remaining === 0) return { ...empty, state: "COMPLETE" as ForecastState, probability: 100 };
  if (!data.enough) return { ...empty, state: "NOT_ENOUGH_DATA" as ForecastState };

  const sims = simulate(remaining, data.daily, speed, data.seed);
  const d50 = pct(sims, 0.5), d70 = pct(sims, 0.7), d85 = pct(sims, 0.85), d95 = pct(sims, 0.95);
  const dates = {
    p50: dateFor(data.todayStart, d50), p70: dateFor(data.todayStart, d70),
    p85: dateFor(data.todayStart, d85), p95: dateFor(data.todayStart, d95),
  };

  // cumulative curve: "chance to be finished by this date"
  const dMin = sims[0];
  const dMax = Math.min(pct(sims, 0.99), dMin + 120, MAX_DAYS);
  const step = Math.max(Math.ceil((dMax - dMin) / 80), 1);
  const distribution: { date: string; p: number }[] = [];
  let idx = 0;
  for (let x = dMin; x <= dMax; x += step) {
    while (idx < sims.length && sims[idx] <= x) idx++;
    distribution.push({ date: dateFor(data.todayStart, x)!, p: Math.round((100 * idx) / sims.length) });
  }

  let probability: number | null = null;
  let state: ForecastState = "NO_DEADLINE";
  let fix: any = null;
  let daysLate85: number | null = null;

  if (deadlineMs != null) {
    const d0 = Math.floor((utcDay(deadlineMs) - data.todayStart) / DAY); // days from today to the deadline day (0 = today)
    if (remaining === 0) probability = 100;
    else if (d0 < 0) probability = 0;
    else {
      const totals = capacity(data.daily, Math.min(d0 + 1, MAX_DAYS), speed, data.seed + 1);
      probability = Math.round((100 * totals.filter((t) => t >= remaining).length) / totals.length);
      if (probability < 85) {
        const cap85 = totals[Math.floor(0.15 * totals.length)]; // work finished with 85% confidence
        fix = {
          capacity85: r1(cap85),
          removeNeeded: Math.max(Math.ceil(remaining - cap85), 0),
          speedNeededPct: cap85 > 0 ? Math.round((remaining / cap85 - 1) * 100) : null,
        };
      }
    }
    if (d85 <= MAX_DAYS && remaining > 0) daysLate85 = Math.max(d85 - 1 - Math.floor((utcDay(deadlineMs) - data.todayStart) / DAY), 0);
    state = probability >= 85 ? "ON_TRACK" : probability >= 50 ? "NEEDS_ATTENTION" : "AT_RISK";
  }

  return { remaining, deadline, state, dates, probability, daysLate85, fix, distribution };
}

/** Full forecast for a project. `remove` / `speed` are the what-if sliders. */
export async function computeForecast(project: any, opts: { remove?: number; speed?: number } = {}, now = Date.now()) {
  const data = await loadData(project, now);
  const base = analyze(data, project, 0, 1);
  const wantsWhatIf = !!opts.remove || (!!opts.speed && opts.speed !== 1);
  const whatIf = wantsWhatIf ? { remove: opts.remove || 0, speed: opts.speed || 1, ...analyze(data, project, opts.remove || 0, opts.speed || 1) } : null;

  return {
    ...base,
    openTasks: data.remaining,
    totalTasks: data.total,
    reason: data.reason || null,
    throughput: {
      perWeek: data.days ? r1((data.doneInWindow / data.days) * 7) : 0,
      windowDays: data.days,
      doneInWindow: data.doneInWindow,
      weekly: data.weekly,
      trend: data.trend,
    },
    whatIf,
    generatedAt: new Date(now).toISOString(),
  };
}

/** Stores today's numbers (idempotent). Returns false if a snapshot for today already exists. */
export async function saveSnapshot(project: any, f: any, alerted = false, now = Date.now()) {
  try {
    await ForecastSnapshot.create({
      projectId: project._id,
      workspaceId: project.workspaceId,
      day: utcKey(now),
      state: f.state,
      remaining: f.openTasks,
      throughputPerWeek: f.throughput?.perWeek,
      p50: f.dates?.p50 || undefined,
      p85: f.dates?.p85 || undefined,
      deadline: f.deadline || undefined,
      probability: f.probability ?? undefined,
      alerted,
    });
    return true;
  } catch (e: any) {
    if (e?.code === 11000) return false;
    throw e;
  }
}