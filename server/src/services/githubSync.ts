import { Task } from "../models/Task";
import { Project } from "../models/Project";
import { GithubIntegration, GithubTaskLink } from "../models/GithubIntegration";
import { getBlockers, runAutomations } from "./automation";
import { logActivity, sendToUsers, uniqueIds } from "./projectEvents";
import { githubPrEmail } from "../utils/projectEmailTemplates";
import { buildTaskUrl } from "../utils/emailTemplates";

export const STATUS_ORDER = ["Backlog", "Todo", "In Progress", "In Review", "Done"];

const TASK_RE = /\bTASK-(\d{1,9})\b/gi;
// "fixes TASK-1", "closes: TASK-2, TASK-3", "resolved TASK-4 and TASK-5"
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+((?:TASK-\d{1,9}(?:\s*(?:,|and|&)\s*)?)+)/gi;

const execAll = (re: RegExp, text: string) => {
  const r = new RegExp(re.source, re.flags);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) {
    out.push(m);
    if (m[0] === "") r.lastIndex++;
  }
  return out;
};

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
/** Only real github.com links are stored, so a crafted payload can never put e.g. a javascript: URL into an href. */
const safeUrl = (u: unknown) => (typeof u === "string" && /^https:\/\/(www\.)?github\.com\//i.test(u) ? u.slice(0, 500) : "");

export function taskNumbers(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>();
  for (const t of texts) if (t) execAll(TASK_RE, t).forEach((m) => found.add(Number(m[1])));
  return [...found];
}

export function closingNumbers(...texts: (string | null | undefined)[]): number[] {
  const found = new Set<number>();
  for (const t of texts) {
    if (!t) continue;
    execAll(CLOSE_RE, t).forEach((m) => execAll(TASK_RE, m[1]).forEach((n) => found.add(Number(n[1]))));
  }
  return [...found];
}

const findTasks = (integration: any, numbers: number[]) =>
  numbers.length ? Task.find({ projectId: integration.projectId, taskNumber: { $in: numbers.slice(0, 50) } }) : Promise.resolve([] as any[]);

/** Moves a task FORWARD only (never backwards) and never past an unfinished dependency. */
async function advance(integration: any, task: any, target: string | null | undefined, io: any, reason: string): Promise<boolean> {
  if (!target || !STATUS_ORDER.includes(target)) return false;
  if (STATUS_ORDER.indexOf(target) <= STATUS_ORDER.indexOf(task.status)) return false;

  const blockers = await getBlockers(String(task._id), target);
  if (blockers.length) {
    await logActivity({
      workspaceId: task.workspaceId, projectId: task.projectId, actorId: integration.createdBy, action: "github_move_blocked", entity: "github",
      metadata: { title: `TASK-${task.taskNumber} stayed in ${task.status} (blocked by ${blockers.join(", ")})` },
    });
    return false;
  }

  const last: any = await Task.findOne({ projectId: task.projectId, status: target }).sort({ order: -1 }).select("order").lean();
  const updated = await Task.findByIdAndUpdate(task._id, { status: target, order: (last?.order ?? 0) + 1 }, { new: true });
  if (!updated) return false;

  io?.to(`project:${task.projectId}`).emit("task:moved", { taskId: updated._id, status: updated.status, order: updated.order });
  await logActivity({
    workspaceId: task.workspaceId, projectId: task.projectId, actorId: integration.createdBy, action: "github_task_moved", entity: "github",
    metadata: { title: `TASK-${task.taskNumber} → ${target}`, reason },
  });
  void runAutomations("task_status_changed", updated, undefined);
  task.status = target;
  return true;
}

function emailPr(project: any, task: any, kind: "opened" | "merged" | "closed", pr: any, repo: string, movedTo?: string) {
  const recipients = uniqueIds([...(task.assigneeIds || []), task.reporterId]);
  void sendToUsers(recipients, undefined, () =>
    githubPrEmail({
      kind, repo, prNumber: pr.number, prTitle: clip(pr.title, 150), prUrl: safeUrl(pr.html_url), author: clip(pr.user?.login, 60) || undefined,
      taskNumber: task.taskNumber, taskTitle: task.title, movedTo,
      url: buildTaskUrl(String(project.workspaceId), String(project._id), String(task._id)),
    })
  );
}

/* ------------------------------ pull_request ------------------------------ */

async function onPullRequest(integration: any, payload: any, io: any) {
  const pr = payload.pull_request;
  const action = String(payload.action || "");
  if (!pr) return;

  const nums = taskNumbers(pr.title, pr.body, pr.head?.ref);
  const tasks = await findTasks(integration, nums);
  if (!tasks.length) return;

  const state = pr.merged ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open";
  await GithubTaskLink.bulkWrite(
    tasks.map((t: any) => ({
      updateOne: {
        filter: { taskId: t._id, type: "pr", externalId: String(pr.number) },
        update: {
          $set: {
            projectId: integration.projectId, workspaceId: integration.workspaceId, integrationId: integration._id, repo: integration.repo,
            title: clip(pr.title, 200), url: safeUrl(pr.html_url), state,
            authorLogin: clip(pr.user?.login, 60), authorAvatar: safeUrl(pr.user?.avatar_url) || clip(pr.user?.avatar_url, 300),
            branch: clip(pr.head?.ref, 200), baseBranch: clip(pr.base?.ref, 200),
            updatedAtExt: pr.updated_at ? new Date(pr.updated_at) : new Date(), mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
          },
          $setOnInsert: { createdAtExt: pr.created_at ? new Date(pr.created_at) : new Date() },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  let notify: "opened" | "merged" | "closed" | null = null;
  let target: string | null = null;
  const a = integration.automation || {};
  if (action === "closed") {
    notify = pr.merged ? "merged" : "closed";
    target = pr.merged ? a.onPrMerged : null;
  } else if (["opened", "reopened", "ready_for_review"].includes(action) && !pr.draft) {
    notify = action === "reopened" ? null : "opened";
    target = a.onPrOpened;
  }
  if (!notify && !target) return;

  const project = await Project.findById(integration.projectId).select("name workspaceId");
  for (const task of tasks.slice(0, 5)) {
    const moved = await advance(integration, task, target, io, `PR #${pr.number} ${action}`);
    if (notify && project) emailPr(project, task, notify, pr, integration.repo, moved ? (target as string) : undefined);
  }
}

/* ---------------------------------- push ---------------------------------- */

async function onPush(integration: any, payload: any, io: any) {
  const ref = String(payload.ref || "");
  if (!ref.startsWith("refs/heads/") || payload.deleted) return;
  const branch = ref.slice("refs/heads/".length);
  const commits: any[] = (payload.commits || []).slice(0, 50);
  if (!commits.length) return;

  const isDefault = branch === payload.repository?.default_branch;
  const branchNums = taskNumbers(branch);
  const all = new Set<number>(branchNums);
  commits.forEach((c) => taskNumbers(c.message).forEach((n) => all.add(n)));

  const tasks = await findTasks(integration, [...all]);
  if (!tasks.length) return;
  const byNumber = new Map<number, any>(tasks.map((t: any) => [t.taskNumber, t]));

  const ops: any[] = [];
  for (const c of commits) {
    const nums = new Set<number>([...branchNums, ...taskNumbers(c.message)]);
    for (const n of nums) {
      const t = byNumber.get(n);
      if (!t || !c.id) continue;
      ops.push({
        updateOne: {
          filter: { taskId: t._id, type: "commit", externalId: String(c.id) },
          update: {
            $set: {
              projectId: integration.projectId, workspaceId: integration.workspaceId, integrationId: integration._id, repo: integration.repo,
              title: clip(String(c.message || "").split("\n")[0], 200), url: safeUrl(c.url), state: "pushed",
              authorLogin: clip(c.author?.username || c.author?.name, 60), branch: clip(branch, 200),
              updatedAtExt: c.timestamp ? new Date(c.timestamp) : new Date(),
            },
            $setOnInsert: { createdAtExt: c.timestamp ? new Date(c.timestamp) : new Date() },
          },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await GithubTaskLink.bulkWrite(ops, { ordered: false });

  const a = integration.automation || {};
  if (isDefault) {
    const closing = new Set<number>(closingNumbers(...commits.map((c) => c.message)));
    for (const t of tasks) if (closing.has(t.taskNumber)) await advance(integration, t, a.onPrMerged, io, `commit on ${branch} closes it`);
  } else {
    for (const t of tasks) await advance(integration, t, a.onBranchPush, io, `push to ${branch}`);
  }
}

/* ------------------------------ entry point ------------------------------ */

export async function processEvent(integration: any, event: string, payload: any, io: any) {
  if (event === "ping") {
    await GithubIntegration.updateOne({ _id: integration._id }, { $set: { verifiedAt: new Date() } });
  } else if (event === "pull_request") {
    await onPullRequest(integration, payload, io);
  } else if (event === "push") {
    await onPush(integration, payload, io);
  }
  await GithubIntegration.updateOne(
    { _id: integration._id },
    { $set: { lastEventAt: new Date(), lastEventType: event }, $inc: { eventsCount: 1 } }
  );
}