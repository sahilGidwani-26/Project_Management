import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileSpreadsheet, FileText, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { AttDay, AttEmployee } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt, downloadFromApi } from "@/lib/projectMeta";
import { dayKey, fmtDate, fmtDur, fmtTime, weekday } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { EditDayDialog } from "./EditDayDialog";
import { MonthNav, PersonCell, Stars, Stat, StatusBadge } from "./attendanceUi";

export function EmployeeDetail({
  workspaceId, userId, ym, setYm, tz, canManage, canExport, onBack,
}: { workspaceId: string; userId: string; ym: string; setYm: (v: string) => void; tz: string; canManage: boolean; canExport: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AttDay | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["att-emp", workspaceId, userId, ym],
    queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/employee/${userId}?month=${ym}`)).data.data as AttEmployee,
  });
  const current = dayKey(Date.now(), tz).slice(0, 7);
  const today = dayKey(Date.now(), tz);
  const dl = (format: "pdf" | "xlsx") => attempt(() => downloadFromApi(`/attendance/workspace/${workspaceId}/export?format=${format}&month=${ym}&userId=${userId}`, `attendance.${format}`));
  const refresh = () => ["att-emp", "att-team", "att-matrix", "att-live"].forEach((k) => qc.invalidateQueries({ queryKey: [k, workspaceId] }));

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !data) return <div className="space-y-3"><Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button><p className="text-sm text-destructive">Could not load this person.</p></div>;

  const s = data.summary;
  const days = data.days.filter((d) => d.status !== "na" && d.status !== "future");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Team</Button>
          <PersonCell p={data.person} />
          {data.person.exempt && <Badge variant="outline">Not tracked</Badge>}
        </div>
        <div className="flex gap-2">
          {canExport && <Button size="sm" variant="outline" onClick={() => dl("xlsx")}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>}
          {canExport && <Button size="sm" variant="outline" onClick={() => dl("pdf")}><FileText className="h-4 w-4" /> PDF</Button>}
        </div>
      </div>

      <MonthNav ym={ym} onChange={setYm} current={current} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Card className="lg:col-span-2"><CardContent className="flex items-center gap-3 p-4">
          <Stars value={data.rating.stars} size={20} />
          <div><p className="font-semibold">{data.rating.label}</p><p className="text-xs text-muted-foreground">{s.score == null ? "Not enough data" : `Score ${s.score} of 100`}</p></div>
        </CardContent></Card>
        <Stat label="Present" value={s.present} cls="text-emerald-600" sub={`of ${s.workingDays} days`} />
        <Stat label="Half days" value={s.halfDays} />
        <Stat label="Absent" value={s.absent} cls={s.absent ? "text-destructive" : ""} />
        <Stat label="Leave" value={s.paidLeave + s.unpaidLeave} />
        <Stat label="Late" value={s.late} cls={s.late ? "text-amber-600" : ""} />
        <Stat label="Attendance" value={s.attendanceRate == null ? "—" : `${s.attendanceRate}%`} />
        <Stat label="Punctuality" value={`${s.punctuality}%`} />
        <Stat label="Avg hours / day" value={s.avgMinutes ? fmtDur(s.avgMinutes) : "—"} />
        <Stat label="Total hours" value={fmtDur(s.workedMinutes)} sub={s.overtimeMinutes ? `overtime ${fmtDur(s.overtimeMinutes)}` : undefined} />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground">
            <tr>{["Date", "Status", "Check-in", "Check-out", "Hours", "Mode", "Note", ""].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!days.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nothing to show for this period yet.</td></tr>}
            {days.map((d) => {
              const quiet = d.status === "weekoff" || d.status === "holiday";
              return (
                <tr key={d.date} className={cn(quiet && "bg-secondary/20 text-muted-foreground")}>
                  <td className="px-4 py-2">{fmtDate(d.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={d.status} short={d.short} />
                      {d.late && d.firstIn != null && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">Late</span>}
                      {d.earlyLeave && <span className="rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:text-orange-300">Early</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2">{fmtTime(d.firstIn, tz)}</td>
                  <td className="px-4 py-2">{d.lastOut ? fmtTime(d.lastOut, tz) : "—"}</td>
                  <td className="px-4 py-2">{d.worked ? fmtDur(d.worked) : "—"}</td>
                  <td className="px-4 py-2 text-xs">{d.mode || "—"}</td>
                  <td className="max-w-[220px] truncate px-4 py-2 text-xs" title={d.manualNote || d.holiday || ""}>
                    {d.holiday || d.leave?.map((l) => l.name).join(", ") || (d.manualNote ? `Corrected: ${d.manualNote}` : "")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canManage && !quiet && <Button size="icon" variant="ghost" className="h-7 w-7" title="Correct this day" onClick={() => setEditing(d)}><Pencil className="h-3.5 w-3.5" /></Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {!!data.leaveRequests.length && (
        <Card><CardContent className="space-y-2 p-5">
          <h3 className="font-medium">Leave in this period</h3>
          <div className="divide-y divide-border">
            {data.leaveRequests.map((l) => (
              <div key={l._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: l.typeId?.color || "#64748B" }} />{l.typeId?.name || "Leave"} · {l.from === l.to ? fmtDate(l.from) : `${fmtDate(l.from)} to ${fmtDate(l.to)}`}</span>
                <span className="text-xs text-muted-foreground">{l.days} day(s) · {l.status}</span>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      {editing && (
        <EditDayDialog open onOpenChange={(v) => !v && setEditing(null)} workspaceId={workspaceId} person={{ userId, name: data.person.name }} day={editing} tz={tz} today={today} onSaved={refresh} />
      )}
    </div>
  );
}