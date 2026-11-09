import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { AttSettings, LeaveTypeItem } from "@/types";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { attempt } from "@/lib/projectMeta";
import { DAYS, fmtDate, hmMinutes } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { PersonCell } from "./attendanceUi";

const ORD = ["1st", "2nd", "3rd", "4th", "5th"];
const COLORS = ["#2563EB", "#DC2626", "#16A34A", "#64748B", "#CA8A04", "#7C3AED", "#DB2777", "#0F766E"];
const native = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

const zones: string[] = (() => {
  try {
    const z = (Intl as any).supportedValuesOf?.("timeZone");
    if (z?.length) return z;
  } catch { /* old browser */ }
  return ["Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];
})();

interface Form {
  timezone: string; workStart: string; workEnd: string; workingDays: number[]; offSaturdays: number[]; grace: string; fullHours: string; halfHours: string;
  trackingStart: string; reminderEnabled: boolean; reminderTime: string; checkoutEnabled: boolean; checkoutTime: string;
}
const toForm = (s: AttSettings): Form => ({
  timezone: s.timezone, workStart: s.workStart, workEnd: s.workEnd, workingDays: s.workingDays, offSaturdays: s.offSaturdays, grace: String(s.graceMinutes),
  fullHours: String(s.fullDayMinutes / 60), halfHours: String(s.halfDayMinutes / 60), trackingStart: s.trackingStartDate || "",
  reminderEnabled: s.reminderEnabled, reminderTime: s.reminderTime, checkoutEnabled: s.checkoutReminderEnabled, checkoutTime: s.checkoutReminderTime,
});

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <Card><CardContent className="space-y-4 p-5"><div><h3 className="font-medium">{title}</h3>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>{children}</CardContent></Card>
);

const refreshAll = (qc: ReturnType<typeof useQueryClient>, w: string, keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, w] }));
const ALL_KEYS = ["att-settings", "att-holidays", "leave-types", "att-tracking", "att-today", "att-me", "att-live", "att-team", "att-matrix", "att-emp"];

/* --------------------------------- holidays --------------------------------- */

function HolidaysCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/attendance/workspace/${workspaceId}`;

  const { data } = useQuery({
    queryKey: ["att-holidays", workspaceId, year],
    queryFn: async () => (await api.get(`${base}/holidays?year=${year}`)).data.data as { holidays: { _id: string; date: string; name: string }[] },
  });

  const save = async (holidays: { date: string; name: string }[]) => {
    setBusy(true);
    const ok = await attempt(() => api.post(`${base}/holidays`, { holidays }), `${holidays.length} holiday(s) saved`);
    setBusy(false);
    if (ok) { setDate(""); setName(""); setBulk(""); refreshAll(qc, workspaceId, ALL_KEYS); }
  };
  const addBulk = () => {
    const list = bulk.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = /^(\d{4}-\d{2}-\d{2})[\s,;\t]+(.+)$/.exec(l);
      return m ? { date: m[1], name: m[2].trim() } : null;
    });
    if (list.some((x) => !x)) return toast.error("Each line must look like: 2026-11-12, Diwali");
    save(list as { date: string; name: string }[]);
  };
  const remove = async (id: string) => { if (await attempt(() => api.delete(`${base}/holidays/${id}`), "Holiday removed")) refreshAll(qc, workspaceId, ALL_KEYS); };

  return (
    <Section title="Holidays" hint="Nobody is expected to check in on these days, and they never lower a rating.">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Year">
          <select className={cn(native, "w-28")} value={year} onChange={(e) => setYear(e.target.value)}>{[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => <option key={y}>{y}</option>)}</select>
        </Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" /></Field>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali" maxLength={80} className="w-56" /></Field>
        <Button size="sm" disabled={busy || !date || name.trim().length < 2} onClick={() => save([{ date, name: name.trim() }])}><Plus className="h-4 w-4" /> Add holiday</Button>
      </div>

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm">Add many at once</summary>
        <div className="space-y-2 border-t border-border p-3">
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} placeholder={"2026-11-12, Diwali\n2026-12-25, Christmas"} className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs" />
          <Button size="sm" variant="outline" disabled={busy || !bulk.trim()} onClick={addBulk}>Save these holidays</Button>
        </div>
      </details>

      {!data?.holidays.length && <p className="text-sm text-muted-foreground">No holiday marked for {year}.</p>}
      <div className="divide-y divide-border">
        {data?.holidays.map((h) => (
          <div key={h._id} className="flex items-center justify-between py-2 text-sm">
            <span><b>{h.name}</b> <span className="text-muted-foreground">· {fmtDate(h.date, { weekday: "short", day: "numeric", month: "long" })}</span></span>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(h._id)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------- leave types ------------------------------- */

function TypeDialog({ workspaceId, item, open, onOpenChange }: { workspaceId: string; item: LeaveTypeItem | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", code: "", color: COLORS[0], quota: "0", paid: true, active: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF(item ? { name: item.name, code: item.code, color: item.color, quota: String(item.yearlyQuota), paid: item.paid, active: item.active } : { name: "", code: "", color: COLORS[0], quota: "0", paid: true, active: true });
  }, [open, item]);

  const save = async () => {
    setBusy(true);
    const body = { name: f.name.trim(), code: f.code.trim(), color: f.color, yearlyQuota: Number(f.quota) || 0, paid: f.paid, ...(item ? { active: f.active } : {}) };
    const base = `/attendance/workspace/${workspaceId}/leave/types`;
    const ok = await attempt(() => (item ? api.patch(`${base}/${item._id}`, body) : api.post(base, body)), "Leave type saved");
    setBusy(false);
    if (ok) { refreshAll(qc, workspaceId, ALL_KEYS); onOpenChange(false); }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={item ? "Edit leave type" : "New leave type"} onSubmit={save} busy={busy} disabled={f.name.trim().length < 2} submitLabel="Save">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} placeholder="Casual Leave" autoFocus /></Field>
        <Field label="Short code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={6} placeholder="CL" /></Field>
      </div>
      <Field label="Days per year (0 = no limit)"><Input type="number" min={0} max={366} value={f.quota} onChange={(e) => setF({ ...f, quota: e.target.value })} className="w-32" /></Field>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} className={cn("h-6 w-6 rounded-full border-2", f.color === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />)}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> Paid leave (does not lower the attendance rate)</label>
      {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Available for new requests</label>}
    </FormDialog>
  );
}

function LeaveTypesCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<LeaveTypeItem | null>(null);
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["leave-types", workspaceId], queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/leave/types`)).data.data as LeaveTypeItem[] });

  const remove = async (t: LeaveTypeItem) => {
    if (!window.confirm(`Delete “${t.name}”? If it was used before it is switched off instead.`)) return;
    try {
      const res = await api.delete(`/attendance/workspace/${workspaceId}/leave/types/${t._id}`);
      toast.success(res.data.message);
      refreshAll(qc, workspaceId, ALL_KEYS);
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <Section title="Leave types" hint="Yearly quotas and whether the leave is paid.">
      <Button size="sm" variant="outline" onClick={() => { setEdit(null); setOpen(true); }}><Plus className="h-4 w-4" /> New leave type</Button>
      <div className="divide-y divide-border">
        {data?.map((t) => (
          <div key={t._id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm", !t.active && "opacity-50")}>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} /><b>{t.name}</b><span className="text-xs text-muted-foreground">{t.code} · {t.yearlyQuota ? `${t.yearlyQuota} days / year` : "no limit"} · {t.paid ? "paid" : "unpaid"}{t.active ? "" : " · off"}</span></span>
            <span className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEdit(t); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(t)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </span>
          </div>
        ))}
      </div>
      <TypeDialog workspaceId={workspaceId} item={edit} open={open} onOpenChange={setOpen} />
    </Section>
  );
}

/* --------------------------------- tracking --------------------------------- */

interface Tracked { memberId: string; userId: string; name: string; email: string; profileImage?: string; roleName: string; designation?: string; canMark: boolean; exempt: boolean; tracked: boolean }

function TrackingCard({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["att-tracking", workspaceId], queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/tracking`)).data.data as Tracked[] });
  const list = (data || []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));

  const toggle = async (p: Tracked) => {
    if (await attempt(() => api.put(`/attendance/workspace/${workspaceId}/members/${p.memberId}/tracking`, { exempt: !p.exempt }), p.exempt ? `${p.name} is tracked again` : `${p.name} is no longer tracked`)) refreshAll(qc, workspaceId, ALL_KEYS);
  };

  return (
    <Section title="Who is tracked" hint="Everyone whose role has “Check in and check out” is tracked. Switch off people such as clients or freelancers here.">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person…" className="max-w-xs" />
      <div className="divide-y divide-border">
        {list.map((p) => (
          <div key={p.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <PersonCell p={p} />
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">{p.roleName}</Badge>
              {!p.canMark ? <span className="text-xs text-muted-foreground">Role cannot check in</span> : (
                <Button size="sm" variant={p.exempt ? "default" : "outline"} onClick={() => toggle(p)}>{p.exempt ? "Track again" : "Do not track"}</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ----------------------------------- tab ----------------------------------- */

export function AttendanceSettingsTab({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["att-settings", workspaceId], queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/settings`)).data.data as AttSettings });
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) setF(toForm(s)); }, [s]);
  const tzList = useMemo(() => [...new Set([f?.timezone || "UTC", "UTC", ...zones])].sort(), [f?.timezone]);

  if (!f) return <Skeleton className="h-96" />;
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const toggleIn = (k: "workingDays" | "offSaturdays", n: number) => set({ [k]: f[k].includes(n) ? f[k].filter((x) => x !== n) : [...f[k], n].sort() } as Partial<Form>);
  const full = Math.round(Number(f.fullHours) * 60);
  const half = Math.round(Number(f.halfHours) * 60);

  const save = async () => {
    if (!f.workingDays.length) return toast.error("Choose at least one working day");
    if (hmMinutes(f.workEnd) <= hmMinutes(f.workStart)) return toast.error("The work day must end after it starts");
    if (!(full >= 60) || !(half >= 30) || half > full) return toast.error("Check the full day and half day hours (half day cannot be more than a full day)");
    setBusy(true);
    const ok = await attempt(
      () => api.put(`/attendance/workspace/${workspaceId}/settings`, {
        timezone: f.timezone, workStart: f.workStart, workEnd: f.workEnd, workingDays: f.workingDays, offSaturdays: f.workingDays.includes(6) ? f.offSaturdays : [],
        graceMinutes: Number(f.grace) || 0, fullDayMinutes: full, halfDayMinutes: half, trackingStartDate: f.trackingStart,
        reminderEnabled: f.reminderEnabled, reminderTime: f.reminderTime, checkoutReminderEnabled: f.checkoutEnabled, checkoutReminderTime: f.checkoutTime,
      }),
      "Settings saved"
    );
    setBusy(false);
    if (ok) refreshAll(qc, workspaceId, ALL_KEYS);
  };

  return (
    <div className="space-y-6">
      <Section title="Working days and hours" hint="These rules decide who is present, late, half day or absent.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Timezone" className="sm:col-span-2">
            <select className={native} value={f.timezone} onChange={(e) => set({ timezone: e.target.value })}>{tzList.map((z) => <option key={z}>{z}</option>)}</select>
          </Field>
          <Field label="Work starts"><Input type="time" value={f.workStart} onChange={(e) => set({ workStart: e.target.value })} /></Field>
          <Field label="Work ends"><Input type="time" value={f.workEnd} onChange={(e) => set({ workEnd: e.target.value })} /></Field>
          <Field label="Grace time (minutes)"><Input type="number" min={0} max={240} value={f.grace} onChange={(e) => set({ grace: e.target.value })} /></Field>
          <Field label="Full day = hours"><Input type="number" min={1} max={24} step={0.5} value={f.fullHours} onChange={(e) => set({ fullHours: e.target.value })} /></Field>
          <Field label="Half day = hours"><Input type="number" min={0.5} max={24} step={0.5} value={f.halfHours} onChange={(e) => set({ halfHours: e.target.value })} /></Field>
          <Field label="Tracking starts on"><Input type="date" value={f.trackingStart} onChange={(e) => set({ trackingStart: e.target.value })} /></Field>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Working days</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <button key={d} type="button" onClick={() => toggleIn("workingDays", i)} className={cn("rounded-md border px-3 py-1.5 text-sm", f.workingDays.includes(i) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>{d}</button>
            ))}
          </div>
          {f.workingDays.includes(6) && (
            <div className="space-y-1.5 pt-1">
              <p className="text-sm font-medium">Saturdays that are off</p>
              <div className="flex flex-wrap gap-2">
                {ORD.map((o, i) => (
                  <button key={o} type="button" onClick={() => toggleIn("offSaturdays", i + 1)} className={cn("rounded-md border px-3 py-1.5 text-sm", f.offSaturdays.includes(i + 1) ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border text-muted-foreground")}>{o}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          <li><b>Late</b> = first check-in after {f.workStart} plus {f.grace || 0} minutes of grace.</li>
          <li><b>Present</b> = {f.fullHours || "?"} hours or more worked. <b>Half day</b> = {f.halfHours || "?"} hours or more. Anything less is absent.</li>
          <li>Days before <b>Tracking starts on</b> (and before a person joined) are never counted as absent.</li>
        </ul>
      </Section>

      <Section title="Reminder emails" hint="Sent on working days only, once per person, only to people who still need to act.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div><p className="text-sm font-medium">Check-in reminder</p><p className="text-xs text-muted-foreground">Emails people who have not checked in yet</p></div>
            <div className="flex items-center gap-2"><Input type="time" value={f.reminderTime} onChange={(e) => set({ reminderTime: e.target.value })} className="w-28" disabled={!f.reminderEnabled} /><Switch checked={f.reminderEnabled} onCheckedChange={(v) => set({ reminderEnabled: v })} /></div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div><p className="text-sm font-medium">Check-out reminder</p><p className="text-xs text-muted-foreground">Emails people who are still checked in</p></div>
            <div className="flex items-center gap-2"><Input type="time" value={f.checkoutTime} onChange={(e) => set({ checkoutTime: e.target.value })} className="w-28" disabled={!f.checkoutEnabled} /><Switch checked={f.checkoutEnabled} onCheckedChange={(v) => set({ checkoutEnabled: v })} /></div>
          </div>
        </div>
      </Section>

      <div className="flex justify-end"><Button disabled={busy} onClick={save}>Save settings</Button></div>

      <HolidaysCard workspaceId={workspaceId} />
      <LeaveTypesCard workspaceId={workspaceId} />
      <TrackingCard workspaceId={workspaceId} />
    </div>
  );
}