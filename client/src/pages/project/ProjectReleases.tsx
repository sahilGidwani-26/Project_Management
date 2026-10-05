import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { Release } from "@/types";
import { useProject, useProjectResource, useProjectTasks } from "@/hooks/useProject";
import { attempt, toInput, toISO } from "@/lib/projectMeta";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatDate, isOverdue } from "@/lib/utils";

const typeIcon: Record<string, string> = { Bug: "🐛", Feature: "✨", Improvement: "⚡", Task: "🔧" };

const copyText = (text: string) =>
  navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard")).catch(() => toast.error("Could not copy"));

const downloadText = (name: string, text: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
};

export default function ProjectReleases() {
  const { projectId, project, canEdit, isAdmin } = useProject();
  const qc = useQueryClient();
  const { data: releases, isLoading, reload } = useProjectResource<Release[]>("releases", projectId);
  const { data: tasks } = useProjectTasks(projectId);

  const [form, setForm] = useState<Partial<Release> | null>(null);
  const [linking, setLinking] = useState<Release | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState<Release | null>(null);
  const [moveTo, setMoveTo] = useState("unlink");
  const [changelog, setChangelog] = useState<{ title: string; markdown: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const base = `/projects/${projectId}/releases`;
  const list = releases || [];
  const nameOf = new Map(list.map((r) => [r._id, r.name]));
  const sync = () => { reload(); qc.invalidateQueries({ queryKey: ["tasks", projectId] }); };

  const save = async () => {
    setBusy(true);
    const body = { name: form!.name?.trim(), description: form!.description, plannedDate: toISO(toInput(form!.plannedDate)) };
    const ok = await attempt(() => (form!._id ? api.patch(`${base}/${form!._id}`, body) : api.post(base, body)), "Release saved");
    setBusy(false);
    if (ok) { setForm(null); sync(); }
  };

  const openLinking = (r: Release) => { setLinking(r); setPicked(new Set(r.tasks.map((t) => t._id))); };
  const saveLinks = async () => {
    if (!linking) return;
    const initial = new Set(linking.tasks.map((t) => t._id));
    const add = [...picked].filter((id) => !initial.has(id));
    const remove = [...initial].filter((id) => !picked.has(id));
    if (!add.length && !remove.length) return setLinking(null);
    setBusy(true);
    const ok = await attempt(() => api.put(`${base}/${linking._id}/tasks`, { add, remove }), "Release updated");
    setBusy(false);
    if (ok) { setLinking(null); sync(); }
  };

  const addDone = async (r: Release) => {
    try {
      const res = await api.post(`${base}/${r._id}/add-done`);
      toast.success(res.data.message);
      sync();
    } catch (e) { toast.error(apiError(e)); }
  };

  const publish = async () => {
    if (!publishing) return;
    setBusy(true);
    try {
      const res = await api.post(`${base}/${publishing._id}/publish`, { moveOpenTo: moveTo });
      toast.success("Release published");
      setChangelog({ title: publishing.name, markdown: res.data.data.changelog.markdown });
      setPublishing(null);
      sync();
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  const showChangelog = async (r: Release) => {
    try {
      const res = await api.get(`${base}/${r._id}/changelog`);
      setChangelog({ title: r.name, markdown: res.data.data.markdown });
    } catch (e) { toast.error(apiError(e)); }
  };

  const exportAll = async () => {
    const released = list.filter((r) => r.status === "Released").sort((a, b) => +new Date(b.releasedAt || 0) - +new Date(a.releasedAt || 0));
    if (!released.length) return toast.error("No published releases yet");
    try {
      const parts = await Promise.all(released.map(async (r) => (await api.get(`${base}/${r._id}/changelog`)).data.data.markdown as string));
      setChangelog({ title: "Full changelog", markdown: `# Changelog — ${project?.name || ""}\n\n${parts.join("\n\n")}` });
    } catch (e) { toast.error(apiError(e)); }
  };

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const plannedOthers = publishing ? list.filter((r) => r.status === "Planned" && r._id !== publishing._id) : [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Releases</h2>
          <p className="text-xs text-muted-foreground">Group finished work into versions. Publishing builds the changelog and emails the team.</p>
        </div>
        <div className="flex gap-2">
          {list.some((r) => r.status === "Released") && <Button size="sm" variant="outline" onClick={exportAll}>Export all</Button>}
          {canEdit && <Button size="sm" onClick={() => setForm({})}>New release</Button>}
        </div>
      </div>

      {isLoading && <Skeleton className="h-40" />}
      {!isLoading && !list.length && <p className="text-sm text-muted-foreground">No releases yet. Create one (for example v1.0.0), then attach tasks to it.</p>}

      {list.map((r) => {
        const released = r.status === "Released";
        const late = !released && r.plannedDate && isOverdue(r.plannedDate);
        return (
          <Card key={r._id}><CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">{r.name}</h3>
                  <Badge variant={released ? "default" : "secondary"}>{r.status}</Badge>
                  {late && <Badge variant="outline" className="border-destructive text-destructive">Overdue</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {released ? `Released ${formatDate(r.releasedAt!)}` : r.plannedDate ? `Planned for ${formatDate(r.plannedDate)}` : "No planned date"}
                </p>
                {r.description && <p className="mt-1 text-sm">{r.description}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                {released && <Button size="sm" variant="outline" onClick={() => showChangelog(r)}>Changelog</Button>}
                {!released && canEdit && <Button size="sm" variant="outline" onClick={() => openLinking(r)}>Tasks</Button>}
                {!released && canEdit && <Button size="sm" variant="outline" onClick={() => addDone(r)}>Add finished tasks</Button>}
                {!released && r.stats.total > 0 && <Button size="sm" variant="outline" onClick={() => showChangelog(r)}>Preview</Button>}
                {!released && isAdmin && <Button size="sm" onClick={() => { setPublishing(r); setMoveTo("unlink"); }}>Publish</Button>}
                {released && isAdmin && <Button size="sm" variant="ghost" onClick={async () => window.confirm(`Reopen ${r.name}? It becomes Planned again.`) && (await attempt(() => api.post(`${base}/${r._id}/reopen`), "Release reopened")) && sync()}>Reopen</Button>}
                {canEdit && !released && <Button size="sm" variant="ghost" onClick={() => setForm(r)}>Edit</Button>}
                {isAdmin && <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm(`Delete ${r.name}? Its tasks stay in the project.`) && (await attempt(() => api.delete(`${base}/${r._id}`), "Release deleted")) && sync()}>Delete</Button>}
              </div>
            </div>

            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${r.stats.progress}%` }} /></div>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.stats.done}/{r.stats.total} done · ✨ {r.stats.features} features · 🐛 {r.stats.bugs} bug fixes · ⚡ {r.stats.improvements} improvements
              </p>
            </div>

            {r.tasks.length > 0 && (
              <div>
                <button className="text-xs text-primary hover:underline" onClick={() => toggle(r._id)}>{expanded.has(r._id) ? "Hide tasks" : `Show ${r.tasks.length} task(s)`}</button>
                {expanded.has(r._id) && (
                  <div className="mt-2 divide-y divide-border rounded-md border border-border">
                    {r.tasks.map((t) => (
                      <div key={t._id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className={cn("min-w-0 truncate", t.status === "Done" && "text-muted-foreground")}>
                          <span className="mr-1.5">{typeIcon[t.type] || "🔧"}</span>
                          <span className="mr-2 font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>{t.title}
                        </span>
                        <StatusBadge status={t.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent></Card>
        );
      })}

      {/* create / edit */}
      <FormDialog open={!!form} onOpenChange={(v) => !v && setForm(null)} title={form?._id ? "Edit release" : "New release"} onSubmit={save} busy={busy} disabled={!form?.name?.trim()}>
        <Field label="Version / name"><Input value={form?.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="v1.0.0" autoFocus /></Field>
        <Field label="Planned date"><Input type="date" value={toInput(form?.plannedDate)} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} /></Field>
        <Field label="Notes (shown at the top of the changelog)"><Textarea value={form?.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      </FormDialog>

      {/* attach / detach tasks */}
      <FormDialog open={!!linking} onOpenChange={(v) => !v && setLinking(null)} title={`Tasks in ${linking?.name}`} onSubmit={saveLinks} busy={busy}>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {!tasks?.length && <p className="text-sm text-muted-foreground">No tasks in this project yet.</p>}
          {tasks?.filter((t) => !t.parentTaskId).map((t) => {
            const other = t.releaseId && t.releaseId !== linking?._id ? nameOf.get(t.releaseId) : undefined;
            return (
              <label key={t._id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/50">
                <input type="checkbox" checked={picked.has(t._id)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(t._id) ? n.delete(t._id) : n.add(t._id); return n; })} />
                <span>{typeIcon[t.type || "Task"]}</span>
                <span className="font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <StatusBadge status={t.status} />
                {other && <span className="text-[10px] text-muted-foreground">in {other}</span>}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Only finished (Done) tasks appear in the changelog. A task can belong to one release, ticking it here moves it.</p>
      </FormDialog>

      {/* publish */}
      <FormDialog open={!!publishing} onOpenChange={(v) => !v && setPublishing(null)} title={`Publish ${publishing?.name}`} onSubmit={publish} busy={busy} submitLabel="Publish release">
        {publishing && (
          <>
            <p className="text-sm">
              <b>{publishing.stats.done}</b> finished task(s) go into the changelog. Project members get an email, and bugs without a “Fixed in” version get <b>{publishing.name}</b> filled in.
            </p>
            {publishing.stats.open > 0 && (
              <Field label={`${publishing.stats.open} task(s) are not finished yet`}>
                <Select value={moveTo} onValueChange={setMoveTo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlink">Remove them from this release</SelectItem>
                    {plannedOthers.map((r) => <SelectItem key={r._id} value={r._id}>Move to {r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {publishing.stats.done === 0 && <p className="text-xs text-destructive">No finished tasks yet, the changelog will be empty.</p>}
          </>
        )}
      </FormDialog>

      {/* changelog */}
      <Dialog open={!!changelog} onOpenChange={(v) => !v && setChangelog(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Changelog: {changelog?.title}</DialogTitle></DialogHeader>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-secondary/50 p-4 text-sm">{changelog?.markdown}</pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangelog(null)}>Close</Button>
            <Button variant="outline" onClick={() => changelog && copyText(changelog.markdown)}>Copy Markdown</Button>
            <Button onClick={() => changelog && downloadText(`${changelog.title.replace(/[^\w.-]+/g, "-").toLowerCase()}-changelog.md`, changelog.markdown)}>Download .md</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}