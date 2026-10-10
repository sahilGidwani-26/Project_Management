import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { PReq } from "../utils/projectAccess";
import { Task } from "../models/Task";
import { Sprint } from "../models/ProjectExtras";
import {
  Unit, burndown, cumulativeFlow, cycleStats, ensureStatusHistory, loadEvents, loadTasks, sprintSummary, sprintTaskIds,
} from "../services/sprintMetrics";

const DAY = 864e5;
const unitOf = (req: Request): Unit => (req.query.unit === "hours" ? "hours" : "tasks");
const startOf = (s: any) => +new Date(s.startedAt || s.startDate || s.createdAt);
const brief = (s: any) => ({
  _id: s._id, name: s.name, goal: s.goal, status: s.status,
  startDate: s.startDate, endDate: s.endDate, startedAt: s.startedAt, completedAt: s.completedAt,
});
const coverage = (tasks: Map<string, any>) => ({
  tasks: tasks.size,
  withEstimate: [...tasks.values()].filter((t) => (t.estimatedMinutes || 0) > 0).length,
});
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);

/** GET /projects/:id/sprint-reports?unit=tasks|hours: summary of the last 12 sprints + velocity. */
export const sprintOverview = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const unit = unitOf(req);
  const all: any[] = await Sprint.find({ projectId: r.project._id, status: { $ne: "Planned" } }).lean();
  all.sort((a, b) => startOf(a) - startOf(b));
  const sprints = all.slice(-12);

  const tasks = await loadTasks([...new Set(sprints.flatMap(sprintTaskIds))]);
  const rows = sprints.map((s) => {
    const { scopeIds, lists, ...summary } = sprintSummary(s, tasks, unit);
    return { ...brief(s), ...summary };
  });

  const completed = rows.filter((s) => s.status === "Completed" && s.completed != null).map((s) => s.completed as number);
  const active = rows.find((s) => s.status === "Active");
  return sendSuccess(
    res, 200,
    {
      unit,
      sprints: rows,
      activeSprintId: active?._id || null,
      velocity: { average3: avg(completed.slice(-3)), averageAll: avg(completed), completedSprints: completed.length },
      estimates: coverage(tasks),
    },
    "sprint reports"
  );
});

/** GET /projects/:id/sprint-reports/sprints/:sprintId?unit=: one sprint in detail. */
export const sprintDetail = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const unit = unitOf(req);
  const s: any = await Sprint.findOne({ _id: req.params.sprintId, projectId: r.project._id }).lean();
  if (!s) throw ApiError.notFound("Sprint not found");
  if (s.status === "Planned") return sendSuccess(res, 200, { planned: true, sprint: brief(s), taskCount: (s.taskIds || []).length }, "sprint report");

  await ensureStatusHistory(r.project._id);
  const idsAll = sprintTaskIds(s);
  const [tasks, evMap] = await Promise.all([loadTasks(idsAll), loadEvents(r.project._id, idsAll)]);

  const { scopeIds, ...summary } = sprintSummary(s, tasks, unit, true);
  const now = Date.now();
  const from = startOf(s);
  const to = s.status === "Completed" && s.completedAt ? +new Date(s.completedAt) : now;

  return sendSuccess(
    res, 200,
    {
      planned: false,
      unit,
      sprint: brief(s),
      summary,
      burndown: burndown(s, tasks, evMap, unit, now),
      flow: cumulativeFlow(scopeIds, tasks, evMap, unit, from, to, now),
      cycle: cycleStats(scopeIds, tasks, evMap),
      estimates: coverage(tasks),
    },
    "sprint report"
  );
});

/** GET /projects/:id/sprint-reports/flow?days=14|30|60|90&unit=: whole-project cumulative flow + cycle time. */
export const flowReport = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const unit = unitOf(req);
  const requested = Number(req.query.days);
  const days = [14, 30, 60, 90].includes(requested) ? requested : 30;

  await ensureStatusHistory(r.project._id);
  const docs: any[] = await Task.find({ projectId: r.project._id, parentTaskId: { $exists: false } })
    .select("title taskNumber type status estimatedMinutes createdAt")
    .lean();
  const tasks = new Map<string, any>(docs.map((t) => [String(t._id), t]));
  const taskIds = [...tasks.keys()];
  const evMap = await loadEvents(r.project._id, taskIds);

  const now = Date.now();
  return sendSuccess(
    res, 200,
    {
      unit,
      days,
      flow: cumulativeFlow(taskIds, tasks, evMap, unit, now - days * DAY, now, now),
      cycle: cycleStats(taskIds, tasks, evMap, now - days * DAY),
      estimates: coverage(tasks),
    },
    "flow report"
  );
});