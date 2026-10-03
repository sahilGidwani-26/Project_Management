import { useState } from "react";
import { Milestone, ActivityItem } from "@/types";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { useProject, useProjectResource, useProjectTasks } from "@/hooks/useProject";
import { attempt, timeAgo, toInput, toISO } from "@/lib/projectMeta";
import { cn, formatDate, isOverdue } from "@/lib/utils";

const Stat = ({ label, value, cls }: { label: string; value: number | string; cls?: string }) => (
  <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p></CardContent></Card>
);

const actionText = (a: ActivityItem) => {
  const t = a.metadata?.title || a.metadata?.name;
  return `${a.action.replace(/_/g, " ")}${t ? ` · ${t}` : ""}`;
};

export default function ProjectOverview() {
  const { projectId, project, stats, canEdit, refresh } = useProject();
  const { data: milestones, reload } = useProjectResource<Milestone[]>("milestones", projectId);
  const { data: activity } = useProjectResource<ActivityItem[]>("activity", projectId);
  const { data: tasks } = useProjectTasks(projectId);
  const [form, setForm] = useState<Partial<Milestone> | null>(null);
  const [linking, setLinking] = useState<Milestone | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  if (!project || !stats) return <div className="p-6"><Skeleton className="h-40" /></div>;
  const done = async (ok: boolean) => { setBusy(false); if (ok) { setForm(null); setLinking(null); reload(); refresh(); } };

  const save = async () => {
    setBusy(true);
    const body = { title: form!.title, description: form!.description, dueDate: toISO(toInput(form!.dueDate)) };
    done(await attempt(() => (form!._id ? api.patch(`/projects/${projectId}/milestones/${form!._id}`, body) : api.post(`/projects/${projectId}/milestones`, body)), "Milestone saved"));
  };
  const saveLinks = async () => { setBusy(true); done(await attempt(() => api.put(`/projects/${projectId}/milestones/${linking!._id}/tasks`, { taskIds: [...picked] }), "Tasks linked")); };

  return (
    <div className="space-y-6 p-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Total tasks" value={stats.total} />
        <Stat label="Completed" value={stats.completed} cls="text-emerald-600" />
        <Stat label="In progress" value={stats.inProgress} cls="text-amber-600" />
        <Stat label="Overdue" value={stats.overdue} cls={stats.overdue ? "text-destructive" : ""} />
        <Stat label="Open risks" value={stats.openRisks} />
      </div>

      <Card><CardContent className="p-5">
        <div className="flex items-center justify-between text-sm"><span className="font-medium">Overall progress</span><span>{project.progress}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} /></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[["Start", project.startDate ? formatDate(project.startDate) : "—"], ["Due", project.endDate ? formatDate(project.endDate) : "—"], ["Category", project.category || "—"], ["Client", project.clientName || "—"],
            ["Budget", project.budget != null ? `${project.budget.toLocaleString()} ${project.currency}` : "—"], ["Visibility", project.visibility || "public"], ["Manager", project.managerId?.name || "—"], ["Milestones", `${stats.milestones.done}/${stats.milestones.total}`]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>
          ))}
        </dl>
        {!!project.tags?.length && <div className="mt-3 flex flex-wrap gap-1">{project.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</div>}
      </CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Milestones</h2>{canEdit && <Button size="sm" onClick={() => setForm({})}>Add milestone</Button>}</div>
          {!milestones?.length && <p className="text-sm text-muted-foreground">No milestones yet. Milestones mark big checkpoints like "Design done" or "Launch".</p>}
          {milestones?.map((m) => (
            <Card key={m._id}><CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={m.status === "Completed"} disabled={!canEdit} onChange={async () => (await attempt(() => api.post(`/projects/${projectId}/milestones/${m._id}/toggle`))) && (reload(), refresh())} />
                  <div>
                    <p className={cn("font-medium", m.status === "Completed" && "text-muted-foreground line-through")}>{m.title}</p>
                    <p className={cn("text-xs text-muted-foreground", m.dueDate && m.status === "Open" && isOverdue(m.dueDate) && "text-destructive")}>{m.dueDate ? `Due ${formatDate(m.dueDate)}` : "No due date"} · {m.taskDone}/{m.taskTotal} tasks</p>
                  </div>
                </div>
                {canEdit && (
                  <div className="flex gap-1 text-xs">
                    <Button size="sm" variant="ghost" onClick={() => { setLinking(m); setPicked(new Set(m.taskIds.map(String))); }}>Tasks</Button>
                    <Button size="sm" variant="ghost" onClick={() => setForm(m)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm("Delete this milestone?") && (await attempt(() => api.delete(`/projects/${projectId}/milestones/${m._id}`))) && (reload(), refresh())}>Delete</Button>
                  </div>
                )}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${m.progress}%` }} /></div>
            </CardContent></Card>
          ))}
        </div>

        <div className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">Recent activity</h2>
          <Card><CardContent className="divide-y divide-border p-0">
            {!activity?.length && <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>}
            {activity?.map((a) => (
              <div key={a._id} className="px-4 py-2.5 text-sm"><span className="font-medium">{a.actorId?.name || "Someone"}</span> <span className="text-muted-foreground">{actionText(a)}</span><p className="text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</p></div>
            ))}
          </CardContent></Card>
        </div>
      </div>

      <FormDialog open={!!form} onOpenChange={(v) => !v && setForm(null)} title={form?._id ? "Edit milestone" : "New milestone"} onSubmit={save} busy={busy} disabled={!form?.title?.trim()}>
        <Field label="Title"><Input value={form?.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
        <Field label="Description"><Textarea value={form?.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Due date"><Input type="date" value={toInput(form?.dueDate)} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
      </FormDialog>

      <FormDialog open={!!linking} onOpenChange={(v) => !v && setLinking(null)} title={`Tasks in "${linking?.title}"`} onSubmit={saveLinks} busy={busy}>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {!tasks?.length && <p className="text-sm text-muted-foreground">No tasks in this project yet.</p>}
          {tasks?.map((t) => (
            <label key={t._id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/50">
              <input type="checkbox" checked={picked.has(t._id)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(t._id) ? n.delete(t._id) : n.add(t._id); return n; })} />
              <span className="font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>{t.title}
            </label>
          ))}
        </div>
      </FormDialog>
    </div>
  );
}