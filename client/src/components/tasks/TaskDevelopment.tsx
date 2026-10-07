import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { GithubLink } from "@/types";
import { timeAgo } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";

const stateCls: Record<string, string> = {
  open: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  draft: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  merged: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  closed: "bg-red-500/15 text-red-700 dark:text-red-300",
  pushed: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

const ghHref = (u?: string) => (u && /^https:\/\/(www\.)?github\.com\//i.test(u) ? u : undefined);

export function TaskDevelopment({ taskId, taskNumber, title }: { taskId: string; taskNumber: number; title: string }) {
  const { data } = useQuery({
    queryKey: ["task-github", taskId],
    queryFn: async () => (await api.get(`/tasks/${taskId}/github`)).data.data as GithubLink[],
    refetchInterval: 20000,
  });

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const branch = `feature/TASK-${taskNumber}${slug ? `-${slug}` : ""}`;
  const copyBranch = () => navigator.clipboard.writeText(branch).then(() => toast.success("Branch name copied")).catch(() => toast.error("Could not copy"));

  const prs = (data || []).filter((l) => l.type === "pr");
  const commits = (data || []).filter((l) => l.type === "commit");

  return (
    <div className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Development</label>
        <button type="button" onClick={copyBranch} className="text-xs text-primary hover:underline">Copy branch name</button>
      </div>

      {!prs.length && !commits.length && (
        <p className="text-xs italic text-muted-foreground">
          Nothing linked yet. Name your branch <code className="rounded bg-secondary px-1 not-italic">{`TASK-${taskNumber}`}</code>… or mention it in a commit or PR title.
        </p>
      )}

      {!!prs.length && (
        <div className="space-y-1.5">
          {prs.map((l) => {
            const href = ghHref(l.url);
            return (
              <div key={l._id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <div className="min-w-0">
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">#{l.externalId} {l.title}</a> : <span className="font-medium">#{l.externalId} {l.title}</span>}
                  <p className="truncate text-[11px] text-muted-foreground">{l.repo} · {l.branch}{l.authorLogin ? ` · ${l.authorLogin}` : ""}{l.updatedAtExt ? ` · ${timeAgo(l.updatedAtExt)}` : ""}</p>
                </div>
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", stateCls[l.state || "open"])}>{l.state}</span>
              </div>
            );
          })}
        </div>
      )}

      {!!commits.length && (
        <div className="mt-2 space-y-1">
          {commits.slice(0, 8).map((l) => {
            const href = ghHref(l.url);
            return (
              <p key={l._id} className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{l.externalId.slice(0, 7)}</span>{" "}
                {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">{l.title}</a> : l.title}
                {l.authorLogin ? ` · ${l.authorLogin}` : ""}
              </p>
            );
          })}
          {commits.length > 8 && <p className="text-[11px] text-muted-foreground">+{commits.length - 8} more commits</p>}
        </div>
      )}
    </div>
  );
}