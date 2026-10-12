import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { PReq, WORKSPACE_MANAGERS } from "../utils/projectAccess";
import { Project } from "../models/Project";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { ForecastSnapshot } from "../models/ForecastSnapshot";
import { DAY, computeForecast, utcKey } from "../services/forecast";

const OPEN = ["Planning", "Active", "On Hold"];
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

/** GET /projects/:id/forecast?remove=8&speed=1.25 */
export const projectForecast = catchAsync(async (req: Request, res: Response) => {
  const project = (req as PReq).project;
  const remove = Math.round(num(req.query.remove, 0, 5000, 0));
  const speed = num(req.query.speed, 0.25, 4, 1);
  return sendSuccess(res, 200, await computeForecast(project, { remove, speed }), "forecast");
});

/** GET /projects/:id/forecast/history: daily snapshots for the "is the date moving?" chart. */
export const forecastHistory = catchAsync(async (req: Request, res: Response) => {
  const rows = await ForecastSnapshot.find({ projectId: (req as PReq).project._id })
    .sort({ day: -1 })
    .limit(60)
    .select("day state remaining p50 p85 deadline probability throughputPerWeek")
    .lean();
  return sendSuccess(res, 200, rows.reverse(), "forecast history");
});

const RISK_ORDER: Record<string, number> = { AT_RISK: 0, NEEDS_ATTENTION: 1, NO_DEADLINE: 2, NOT_ENOUGH_DATA: 3, PENDING: 3, ON_TRACK: 4, COMPLETE: 5 };

/** GET /analytics/workspace/:workspaceId/forecast: every open project, riskiest first. */
export const workspaceForecast = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const uid = req.user!.id;
  if (!/^[a-f\d]{24}$/i.test(workspaceId)) throw ApiError.badRequest("Invalid workspace id");

  const wm: any = await WorkspaceMember.findOne({ workspaceId, userId: uid, status: "active" }).select("role");
  if (!wm) throw ApiError.forbidden("You are not a member of this workspace");

  const filter: Record<string, unknown> = { workspaceId, status: { $in: OPEN } };
  if (!WORKSPACE_MANAGERS.includes(wm.role)) {
    filter.$or = [{ visibility: { $ne: "private" } }, { members: uid }, { managerId: uid }, { createdBy: uid }];
  }
  const projects = await Project.find(filter).select("name color icon status endDate createdAt workspaceId").limit(80);

  const today = utcKey(Date.now());
  const snaps: any[] = await ForecastSnapshot.find({ projectId: { $in: projects.map((p) => p._id) }, day: today }).lean();
  const byProject = new Map(snaps.map((s) => [String(s.projectId), s]));

  let live = 0; // keep the request fast: at most 20 fresh calculations, the nightly job fills the rest
  const rows: any[] = [];
  for (const p of projects) {
    const base = { project: { _id: p._id, name: p.name, color: p.color, icon: p.icon, status: p.status, endDate: p.endDate } };
    const snap = byProject.get(String(p._id));
    if (snap) {
      rows.push({ ...base, state: snap.state, remaining: snap.remaining, p50: snap.p50, p85: snap.p85, deadline: snap.deadline, probability: snap.probability ?? null, perWeek: snap.throughputPerWeek ?? 0, fresh: true });
    } else if (live < 20) {
      live++;
      const f = await computeForecast(p, {});
      rows.push({ ...base, state: f.state, remaining: f.openTasks, p50: f.dates.p50, p85: f.dates.p85, deadline: f.deadline, probability: f.probability, perWeek: f.throughput.perWeek, fresh: true });
    } else {
      rows.push({ ...base, state: "PENDING", remaining: null, p50: null, p85: null, deadline: p.endDate || null, probability: null, perWeek: 0, fresh: false });
    }
  }

  rows.sort((a, b) => (RISK_ORDER[a.state] ?? 9) - (RISK_ORDER[b.state] ?? 9) || (a.probability ?? 101) - (b.probability ?? 101));
  const count = (s: string) => rows.filter((r) => r.state === s).length;
  return sendSuccess(
    res, 200,
    { projects: rows, summary: { atRisk: count("AT_RISK"), needsAttention: count("NEEDS_ATTENTION"), onTrack: count("ON_TRACK"), complete: count("COMPLETE"), total: rows.length } },
    "workspace forecast"
  );
});