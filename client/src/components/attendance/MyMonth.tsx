import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, FileSpreadsheet, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { AttMonth } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt, downloadFromApi } from "@/lib/projectMeta";
import { DAYS, STATUS, dayKey, fmtDate, fmtDur, fmtTime, weekday } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { MonthNav, Stars, Stat, StatusBadge } from "./attendanceUi";

export function MyMonth({ workspaceId, ym, setYm, tz }: { workspaceId: string; ym: string; setYm: (v: string) => void; tz: string }) {
  const { user } = useAuth();
  const [sel, setSel] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["att-me", workspaceId, ym],
    queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/me?month=${ym}`)).data.data as AttMonth,
  });
  const current = dayKey(Date.now(), tz).slice(0, 7);
  const dl = (format: "pdf" | "xlsx") =>
    attempt(() => downloadFromApi(`/attendance/workspace/${workspaceId}/export?format=${format}&month=${ym}&userId=${user?._id}`, `attendance.${format}`));

  if (isLoading || !data) return <Skeleton className="h-96" />;

  const s = data.summary;
  const lead = weekday(data.days[0].date);
  const selected = data.days.find((d) => d.date === sel);
  const bars = [
    ["Attendance", s.attendanceRate ?? 0, "60% of the score"],
    ["Punctuality", s.punctuality, "25% of the score"],
    ["Hours completed", s.hoursScore, "15% of the score"],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav ym={ym} onChange={(v) => { setSel(null); setYm(v); }} current={current} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => dl("xlsx")}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          <Button size="sm" variant="outline" onClick={() => dl("pdf")}><FileText className="h-4 w-4" /> PDF</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Present" value={s.present} cls="text-emerald-600" sub={`of ${s.workingDays} working days`} />
        <Stat label="Half days" value={s.halfDays} />
        <Stat label="Absent" value={s.absent} cls={s.absent ? "text-destructive" : ""} />
        <Stat label="Leave" value={s.paidLeave + s.unpaidLeave} sub={s.unpaidLeave ? `${s.unpaidLeave} unpaid` : undefined} />
        <Stat label="Late" value={s.late} cls={s.late ? "text-amber-600" : ""} />
        <Stat label="Avg hours / day" value={s.avgMinutes ? fmtDur(s.avgMinutes) : "—"} sub={`total ${fmtDur(s.workedMinutes)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* calendar */}
        <Card className="lg:col-span-2"><CardContent className="space-y-3 p-5">
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">{DAYS.map((d) => <div key={d}>{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
            {data.days.map((d) => {
              const m = STATUS[d.status];
              const off = d.status === "future" || d.status === "na";
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={off}
                  onClick={() => setSel(d.date)}
                  title={d.holiday || m?.label}
                  className={cn(
                    "flex min-h-[64px] flex-col items-start rounded-md border p-1.5 text-left text-[11px] transition",
                    off ? "border-transparent opacity-40" : "border-border hover:border-primary",
                    sel === d.date && "ring-2 ring-primary"
                  )}
                >
                  <span className="font-medium">{Number(d.date.slice(8))}</span>
                  {m && !off && <span className={cn("mt-0.5 rounded px-1 text-[10px] leading-4", m.cls)}>{m.label}</span>}
                  {d.firstIn && <span className="mt-auto text-[10px] text-muted-foreground">{fmtTime(d.firstIn, tz)}{d.late ? " · late" : ""}</span>}
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="space-y-1 rounded-md border border-border p-3 text-sm">
              <div className="flex items-center justify-between">
                <b>{fmtDate(selected.date, { weekday: "long", day: "numeric", month: "long" })}</b>
                <StatusBadge status={selected.status} short={selected.short} />
              </div>
              {selected.holiday && <p className="text-muted-foreground">Holiday: {selected.holiday}</p>}
              {selected.leave?.map((l, i) => <p key={i} className="text-muted-foreground">{l.name}{l.half !== "none" ? " (half day)" : ""}</p>)}
              {selected.sessions.map((x, i) => (
                <p key={i}>{fmtTime(x.in, tz)} → {x.out ? fmtTime(x.out, tz) : "no check-out"} <span className="text-xs text-muted-foreground">· {x.mode}</span></p>
              ))}
              {selected.worked > 0 && <p className="text-muted-foreground">Worked {fmtDur(selected.worked)}{selected.overtime ? ` · overtime ${fmtDur(selected.overtime)}` : ""}</p>}
              {selected.manualNote && <p className="rounded bg-secondary px-2 py-1 text-xs">Corrected by an admin: {selected.manualNote}</p>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Tap a day to see its check-in and check-out times.</p>
          )}
        </CardContent></Card>

        <div className="space-y-6">
          {/* rating */}
          <Card><CardContent className="space-y-3 p-5">
            <h3 className="font-medium">Your rating this month</h3>
            <div className="flex items-center gap-3">
              <Stars value={data.rating.stars} size={22} />
              <div>
                <p className="font-semibold">{data.rating.label}</p>
                <p className="text-xs text-muted-foreground">{s.score == null ? "Needs at least one working day" : `Score ${s.score} out of 100`}</p>
              </div>
            </div>
            <div className="space-y-2">
              {bars.map(([label, v, w]) => (
                <div key={label}>
                  <div className="flex justify-between text-xs"><span>{label}</span><span className="text-muted-foreground">{v}% · {w}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${Math.min(100, v)}%` }} /></div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Approved paid leave and holidays never lower your rating.</p>
          </CardContent></Card>

          {/* leave balance */}
          <Card><CardContent className="space-y-3 p-5">
            <h3 className="font-medium">Leave balance (this year)</h3>
            {!data.leaveBalances.length && <p className="text-sm text-muted-foreground">No leave types yet.</p>}
            {data.leaveBalances.map((b) => (
              <div key={b.typeId}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: b.color }} />{b.name}</span>
                  <span className="text-xs text-muted-foreground">{b.quota > 0 ? `${b.used} used · ${b.remaining} left of ${b.quota}` : `${b.used} used · no limit`}</span>
                </div>
                {b.quota > 0 && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full" style={{ width: `${Math.min(100, ((b.used + b.pending) / b.quota) * 100)}%`, background: b.color }} />
                  </div>
                )}
                {b.pending > 0 && <p className="text-[11px] text-amber-600">{b.pending} day(s) waiting for approval</p>}
              </div>
            ))}
          </CardContent></Card>

          {/* holidays */}
          <Card><CardContent className="space-y-2 p-5">
            <h3 className="flex items-center gap-2 font-medium"><CalendarDays className="h-4 w-4" /> Upcoming holidays</h3>
            {!data.upcomingHolidays.length && <p className="text-sm text-muted-foreground">No holiday is marked ahead.</p>}
            {data.upcomingHolidays.map((h) => (
              <div key={h.date} className="flex justify-between text-sm"><span>{h.name}</span><span className="text-muted-foreground">{fmtDate(h.date, { weekday: "short", day: "numeric", month: "short" })}</span></div>
            ))}
          </CardContent></Card>
        </div>
      </div>
    </div>
  );
}