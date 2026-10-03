import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { useProject, useProjectResource, useWorkspaceMembers } from "@/hooks/useProject";
import { attempt, severityCls, toInput, toISO } from "@/lib/projectMeta";
import { cn, formatDate } from "@/lib/utils";
import { RiskIssue } from "@/types";

const SEVERITIES = ["Low", "Medium", "High", "Critical"];
const LEVELS = ["Low", "Medium", "High"];
const STATUSES = ["Open", "Mitigating", "Resolved", "Closed"];

interface Form { _id?: string; type: string; title: string; description: string; severity: string; probability: string; status: string; ownerId: string; mitigation: string; dueDate: string }
const blank: Form = { type: "Risk", title: "", description: "", severity: "Medium", probability: "Medium", status: "Open", ownerId: "none", mitigation: "", dueDate: "" };

export default function ProjectRisks() {
  const { workspaceId, projectId, canEdit, isAdmin } = useProject();
  const { data: items, reload } = useProjectResource<RiskIssue[]>("risks", projectId);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/projects/${projectId}/risks`;

  const list = (items || []).filter((r) => filter === "all" || r.type === filter);
  const open = (items || []).filter((r) => ["Open", "Mitigating"].includes(r.status));
  const set = (k: keyof Form, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const edit = (r: RiskIssue) => setForm({ _id: r._id, type: r.type, title: r.title, description: r.description || "", severity: r.severity, probability: r.probability, status: r.status, ownerId: r.ownerId?._id || "none", mitigation: r.mitigation || "", dueDate: toInput(r.dueDate) });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    const body = { type: form.type, title: form.title.trim(), description: form.description, severity: form.severity, probability: form.probability, status: form.status, ownerId: form.ownerId === "none" ? null : form.ownerId, mitigation: form.mitigation, dueDate: toISO(form.dueDate) };
    const ok = await attempt(() => (form._id ? api.patch(`${base}/${form._id}`, body) : api.post(base, body)), "Saved");
    setBusy(false);
    if (ok) { setForm(null); reload(); }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md border border-border p-0.5">
          {["all", "Risk", "Issue"].map((f) => <button key={f} onClick={() => setFilter(f)} className={cn("rounded px-3 py-1 text-xs font-medium capitalize", filter === f ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{f === "all" ? "All" : `${f}s`}</button>)}
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{open.length} open</span>
          {canEdit && <Button size="sm" onClick={() => setForm(blank)}>Add risk / issue</Button>}
        </div>
      </div>

      {!list.length && <p className="text-sm text-muted-foreground">Nothing logged. A <b>risk</b> might happen later, an <b>issue</b> is already a problem.</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((r) => (
          <Card key={r._id}><CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase">{r.type}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", severityCls[r.severity])}>{r.severity}</span>
                  <span className="text-[11px] text-muted-foreground">likelihood: {r.probability}</span>
                </div>
                <h3 className="mt-1.5 font-medium">{r.title}</h3>
              </div>
              {canEdit ? (
                <Select value={r.status} onValueChange={async (v) => (await attempt(() => api.patch(`${base}/${r._id}`, { status: v }), "Status updated")) && reload()}>
                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              ) : <span className="text-xs">{r.status}</span>}
            </div>
            {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
            {r.mitigation && <p className="rounded bg-secondary/60 p-2 text-xs"><b>Mitigation:</b> {r.mitigation}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Owner: {r.ownerId?.name || "Unassigned"}{r.dueDate && ` · due ${formatDate(r.dueDate)}`}</span>
              {canEdit && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => edit(r)}>Edit</Button>
                  {isAdmin && <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm("Delete this item?") && (await attempt(() => api.delete(`${base}/${r._id}`), "Deleted")) && reload()}>Delete</Button>}
                </span>
              )}
            </div>
          </CardContent></Card>
        ))}
      </div>

      <FormDialog open={!!form} onOpenChange={(v) => !v && setForm(null)} title={form?._id ? "Edit item" : "New risk / issue"} onSubmit={save} busy={busy} disabled={!form?.title.trim()} wide>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type"><Select value={form.type} onValueChange={(v) => set("type", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Risk">Risk</SelectItem><SelectItem value="Issue">Issue</SelectItem></SelectContent></Select></Field>
            <Field label="Status"><Select value={form.status} onValueChange={(v) => set("status", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Title" className="sm:col-span-2"><Input value={form.title} onChange={(e) => set("title", e.target.value)} autoFocus /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
            <Field label="Severity"><Select value={form.severity} onValueChange={(v) => set("severity", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Likelihood"><Select value={form.probability} onValueChange={(v) => set("probability", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Owner"><Select value={form.ownerId} onValueChange={(v) => set("ownerId", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{members?.map((m) => <SelectItem key={m.userId._id} value={m.userId._id}>{m.userId.name}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Due date"><Input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} /></Field>
            <Field label="Mitigation plan" className="sm:col-span-2"><Textarea value={form.mitigation} onChange={(e) => set("mitigation", e.target.value)} /></Field>
          </div>
        )}
      </FormDialog>
    </div>
  );
}