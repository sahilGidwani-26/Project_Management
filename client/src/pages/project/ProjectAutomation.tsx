import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { useProject, useProjectResource, useWorkspaceMembers } from "@/hooks/useProject";
import { PRIORITIES, TASK_STATUSES, attempt } from "@/lib/projectMeta";
import { cn, formatDate } from "@/lib/utils";
import { AutomationRule, RecurringTask } from "@/types";

const TRIGGERS: [string, string][] = [["task_created", "A task is created"], ["task_status_changed", "A task changes status"], ["task_assigned", "A task is assigned"]];
const ACTIONS: [string, string][] = [["notify_assignees", "Email the assignees"], ["notify_manager", "Email the project leads"], ["set_priority", "Set priority"], ["move_status", "Move to status"], ["add_label", "Add label"], ["assign_user", "Assign to person"]];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const label = (list: [string, string][], v: string) => list.find((x) => x[0] === v)?.[1] || v;

const blankRule = { name: "", triggerType: "task_status_changed", triggerStatus: "any", actionType: "notify_manager", actionValue: "" };
const blankRec = { title: "", description: "", priority: "Medium", frequency: "weekly", dayOfWeek: "1", dayOfMonth: "1", dueInDays: "3", assigneeIds: [] as string[] };

export default function ProjectAutomation() {
  const { workspaceId, projectId, canEdit, isAdmin } = useProject();
  const { data: rules, reload: reloadRules } = useProjectResource<AutomationRule[]>("automations", projectId);
  const { data: recurring, reload: reloadRec } = useProjectResource<RecurringTask[]>("recurring", projectId);
  const { data: members } = useWorkspaceMembers(workspaceId);
  const [rule, setRule] = useState<typeof blankRule | null>(null);
  const [rec, setRec] = useState<typeof blankRec | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/projects/${projectId}`;

  const saveRule = async () => {
    if (!rule) return;
    setBusy(true);
    const ok = await attempt(() => api.post(`${base}/automations`, { ...rule, triggerStatus: rule.triggerType === "task_status_changed" && rule.triggerStatus !== "any" ? rule.triggerStatus : null, actionValue: rule.actionValue || null }), "Rule created");
    setBusy(false);
    if (ok) { setRule(null); reloadRules(); }
  };
  const saveRec = async () => {
    if (!rec) return;
    setBusy(true);
    const ok = await attempt(() => api.post(`${base}/recurring`, { title: rec.title.trim(), description: rec.description, priority: rec.priority, frequency: rec.frequency, dayOfWeek: Number(rec.dayOfWeek), dayOfMonth: Number(rec.dayOfMonth), dueInDays: Number(rec.dueInDays) || 3, assigneeIds: rec.assigneeIds }), "Recurring task created");
    setBusy(false);
    if (ok) { setRec(null); reloadRec(); }
  };

  const valueInput = () => {
    if (!rule) return null;
    const a = rule.actionType;
    const set = (v: string) => setRule({ ...rule, actionValue: v });
    if (a === "set_priority") return <Select value={rule.actionValue} onValueChange={set}><SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger><SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>;
    if (a === "move_status") return <Select value={rule.actionValue} onValueChange={set}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent>{TASK_STATUSES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>;
    if (a === "assign_user") return <Select value={rule.actionValue} onValueChange={set}><SelectTrigger><SelectValue placeholder="Person" /></SelectTrigger><SelectContent>{members?.map((m) => <SelectItem key={m.userId._id} value={m.userId._id}>{m.userId.name}</SelectItem>)}</SelectContent></Select>;
    if (a === "add_label") return <Input value={rule.actionValue} onChange={(e) => set(e.target.value)} placeholder="e.g. needs-review" />;
    return <Input value={rule.actionValue} onChange={(e) => set(e.target.value)} placeholder="Optional message in the email" />;
  };
  const needsValue = rule && ["set_priority", "move_status", "assign_user", "add_label"].includes(rule.actionType);

  return (
    <div className="space-y-8 p-6">
      {/* RULES */}
      <section className="space-y-3">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Automation rules</h2><p className="text-xs text-muted-foreground">When something happens on a task, do something automatically.</p></div>{isAdmin && <Button size="sm" onClick={() => setRule(blankRule)}>New rule</Button>}</div>
        {!rules?.length && <p className="text-sm text-muted-foreground">No rules yet. Example: when a task moves to <b>Done</b>, email the project leads.</p>}
        {rules?.map((r) => (
          <Card key={r._id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className={cn(!r.active && "opacity-50")}>
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">When <b>{label(TRIGGERS, r.triggerType).toLowerCase()}</b>{r.triggerStatus && <> to <b>{r.triggerStatus}</b></>} → <b>{label(ACTIONS, r.actionType).toLowerCase()}</b>{r.actionValue && r.actionType !== "assign_user" && <>: {r.actionValue}</>} · ran {r.runCount}×{r.lastRunAt && `, last ${formatDate(r.lastRunAt)}`}</p>
            </div>
            {isAdmin && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.patch(`${base}/automations/${r._id}`, { active: !r.active }))) && reloadRules()}>{r.active ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm("Delete this rule?") && (await attempt(() => api.delete(`${base}/automations/${r._id}`), "Deleted")) && reloadRules()}>Delete</Button>
              </div>
            )}
          </CardContent></Card>
        ))}
      </section>

      {/* RECURRING */}
      <section className="space-y-3">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Recurring tasks</h2><p className="text-xs text-muted-foreground">A new task is created automatically (around 6 AM) and assignees get an email.</p></div>{canEdit && <Button size="sm" onClick={() => setRec(blankRec)}>New recurring task</Button>}</div>
        {!recurring?.length && <p className="text-sm text-muted-foreground">No recurring tasks yet.</p>}
        {recurring?.map((r) => (
          <Card key={r._id}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className={cn(!r.active && "opacity-50")}>
              <p className="font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground">
                {r.frequency === "daily" ? "Every day" : r.frequency === "weekly" ? `Every ${DAYS[r.dayOfWeek ?? 1]}` : `Monthly on day ${r.dayOfMonth}`} · due {r.dueInDays}d after creation · next {formatDate(r.nextRunAt)} · {r.assigneeIds.map((a) => a.name).join(", ") || "unassigned"}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.patch(`${base}/recurring/${r._id}`, { active: !r.active }))) && reloadRec()}>{r.active ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm("Delete this recurring task?") && (await attempt(() => api.delete(`${base}/recurring/${r._id}`), "Deleted")) && reloadRec()}>Delete</Button>
              </div>
            )}
          </CardContent></Card>
        ))}
      </section>

      {/* rule dialog */}
      <FormDialog open={!!rule} onOpenChange={(v) => !v && setRule(null)} title="New automation rule" onSubmit={saveRule} busy={busy} disabled={!rule?.name.trim() || (!!needsValue && !rule?.actionValue)}>
        {rule && (
          <>
            <Field label="Name"><Input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} placeholder="Notify leads when done" autoFocus /></Field>
            <Field label="When"><Select value={rule.triggerType} onValueChange={(v) => setRule({ ...rule, triggerType: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TRIGGERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field>
            {rule.triggerType === "task_status_changed" && (
              <Field label="…to status"><Select value={rule.triggerStatus} onValueChange={(v) => setRule({ ...rule, triggerStatus: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any status</SelectItem>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></Field>
            )}
            <Field label="Then"><Select value={rule.actionType} onValueChange={(v) => setRule({ ...rule, actionType: v, actionValue: "" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ACTIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Value">{valueInput()}</Field>
          </>
        )}
      </FormDialog>

      {/* recurring dialog */}
      <FormDialog open={!!rec} onOpenChange={(v) => !v && setRec(null)} title="New recurring task" onSubmit={saveRec} busy={busy} disabled={!rec?.title.trim()} wide>
        {rec && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2"><Input value={rec.title} onChange={(e) => setRec({ ...rec, title: e.target.value })} placeholder="Weekly status report" autoFocus /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={rec.description} onChange={(e) => setRec({ ...rec, description: e.target.value })} /></Field>
            <Field label="Repeats"><Select value={rec.frequency} onValueChange={(v) => setRec({ ...rec, frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select></Field>
            {rec.frequency === "weekly" && <Field label="On"><Select value={rec.dayOfWeek} onValueChange={(v) => setRec({ ...rec, dayOfWeek: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}</SelectContent></Select></Field>}
            {rec.frequency === "monthly" && <Field label="Day of month"><Input type="number" min={1} max={31} value={rec.dayOfMonth} onChange={(e) => setRec({ ...rec, dayOfMonth: e.target.value })} /></Field>}
            <Field label="Priority"><Select value={rec.priority} onValueChange={(v) => setRec({ ...rec, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Due (days after creation)"><Input type="number" min={0} max={90} value={rec.dueInDays} onChange={(e) => setRec({ ...rec, dueInDays: e.target.value })} /></Field>
            <Field label="Assignees" className="sm:col-span-2">
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border p-2">
                {members?.map((m) => { const on = rec.assigneeIds.includes(m.userId._id); return <button type="button" key={m.userId._id} onClick={() => setRec({ ...rec, assigneeIds: on ? rec.assigneeIds.filter((i) => i !== m.userId._id) : [...rec.assigneeIds, m.userId._id] })} className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>{m.userId.name}</button>; })}
              </div>
            </Field>
          </div>
        )}
      </FormDialog>
    </div>
  );
}