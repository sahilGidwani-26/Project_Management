import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock, Home, LogIn, LogOut, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import { AttToday } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { attempt } from "@/lib/projectMeta";
import { fmtDate, fmtDur, fmtTime, hmMinutes, minutesNow, pad } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./attendanceUi";

const MODES = [["Office", Building2], ["Remote", Home], ["On-site", MapPin]] as const;
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };

export function MyDay({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const { data: t, dataUpdatedAt } = useQuery({
    queryKey: ["att-today", workspaceId],
    queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/today`)).data.data as AttToday,
    refetchInterval: 60_000,
  });
  const [mode, setMode] = useState("Office");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const open = !!t?.openSince;

  useEffect(() => {
    if (!open) return;
    const i = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(i);
  }, [open]);

  if (!t) return <Skeleton className="h-56" />;

  const act = async (path: "check-in" | "check-out") => {
    setBusy(true);
    const ok = await attempt(() => api.post(`/attendance/workspace/${workspaceId}/${path}`, path === "check-in" ? { mode, note } : {}), path === "check-in" ? "Checked in. Have a great day!" : "Checked out. See you tomorrow!");
    setBusy(false);
    if (ok) { setNote(""); ["att-today", "att-me", "att-live"].forEach((k) => qc.invalidateQueries({ queryKey: [k, workspaceId] })); }
  };

  const day = t.day;
  const live = day.worked * 60000 + (open ? Math.max(0, tick - dataUpdatedAt) : 0);
  const lateNow = !day.sessions.length && t.isWorkingDay && !t.onLeave && minutesNow(t.timezone) > hmMinutes(t.shift.start) + t.shift.graceMinutes;
  const target = t.shift.fullDayMinutes * 60000;

  return (
    <Card><CardContent className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{fmtDate(t.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm"><Clock className="h-3.5 w-3.5" /> Shift {t.shift.start} to {t.shift.end} · {t.timezone}</p>
        </div>
        <StatusBadge status={t.holiday ? "holiday" : t.onLeave ? "leave" : !t.isWorkingDay ? "weekoff" : day.status === "future" ? "pending" : day.status} />
      </div>

      {t.holiday && <p className="rounded-md bg-violet-500/10 px-3 py-2 text-sm">Today is a holiday: <b>{t.holiday}</b>.</p>}
      {t.onLeave && <p className="rounded-md bg-sky-500/10 px-3 py-2 text-sm">You are on approved leave today.</p>}
      {!t.holiday && !t.isWorkingDay && <p className="rounded-md bg-secondary px-3 py-2 text-sm">Today is a week off.</p>}

      <div className="text-center">
        <p className="font-mono text-5xl font-semibold tabular-nums">{clock(open ? Math.max(0, tick - (t.openSince as number)) : live)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {open ? `Checked in at ${fmtTime(t.openSince, t.timezone)} · today so far ${fmtDur(Math.floor(live / 60000))}` : day.sessions.length ? `Today: ${fmtDur(day.worked)} of ${fmtDur(t.shift.fullDayMinutes)}` : "You have not checked in today"}
        </p>
        {day.sessions.length > 0 && <div className="mx-auto mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (live / target) * 100)}%` }} /></div>}
      </div>

      {can("attendance.mark") && !t.onLeave && (
        <div className="space-y-3">
          {!open && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {MODES.map(([m, Icon]) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm", mode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  <Icon className="h-4 w-4" /> {m}
                </button>
              ))}
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={200} className="max-w-[220px]" />
            </div>
          )}
          <div className="flex justify-center">
            {open ? (
              <Button size="lg" variant="outline" className="min-w-52 border-red-500/50 text-red-600 hover:bg-red-500/10" disabled={busy} onClick={() => act("check-out")}><LogOut className="h-5 w-5" /> Check out</Button>
            ) : (
              <Button size="lg" className="min-w-52" disabled={busy} onClick={() => act("check-in")}><LogIn className="h-5 w-5" /> {day.sessions.length ? "Check in again" : "Check in"}</Button>
            )}
          </div>
          {lateNow && !open && <p className="text-center text-xs text-amber-600">Your shift started at {t.shift.start}. Checking in now will be marked late.</p>}
        </div>
      )}

      {day.sessions.length > 0 && (
        <div className="divide-y divide-border rounded-md border border-border text-sm">
          {day.sessions.map((s, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2">
              <span>{fmtTime(s.in, t.timezone)} → {s.out ? fmtTime(s.out, t.timezone) : <b className="text-emerald-600">now</b>}</span>
              <span className="text-xs text-muted-foreground">{s.mode}{s.out ? ` · ${fmtDur(Math.floor((s.out - s.in) / 60000))}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </CardContent></Card>
  );
}