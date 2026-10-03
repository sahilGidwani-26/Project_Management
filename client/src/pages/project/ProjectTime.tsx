import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/FormDialog";
import { useProject, useProjectResource, useProjectTasks } from "@/hooks/useProject";
import { attempt, fmtMinutes, toISO } from "@/lib/projectMeta";
import { formatDate } from "@/lib/utils";
import { TimeEntry } from "@/types";

const todayStr = () => new Date().toISOString().slice(0, 10);
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

export default function ProjectTime() {
  const { projectId, canEdit, isAdmin } = useProject();
  const { user } = useAuth(); // ASSUMPTION: useAuth() returns { user } with user._id
  const qc = useQueryClient();
  const { data: entries, reload } = useProjectResource<TimeEntry[]>("time", projectId);
  const { data: tasks } = useProjectTasks(projectId);

  const timerKey = `fb_timer_${projectId}`;
  const [startedAt, setStartedAt] = useState<number | null>(() => Number(localStorage.getItem(timerKey)) || null);
  const [now, setNow] = useState(Date.now());
  const [taskId, setTaskId] = useState("none");
  const [note, setNote] = useState("");
  const [h, setH] = useState("0");
  const [m, setM] = useState("30");
  const [date, setDate] = useState(todayStr());
  const [billable, setBillable] = useState(false);

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const log = async (minutes: number, day?: string) => {
    const ok = await attempt(
      () => api.post(`/projects/${projectId}/time`, { taskId: taskId === "none" ? null : taskId, minutes, note: note.trim() || null, date: toISO(day || todayStr()), billable }),
      "Time logged"
    );
    if (ok) { setNote(""); reload(); qc.invalidateQueries({ queryKey: ["tasks", projectId] }); }
    return ok;
  };

  const start = () => { const t = Date.now(); localStorage.setItem(timerKey, String(t)); setStartedAt(t); setNow(t); };
  const stop = async () => {
    if (!startedAt) return;
    const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    if (await log(minutes)) { localStorage.removeItem(timerKey); setStartedAt(null); }
  };
  const discard = () => { localStorage.removeItem(timerKey); setStartedAt(null); };

  const manualMinutes = (Number(h) || 0) * 60 + (Number(m) || 0);
  const list = entries || [];
  const total = list.reduce((a, e) => a + e.minutes, 0);
  const billableTotal = list.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0);
  const byUser = Object.entries(list.reduce<Record<string, number>>((a, e) => ((a[e.userId?.name || "Unknown"] = (a[e.userId?.name || "Unknown"] || 0) + e.minutes), a), {}));

  const taskPicker = (
    <Select value={taskId} onValueChange={setTaskId}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No specific task</SelectItem>
        {tasks?.map((t) => <SelectItem key={t._id} value={t._id}>TASK-{t.taskNumber} {t.title}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6 p-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total logged</p><p className="mt-1 text-2xl font-semibold">{fmtMinutes(total)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Billable</p><p className="mt-1 text-2xl font-semibold">{fmtMinutes(billableTotal)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Entries</p><p className="mt-1 text-2xl font-semibold">{list.length}</p></CardContent></Card>
      </div>

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardContent className="space-y-3 p-5">
            <h2 className="font-semibold">Timer</h2>
            <p className="text-3xl font-mono">{startedAt ? clock(now - startedAt) : "00:00:00"}</p>
            <Field label="Task">{taskPicker}</Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What are you working on?" /></Field>
            <div className="flex gap-2">
              {!startedAt ? <Button onClick={start}>Start</Button> : <><Button onClick={stop}>Stop & log</Button><Button variant="outline" onClick={discard}>Discard</Button></>}
            </div>
            <p className="text-xs text-muted-foreground">The timer keeps running even if you close this tab.</p>
          </CardContent></Card>

          <Card><CardContent className="space-y-3 p-5">
            <h2 className="font-semibold">Log time manually</h2>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Hours"><Input type="number" min={0} max={24} value={h} onChange={(e) => setH(e.target.value)} /></Field>
              <Field label="Minutes"><Input type="number" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} /></Field>
              <Field label="Date"><Input type="date" max={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> Billable</label>
            <Button disabled={manualMinutes < 1} onClick={() => log(manualMinutes, date)}>Add entry</Button>
            <p className="text-xs text-muted-foreground">Uses the task and note selected in the timer card.</p>
          </CardContent></Card>
        </div>
      )}

      {!!byUser.length && (
        <Card><CardContent className="p-5">
          <h3 className="mb-2 font-medium">By person</h3>
          <div className="flex flex-wrap gap-2">{byUser.map(([n, v]) => <span key={n} className="rounded-full bg-secondary px-3 py-1 text-xs">{n}: {fmtMinutes(v)}</span>)}</div>
        </CardContent></Card>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground"><tr>{["Date", "Person", "Task", "Note", "Time", "Billable", ""].map((x) => <th key={x} className="px-4 py-2.5 text-left font-medium">{x}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {!list.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No time logged yet.</td></tr>}
            {list.map((e) => (
              <tr key={e._id}>
                <td className="px-4 py-2.5 text-xs">{formatDate(e.date)}</td>
                <td className="px-4 py-2.5">{e.userId?.name}</td>
                <td className="px-4 py-2.5 text-xs">{e.taskId ? `TASK-${e.taskId.taskNumber} ${e.taskId.title}` : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.note || "—"}</td>
                <td className="px-4 py-2.5 font-medium">{fmtMinutes(e.minutes)}</td>
                <td className="px-4 py-2.5 text-xs">{e.billable ? "Yes" : "No"}</td>
                <td className="px-4 py-2.5 text-right">
                  {canEdit && (e.userId?._id === user?._id || isAdmin) && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm("Delete this entry?") && (await attempt(() => api.delete(`/projects/${projectId}/time/${e._id}`), "Deleted")) && (reload(), qc.invalidateQueries({ queryKey: ["tasks", projectId] }))}>Delete</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}