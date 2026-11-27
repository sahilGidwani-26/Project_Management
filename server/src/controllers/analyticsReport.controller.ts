import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { ActivityLog } from "../models/ActivityLog";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { limit } from "../services/meeting";
import { dayKeyIn, safeTz } from "../services/attendanceCalc";
import { BUILD, ReportMeta, Scope, availableSections, buildScope } from "../services/analyticsReport";
import { buildPdf, buildXlsx } from "../services/analyticsExport";

async function metaOf(s: Scope): Promise<ReportMeta> {
  const ws: any = await Workspace.findById(s.workspaceId).select("name").lean();
  return {
    workspaceName: ws?.name || "Workspace", from: s.range.from, to: s.range.to, days: s.range.days, tz: s.tz,
    project: s.projectId ? s.projects[0]?.name || null : null, generatedAt: new Date().toISOString(), generatedBy: s.userName,
  };
}

/** Which sections this person may open, and what “today” is for them. */
export const reportMeta = catchAsync(async (req: Request, res: Response) => {
  const u: any = await User.findById(req.user!.id).select("timezone").lean();
  const tz = safeTz(u?.timezone);
  return sendSuccess(res, 200, { sections: availableSections(req.access!.perms), today: dayKeyIn(Date.now(), tz), tz }, "Report options");
});

/** GET .../reports/section?section=tasks&from=&to=&projectId= */
export const reportSection = catchAsync(async (req: Request, res: Response) => {
  const key = String(req.query.section || "overview");
  if (!availableSections(req.access!.perms).some((x) => x.key === key)) throw ApiError.forbidden("You do not have access to this report");
  const s = await buildScope(req);
  const section = await BUILD[key](s);
  return sendSuccess(res, 200, { meta: await metaOf(s), section }, "Report");
});

/** GET .../reports/export?format=pdf|xlsx&section=all|tasks&from=&to=&projectId= */
export const reportExport = catchAsync(async (req: Request, res: Response) => {
  const uid = req.user!.id;
  if (!limit(`report:${uid}`, 20, 10 * 60e3)) throw ApiError.conflict("You downloaded many reports just now. Wait a few minutes.");
  const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
  const want = String(req.query.section || "all");
  const avail = availableSections(req.access!.perms).map((x) => x.key);
  if (want !== "all" && !avail.includes(want)) throw ApiError.forbidden("You do not have access to this report");

  const s = await buildScope(req);
  const sections = [];
  for (const k of want === "all" ? avail : [want]) sections.push(await BUILD[k](s)); // one after another, to keep the load small
  const meta = await metaOf(s);
  const title = want === "all" ? "Analytics report" : `${sections[0].title} report`;
  const file = format === "pdf" ? await buildPdf(meta, sections, title) : await buildXlsx(meta, sections, title);

  await ActivityLog.create({ workspaceId: s.workspaceId, actorId: uid, action: "analytics_exported", resourceType: "Workspace", resourceId: s.workspaceId, metadata: { title: `${title} (${format.toUpperCase()}) ${s.range.from} to ${s.range.to}` } }).catch(() => undefined);

  res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="analytics-${want}-${s.range.from}_to_${s.range.to}.${format}"`);
  res.send(file);
});