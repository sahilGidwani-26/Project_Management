import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { AttDay } from "@/types";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MODES, fmtDate, hhmm, zonedToMs } from "@/lib/attendance";

interface Row { in: string; out: string; mode: string }

export function EditDayDialog({
  open, onOpenChange, workspaceId, person, day, tz, today, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  person: { userId: string; name: string };
  day: AttDay;
  tz: string;
  today: string;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState("auto");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/attendance/workspace/${workspaceId}/records`;

  useEffect(() => {
    if (!open) return;
    setRows(day.sessions.map((s) => ({ in: hhmm(s.in, tz), out: s.out ? hhmm(s.out, tz) : "", mode: s.mode })));
    setTouched(false);
    setStatus(day.manual || "auto");
    setNote("");
  }, [open, day, tz]);

  const edit = (i: number, patch: Partial<Row>) => { setTouched(true); setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x))); };

  const save = async () => {
    if (note.trim().length < 3) return toast.error("Write a short reason for the change");
    const body: Record<string, unknown> = { userId: person.userId, date: day.date, note: note.trim() };
    if (touched) {
      const out: { in: number; out: number | null; mode: string }[] = [];
      for (const r of rows) {
        if (!r.in) return toast.error("Every session needs a check-in time");
        const i = zonedToMs(day.date, r.in, tz);
        const o = r.out ? zonedToMs(day.date, r.out, tz) : null;
        if (o != null && o <= i) return toast.error("A check-out must be after its check-in");
        if (o == null && day.date !== today) return toast.error("Past days need a check-out time");
        out.push({ in: i, out: o, mode: r.mode });
      }
      body.sessions = out;
    }
    if (status !== (day.manual || "auto")) body.manualStatus = status === "auto" ? "" : status;
    if (!("sessions" in body) && !("manualStatus" in body)) return toast.error("Nothing was changed");

    setBusy(true);
    try {
      await api.put(base, body);
      toast.success("Attendance updated. The person was emailed.");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  const clear = async () => {
    if (note.trim().length < 3) return toast.error("Write a reason first");
    if (!window.confirm("Remove every check-in of this day? The day will count as if nothing was recorded.")) return;
    setBusy(true);
    try {
      await api.delete(base, { params: { userId: person.userId, date: day.date, note: note.trim() } });
      toast.success("Record cleared");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={`${person.name} · ${fmtDate(day.date, { weekday: "short", day: "numeric", month: "short" })}`} onSubmit={save} busy={busy} submitLabel="Save correction" wide>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Check-ins ({tz})</p>
          <Button type="button" size="sm" variant="outline" onClick={() => { setTouched(true); setRows((r) => [...r, { in: "09:00", out: "18:00", mode: "Office" }]); }}><Plus className="h-3.5 w-3.5" /> Add session</Button>
        </div>
        {!rows.length && <p className="text-sm text-muted-foreground">No check-in on this day.</p>}
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input type="time" value={r.in} onChange={(e) => edit(i, { in: e.target.value })} className="w-32" />
            <span className="text-muted-foreground">to</span>
            <Input type="time" value={r.out} onChange={(e) => edit(i, { out: e.target.value })} className="w-32" placeholder="still in" />
            <Select value={r.mode} onValueChange={(v) => edit(i, { mode: v })}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { setTouched(true); setRows((x) => x.filter((_, k) => k !== i)); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Leave check-out empty only for today, if the person is still working.</p>
      </div>

      <Field label="Day verdict">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Automatic (from the hours worked)</SelectItem>
            <SelectItem value="present">Mark as present</SelectItem>
            <SelectItem value="half_day">Mark as half day</SelectItem>
            <SelectItem value="absent">Mark as absent</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Use this when the hours do not tell the story, for example a client visit with no check-in.</p>
      </Field>

      <Field label="Reason (the person will see it)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Forgot to check out, was at the client site…" />
      </Field>

      {(day.sessions.length > 0 || day.manual) && (
        <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={clear}>Clear this day completely</Button>
      )}
    </FormDialog>
  );
}