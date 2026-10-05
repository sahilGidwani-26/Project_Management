import { Task } from "../models/Task";

const GROUPS = [
  { key: "features", type: "Feature", title: "✨ New features" },
  { key: "bugfixes", type: "Bug", title: "🐛 Bug fixes" },
  { key: "improvements", type: "Improvement", title: "⚡ Improvements" },
  { key: "other", type: "Task", title: "🔧 Other changes" },
] as const;

type Item = { id: string; number: number; title: string };

/** Completed tasks of a release -> grouped changelog + Markdown + a short plain-text summary for emails. */
export function buildChangelog(release: any, tasks: any[]) {
  const groups: Record<string, Item[]> = { features: [], bugfixes: [], improvements: [], other: [] };
  for (const t of tasks) {
    const g = GROUPS.find((x) => x.type === t.type) || GROUPS[3];
    groups[g.key].push({ id: String(t._id), number: t.taskNumber, title: t.title });
  }

  const date = release.releasedAt || release.plannedDate;
  const lines = [`## ${release.name} — ${date ? new Date(date).toISOString().slice(0, 10) : "Unreleased"}`];
  if (release.description) lines.push("", release.description);
  for (const g of GROUPS) {
    if (!groups[g.key].length) continue;
    lines.push("", `### ${g.title}`, ...groups[g.key].map((i) => `- ${i.title} (TASK-${i.number})`));
  }
  if (!tasks.length) lines.push("", "_No completed changes yet._");

  const counts = {
    features: groups.features.length,
    bugfixes: groups.bugfixes.length,
    improvements: groups.improvements.length,
    other: groups.other.length,
    total: tasks.length,
  };
  const summary = GROUPS.flatMap((g) => groups[g.key].map((i) => `• ${g.title.replace(/^\S+\s/, "")}: ${i.title}`))
    .slice(0, 15)
    .join("\n");

  return { markdown: lines.join("\n"), groups, counts, summary };
}

/** Bugs shipped in a release get "Fixed in" = release name (only if it is still empty). */
export async function stampFixVersion(release: any, taskIds?: string[]) {
  const filter: Record<string, unknown> = {
    releaseId: release._id,
    type: "Bug",
    $or: [{ "bugDetails.fixedInVersion": { $exists: false } }, { "bugDetails.fixedInVersion": null }, { "bugDetails.fixedInVersion": "" }],
  };
  if (taskIds) filter._id = { $in: taskIds };
  await Task.updateMany(filter, { $set: { "bugDetails.fixedInVersion": release.name } } as any);
}