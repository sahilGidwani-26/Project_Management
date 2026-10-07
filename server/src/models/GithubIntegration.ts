import { Schema, model } from "mongoose";

const oid = (ref: string, extra: Record<string, unknown> = {}) => ({ type: Schema.Types.ObjectId, ref, ...extra });

/** One GitHub repo per project. `secret` is hidden unless explicitly selected (+secret). */
export const GithubIntegration = model<any>(
  "GithubIntegration",
  new Schema(
    {
      projectId: oid("Project", { required: true, unique: true }),
      workspaceId: oid("Workspace", { required: true }),
      repo: { type: String, required: true, trim: true, lowercase: true }, // "owner/name"
      secret: { type: String, required: true, select: false },
      enabled: { type: Boolean, default: true },
      // Target task status for each GitHub event. null = do nothing.
      automation: {
        onPrOpened: { type: String, default: "In Review" },
        onPrMerged: { type: String, default: "Done" },
        onBranchPush: { type: String, default: "In Progress" },
      },
      verifiedAt: Date, // set when GitHub's "ping" arrives
      lastEventAt: Date,
      lastEventType: String,
      eventsCount: { type: Number, default: 0 },
      createdBy: oid("User"),
    },
    { timestamps: true }
  )
);

const linkSchema = new Schema(
  {
    projectId: oid("Project", { required: true, index: true }),
    workspaceId: oid("Workspace", { required: true }),
    integrationId: oid("GithubIntegration", { required: true, index: true }),
    taskId: oid("Task", { required: true, index: true }),
    type: { type: String, enum: ["pr", "commit"], required: true },
    externalId: { type: String, required: true }, // PR number or commit sha
    repo: String,
    title: String,
    url: String,
    state: { type: String, enum: ["open", "draft", "merged", "closed", "pushed"] },
    authorLogin: String,
    authorAvatar: String,
    branch: String,
    baseBranch: String,
    createdAtExt: Date,
    updatedAtExt: Date,
    mergedAt: Date,
  },
  { timestamps: true }
);
linkSchema.index({ taskId: 1, type: 1, externalId: 1 }, { unique: true });
linkSchema.index({ projectId: 1, updatedAtExt: -1 });
export const GithubTaskLink = model<any>("GithubTaskLink", linkSchema);

/** Remembers recent delivery ids so a GitHub retry does not trigger emails/automation twice (auto-deleted after 7 days). */
export const GithubDelivery = model<any>(
  "GithubDelivery",
  new Schema({
    deliveryId: { type: String, required: true, unique: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 },
  })
);