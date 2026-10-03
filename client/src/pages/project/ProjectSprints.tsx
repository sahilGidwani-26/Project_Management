import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriorityBadge } from "@/components/common/PriorityBadge";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { api } from "@/lib/api";
import { useProject, useProjectResource, useProjectTasks } from "@/hooks/useProject";
import { attempt, toInput, toISO } from "@/lib/projectMeta";
import { formatDate } from "@/lib/utils";
import { Sprint, Task } from "@/types";

export default function ProjectSprints() {
  const { projectId, canEdit } = useProject();
  const qc = useQueryClient();
  const { data: sprints, reload } = useProjectResource<Sprint[]>("sprints", projectId);
  const { data: tasks } = useProjectTasks(projectId);
  const [form, setForm] = useState<Partial<Sprint> | null>(null);
  const [finishing, setFinishing] = useState<Sprint | null>(null);
  const [moveTo, setMoveTo] = useState("backlog");
  const [busy, setBusy] = useState(false);

  const all = sprints || [];
  const byId = new Map((tasks || []).map((t) => [t._id, t]));
  const inSprint = new Set(all.filter((s) => s.status !== "Completed").flatMap((s) => s.taskIds.map(String)));
  const backlog = (tasks || []).filter((t) => !inSprint.has(t._id) && t.status !== "Done");
  const open = all.filter((s) => s.status !== "Completed");
  const planned = all.filter((s) => s.status === "Planned");
  const sync = () => { reload(); qc.invalidateQueries({ queryKey: ["tasks", projectId] }); };
  const call = async (fn: () => Promise<unknown>, ok: string) => { if (await attempt(fn, ok)) sync(); };
  const base = `/projects/${projectId}/sprints`;

  const save = async () => {
    setBusy(true);
    const body = { name: form!.name, goal: form!.goal, startDate: toISO(toInput(form!.startDate)), endDate: toISO(toInput(form!.endDate)) };
    const ok = await attempt(() => (form!._id ? api.patch(`${base}/${form!._id}`, body) : api.post(base, body)), "Sprint saved");
    setBusy(false);
    if (ok) { setForm(null); sync(); }
  };
  const finish = async () => {
    setBusy(true);
    const ok = await attempt(() => api.post(`${base}/${finishing!._id}/complete`, { moveTo }), "Sprint completed");
    setBusy(false);
    if (ok) { setFinishing(null); sync(); }
  };

  const TaskRow = ({ t, right }: { t: Task; right?: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 rounded border border-border bg-card px-3 py-2 text-sm">
      <div className="min-w-0"><span className="mr-2 font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>{t.title}</div>
      <div className="flex shrink-0 items-center gap-2"><PriorityBadge priority={t.priority} />{right}</div>
    </div>
  );

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-5">
      <div className="space-y-2 lg:col-span-2">
        <h2 className="font-semibold">Backlog <span className="text-sm font-normal text-muted-foreground">({backlog.length})</span></h2>
        {!backlog.length && <p className="text-sm text-muted-foreground">Nothing in the backlog.</p>}
        {backlog.map((t) => (
          <TaskRow key={t._id} t={t} right={canEdit && open.length > 0 && (
            <Select onValueChange={(sid) => call(() => api.put(`${base}/${sid}/tasks`, { add: [t._id] }), "Added to sprint")}>
              <SelectTrigger className="h-7 w-24 text-xs"><SelectValue placeholder="Add to…" /></SelectTrigger>
              <SelectContent>{open.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          )} />
        ))}
      </div>

      <div className="space-y-4 lg:col-span-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Sprints</h2>{canEdit && <Button size="sm" onClick={() => setForm({})}>New sprint</Button>}</div>
        {!all.length && <p className="text-sm text-muted-foreground">No sprints yet. Create one and pull tasks in from the backlog.</p>}
        {[...all].sort((a, b) => (a.status === "Completed" ? 1 : 0) - (b.status === "Completed" ? 1 : 0)).map((s) => {
          const ts = s.taskIds.map((id) => byId.get(String(id))).filter(Boolean) as Task[];
          const done = ts.filter((t) => t.status === "Done").length;
          return (
            <Card key={s._id}><CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2"><h3 className="font-medium">{s.name}</h3><Badge variant={s.status === "Active" ? "default" : "secondary"}>{s.status}</Badge></div>
                  <p className="text-xs text-muted-foreground">{s.startDate ? formatDate(s.startDate) : "…"} → {s.endDate ? formatDate(s.endDate) : "…"}{s.status === "Completed" && ` · velocity ${s.velocity}/${s.committed}`}</p>
                  {s.goal && <p className="mt-1 text-sm">Goal: {s.goal}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    {s.status === "Planned" && <Button size="sm" onClick={() => call(() => api.post(`${base}/${s._id}/start`), "Sprint started")}>Start</Button>}
                    {s.status === "Active" && <Button size="sm" onClick={() => { setFinishing(s); setMoveTo("backlog"); }}>Complete</Button>}
                    {s.status !== "Completed" && <Button size="sm" variant="ghost" onClick={() => setForm(s)}>Edit</Button>}
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm("Delete this sprint? Tasks stay in the project.") && call(() => api.delete(`${base}/${s._id}`), "Sprint deleted")}>Delete</Button>
                  </div>
                )}
              </div>
              {s.status !== "Completed" && (
                <div><div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${ts.length ? (done / ts.length) * 100 : 0}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{done}/{ts.length} tasks done</p></div>
              )}
              <div className="space-y-1.5">
                {ts.map((t) => <TaskRow key={t._id} t={t} right={canEdit && s.status !== "Completed" && <button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => call(() => api.put(`${base}/${s._id}/tasks`, { remove: [t._id] }), "Removed from sprint")}>✕</button>} />)}
                {!ts.length && <p className="text-xs text-muted-foreground">No tasks in this sprint.</p>}
              </div>
            </CardContent></Card>
          );
        })}
      </div>

      <FormDialog open={!!form} onOpenChange={(v) => !v && setForm(null)} title={form?._id ? "Edit sprint" : "New sprint"} onSubmit={save} busy={busy} disabled={!form?.name?.trim()}>
        <Field label="Name"><Input value={form?.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sprint 1" autoFocus /></Field>
        <Field label="Goal"><Textarea value={form?.goal || ""} onChange={(e) => setForm({ ...form, goal: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><Input type="date" value={toInput(form?.startDate)} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label="End"><Input type="date" value={toInput(form?.endDate)} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
        </div>
      </FormDialog>

      <FormDialog open={!!finishing} onOpenChange={(v) => !v && setFinishing(null)} title={`Complete ${finishing?.name}`} onSubmit={finish} busy={busy} submitLabel="Complete sprint">
        <p className="text-sm text-muted-foreground">Unfinished tasks will be moved:</p>
        <Select value={moveTo} onValueChange={setMoveTo}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="backlog">Back to backlog</SelectItem>{planned.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
      </FormDialog>
    </div>
  );
}