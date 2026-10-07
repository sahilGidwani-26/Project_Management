import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { GithubActivity, GithubIntegrationInfo, GithubLink } from "@/types";
import { useProject, useProjectResource } from "@/hooks/useProject";
import { attempt, timeAgo } from "@/lib/projectMeta";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const apiOrigin = () => {
  try { return new URL(import.meta.env.VITE_API_URL || "http://localhost:5000/api").origin; } catch { return "http://localhost:5000"; }
};

const copy = (text: string, what = "Copied") =>
  navigator.clipboard.writeText(text).then(() => toast.success(what)).catch(() => toast.error("Could not copy"));

/** Only real github.com links become clickable. */
const ghHref = (u?: string) => (u && /^https:\/\/(www\.)?github\.com\//i.test(u) ? u : undefined);

const stateCls: Record<string, string> = {
  open: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  draft: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  merged: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  closed: "bg-red-500/15 text-red-700 dark:text-red-300",
  pushed: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

const TARGETS: [string, string][] = [["none", "Do nothing"], ["In Progress", "Move to In Progress"], ["In Review", "Move to In Review"], ["Done", "Move to Done"]];

const taskRef = (l: GithubLink) => (typeof l.taskId === "object" ? l.taskId : null);

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={show ? value : "•".repeat(24)} className="font-mono text-xs" onFocus={(e) => show && e.currentTarget.select()} />
        {secret && <Button type="button" size="sm" variant="outline" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</Button>}
        <Button type="button" size="sm" variant="outline" onClick={() => copy(value, `${label} copied`)}>Copy</Button>
      </div>
    </div>
  );
}

export default function ProjectGithub() {
  const { projectId, isAdmin } = useProject();
  const qc = useQueryClient();

  // settings (admin only: the server hides the secret from everyone else)
  const { data: integration, isLoading } = useQuery({
    queryKey: ["github", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}/github`)).data.data as GithubIntegrationInfo | null,
    enabled: !!projectId && isAdmin,
    refetchInterval: isAdmin ? 10000 : false, // so "Verified" appears by itself after you add the webhook
  });
  const { data: activity, reload: reloadActivity } = useProjectResource<GithubActivity>("github-activity", projectId, "github/activity", 20000);

  const [repo, setRepo] = useState("");
  const [auto, setAuto] = useState({ onPrOpened: "In Review", onPrMerged: "Done", onBranchPush: "In Progress" });
  const [publicUrl, setPublicUrl] = useState(() => localStorage.getItem("fb_public_url") || apiOrigin());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!integration) return;
    setRepo(integration.repo);
    setAuto({
      onPrOpened: integration.automation.onPrOpened || "none",
      onPrMerged: integration.automation.onPrMerged || "none",
      onBranchPush: integration.automation.onBranchPush || "none",
    });
  }, [integration?._id, integration?.repo, integration?.automation.onPrOpened, integration?.automation.onPrMerged, integration?.automation.onBranchPush]);

  const reload = () => { qc.invalidateQueries({ queryKey: ["github", projectId] }); reloadActivity(); };
  const base = `/projects/${projectId}/github`;
  const toTarget = (v: string) => (v === "none" ? null : v);

  const save = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const done = await attempt(() => api.put(base, body), ok);
    setBusy(false);
    if (done) reload();
    return done;
  };

  const connect = () => save({ repo: repo.trim() }, "GitHub connected");
  const saveAutomation = () => save({ repo: integration!.repo, automation: { onPrOpened: toTarget(auto.onPrOpened), onPrMerged: toTarget(auto.onPrMerged), onBranchPush: toTarget(auto.onBranchPush) } }, "Automation saved");
  const changeRepo = () => {
    if (!window.confirm("Changing the repository removes all PR / commit links of the old one. Continue?")) return;
    save({ repo: repo.trim() }, "Repository changed. Update the webhook in GitHub too");
  };

  const webhookUrl = integration ? `${publicUrl.replace(/\/+$/, "")}${integration.webhookPath}` : "";
  const isLocal = /localhost|127\.0\.0\.1/i.test(publicUrl);
  const prs = activity?.prs || [];
  const commits = activity?.commits || [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-semibold">GitHub</h2>
        <p className="text-xs text-muted-foreground">
          Mention <code className="rounded bg-secondary px-1">TASK-42</code> in a branch name, commit message or pull request title. The task gets the PR and commits, and moves on its own.
        </p>
      </div>

      {/* ------------- setup (admins) ------------- */}
      {isAdmin && isLoading && <Skeleton className="h-40" />}

      {isAdmin && !isLoading && !integration && (
        <Card><CardContent className="space-y-3 p-5">
          <h3 className="font-medium">Connect a repository</h3>
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-sm" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="mycompany/website" onKeyDown={(e) => e.key === "Enter" && repo.trim() && connect()} />
            <Button disabled={busy || !repo.trim()} onClick={connect}>Connect</Button>
          </div>
          <p className="text-xs text-muted-foreground">Format: <b>owner/name</b>. A full GitHub link also works. No GitHub login or token is needed here, you add a webhook in the next step.</p>
        </CardContent></Card>
      )}

      {isAdmin && integration && (
        <>
          <Card><CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{integration.repo}</h3>
                {integration.verifiedAt ? <Badge>Connected & verified</Badge> : <Badge variant="outline" className="border-amber-500 text-amber-600">Waiting for GitHub</Badge>}
                {!integration.enabled && <Badge variant="secondary">Paused</Badge>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => save({ repo: integration.repo, enabled: !integration.enabled }, integration.enabled ? "Paused" : "Resumed")}>{integration.enabled ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm("Disconnect GitHub and delete all PR / commit links from this project?") && (await attempt(() => api.delete(base), "GitHub disconnected")) && reload()}>Disconnect</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {integration.eventsCount} event(s) received{integration.lastEventAt ? ` · last: ${integration.lastEventType} ${timeAgo(integration.lastEventAt)}` : ""}
            </p>

            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Repository</p>
                <Input className="w-72" value={repo} onChange={(e) => setRepo(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" disabled={busy || !repo.trim() || repo.trim().toLowerCase() === integration.repo} onClick={changeRepo}>Change repository</Button>
            </div>
          </CardContent></Card>

          <Card><CardContent className="space-y-4 p-5">
            <h3 className="font-medium">Add the webhook in GitHub (one time)</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Open your repository on GitHub, then <b>Settings → Webhooks → Add webhook</b>.</li>
              <li>Paste the <b>Payload URL</b> and <b>Secret</b> below.</li>
              <li>Set <b>Content type</b> to <b>application/json</b>.</li>
              <li>Choose <b>Let me select individual events</b> and tick <b>Pushes</b> and <b>Pull requests</b>.</li>
              <li>Keep <b>Active</b> ticked and click <b>Add webhook</b>. This page then shows “Connected & verified”.</li>
            </ol>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Public URL of your server</p>
              <Input value={publicUrl} onChange={(e) => { setPublicUrl(e.target.value); localStorage.setItem("fb_public_url", e.target.value); }} placeholder="https://api.yourapp.com" />
              {isLocal && (
                <p className="text-xs text-amber-600">
                  GitHub cannot reach <b>localhost</b>. While developing, run a tunnel (for example <code>ngrok http 5000</code>) and paste the https address it prints here. Not needed once the server is deployed.
                </p>
              )}
            </div>
            <CopyRow label="Payload URL" value={webhookUrl} />
            <CopyRow label="Secret" value={integration.secret} secret />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={async () => window.confirm("Generate a new secret? You must paste it into the GitHub webhook again, until then events are rejected.") && (await attempt(() => api.post(`${base}/regenerate-secret`), "New secret generated")) && reload()}>Regenerate secret</Button>
            </div>
          </CardContent></Card>

          <Card><CardContent className="space-y-4 p-5">
            <div>
              <h3 className="font-medium">Automation</h3>
              <p className="text-xs text-muted-foreground">Tasks only move forward (a Done task never goes back) and never past an unfinished dependency. Assignees get an email when a PR opens, merges or is closed.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {([["onPrOpened", "When a pull request is opened"], ["onPrMerged", "When a pull request is merged"], ["onBranchPush", "When code is pushed to a task branch"]] as const).map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <Select value={auto[k]} onValueChange={(v) => setAuto((a) => ({ ...a, [k]: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TARGETS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Also: a commit on the default branch saying <code className="rounded bg-secondary px-1">fixes TASK-42</code> counts as “merged”.</p>
            <Button size="sm" disabled={busy} onClick={saveAutomation}>Save automation</Button>
          </CardContent></Card>
        </>
      )}

      {/* ------------- activity (everyone) ------------- */}
      <section className="space-y-3">
        <h3 className="font-medium">Pull requests</h3>
        {!prs.length && <p className="text-sm text-muted-foreground">No pull requests linked yet. Put <b>TASK-&lt;number&gt;</b> in the PR title, description or branch name.</p>}
        {!!prs.length && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground"><tr>{["PR", "Task", "State", "Author", "Branch", "Updated"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {prs.map((l) => {
                  const t = taskRef(l);
                  const href = ghHref(l.url);
                  return (
                    <tr key={l._id}>
                      <td className="px-4 py-2.5">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">#{l.externalId} {l.title}</a> : <span>#{l.externalId} {l.title}</span>}</td>
                      <td className="px-4 py-2.5 text-xs">{t ? <><span className="font-mono text-muted-foreground">TASK-{t.taskNumber}</span> {t.title}</> : "—"}</td>
                      <td className="px-4 py-2.5"><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", stateCls[l.state || "open"])}>{l.state}</span></td>
                      <td className="px-4 py-2.5 text-xs">{l.authorLogin || "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{l.branch || "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.updatedAtExt ? timeAgo(l.updatedAtExt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Recent commits</h3>
        {!commits.length && <p className="text-sm text-muted-foreground">No commits linked yet.</p>}
        {!!commits.length && (
          <Card><CardContent className="divide-y divide-border p-0">
            {commits.map((l) => {
              const t = taskRef(l);
              const href = ghHref(l.url);
              return (
                <div key={l._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{l.title}</a> : l.title}
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{l.externalId.slice(0, 7)}</span> · {l.authorLogin || "unknown"} · {l.branch}{t ? ` · TASK-${t.taskNumber}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{l.updatedAtExt ? timeAgo(l.updatedAtExt) : ""}</span>
                </div>
              );
            })}
          </CardContent></Card>
        )}
      </section>
    </div>
  );
}