import crypto from "crypto";
import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { PReq } from "../utils/projectAccess";
import { GithubIntegration, GithubTaskLink } from "../models/GithubIntegration";
import { getName, logActivity, projectLeads, sendToUsers } from "../services/projectEvents";
import { STATUS_ORDER } from "../services/githubSync";
import { buildProjectUrl, githubConnectionEmail } from "../utils/projectEmailTemplates";

const REPO_RE = /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/;
const AUTOMATION_KEYS = ["onPrOpened", "onPrMerged", "onBranchPush"] as const;

function normalizeRepo(input: unknown) {
  const repo = String(input || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!REPO_RE.test(repo)) throw ApiError.badRequest("Enter the repository as owner/name, for example mycompany/website");
  return repo;
}

const cleanTarget = (v: unknown) => (typeof v === "string" && STATUS_ORDER.includes(v) ? v : null);
const newSecret = () => crypto.randomBytes(24).toString("hex");

const view = (i: any) => ({
  _id: i._id,
  repo: i.repo,
  enabled: i.enabled,
  secret: i.secret, // only ever sent to project admins (routes use the admin guard)
  automation: {
    onPrOpened: i.automation?.onPrOpened ?? null,
    onPrMerged: i.automation?.onPrMerged ?? null,
    onBranchPush: i.automation?.onBranchPush ?? null,
  },
  verifiedAt: i.verifiedAt,
  lastEventAt: i.lastEventAt,
  lastEventType: i.lastEventType,
  eventsCount: i.eventsCount,
  webhookPath: `/api/integrations/github/webhook/${i._id}`,
});

const connectionMail = async (r: PReq, kind: "connected" | "disconnected", repo: string) => {
  const byName = await getName(r.user!.id);
  void sendToUsers(projectLeads(r.project), r.user!.id, () =>
    githubConnectionEmail({ kind, repo, projectName: r.project.name, byName, url: buildProjectUrl(String(r.project.workspaceId), String(r.project._id), "github") })
  );
};

export const getIntegration = catchAsync(async (req: Request, res: Response) => {
  const i: any = await GithubIntegration.findOne({ projectId: (req as PReq).project._id }).select("+secret");
  return sendSuccess(res, 200, i ? view(i) : null, "github");
});

export const saveIntegration = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const repo = normalizeRepo(req.body.repo);

  let i: any = await GithubIntegration.findOne({ projectId: r.project._id }).select("+secret");
  const created = !i;
  if (!i) i = new GithubIntegration({ projectId: r.project._id, workspaceId: r.project.workspaceId, secret: newSecret(), createdBy: req.user!.id });

  const repoChanged = !created && i.repo !== repo;
  i.repo = repo;
  if (typeof req.body.enabled === "boolean") i.enabled = req.body.enabled;
  if (req.body.automation && typeof req.body.automation === "object") {
    for (const k of AUTOMATION_KEYS) if (k in req.body.automation) i.automation[k] = cleanTarget(req.body.automation[k]);
  }
  if (repoChanged) {
    i.verifiedAt = undefined;
    await GithubTaskLink.deleteMany({ integrationId: i._id }); // links of the old repo no longer make sense
  }
  await i.save();

  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: created ? "github_connected" : "github_updated", entity: "github", metadata: { title: repo } });
  if (created) await connectionMail(r, "connected", repo);
  return sendSuccess(res, created ? 201 : 200, view(i), created ? "GitHub connected" : "GitHub settings saved");
});

export const regenerateSecret = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const i: any = await GithubIntegration.findOne({ projectId: r.project._id }).select("+secret");
  if (!i) throw ApiError.notFound("GitHub is not connected to this project");
  i.secret = newSecret();
  i.verifiedAt = undefined;
  await i.save();
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: "github_secret_regenerated", entity: "github", metadata: { title: i.repo } });
  return sendSuccess(res, 200, view(i), "New secret generated. Update it in the GitHub webhook settings");
});

export const removeIntegration = catchAsync(async (req: Request, res: Response) => {
  const r = req as PReq;
  const i: any = await GithubIntegration.findOne({ projectId: r.project._id });
  if (!i) return sendSuccess(res, 200, null, "Nothing to disconnect");
  await GithubTaskLink.deleteMany({ integrationId: i._id });
  await i.deleteOne();
  await logActivity({ workspaceId: r.project.workspaceId, projectId: r.project._id, actorId: req.user!.id, action: "github_disconnected", entity: "github", metadata: { title: i.repo } });
  await connectionMail(r, "disconnected", i.repo);
  return sendSuccess(res, 200, null, "GitHub disconnected. Remove the webhook in your GitHub repo settings too");
});

/** Recent pull requests and commits linked to this project's tasks (visible to every project member). */
export const listActivity = catchAsync(async (req: Request, res: Response) => {
  const projectId = (req as PReq).project._id;
  const [prs, commits] = await Promise.all([
    GithubTaskLink.find({ projectId, type: "pr" }).sort({ updatedAtExt: -1 }).limit(60).populate("taskId", "title taskNumber").lean(),
    GithubTaskLink.find({ projectId, type: "commit" }).sort({ updatedAtExt: -1 }).limit(40).populate("taskId", "title taskNumber").lean(),
  ]);
  return sendSuccess(res, 200, { prs, commits }, "github activity");
});

/** GET /tasks/:taskId/github, the "Development" section of a task. */
export const getTaskGithub = catchAsync(async (req: Request, res: Response) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.taskId)) throw ApiError.badRequest("Invalid task id");
  const links = await GithubTaskLink.find({ taskId: req.params.taskId }).sort({ updatedAtExt: -1 }).limit(40).lean();
  return sendSuccess(res, 200, links, "github");
});