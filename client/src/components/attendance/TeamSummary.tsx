import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FileSpreadsheet, FileText } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { AttTeam, AttTeamRow } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { attempt, downloadFromApi } from "@/lib/projectMeta";
import { dayKey, fmtDur } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { MonthNav, PersonCell, Stars, Stat } from "./attendanceUi";

type SortKey = "name" | "score" | "attendance" | "late" | "absent" | "hours";

const STAR_COLORS: Record<number, string> = { 5: "#16A34A", 4: "#65A30D", 3: "#CA8A04", 2: "#EA580C", 1: "#DC2626" };
const val = (r: AttTeamRow, k: SortKey) =>
  k === "name" ? r.name.toLowerCase()
  : k === "score" ? r.summary.score ?? -1
  : k === "attendance" ? r.summary.attendanceRate ?? -1
  : k === "late" ? r.summary.late
  : k === "absent" ? r.summary.absent
  : r.summary.avgMinutes;

export function TeamSummary({
  workspaceId, ym, setYm, tz, canExport, onOpen,
}: { workspaceId: string; ym: string; setYm: (v: string) => void; tz: string; canExport: boolean; onOpen: (userId: string) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const { data, isLoading } = useQuery({
    queryKey: ["att-team", workspaceId, ym],
    queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/team?month=${ym}`)).data.data as AttTeam,
  });

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase();
    const list = (data?.rows || []).filter((r) => !text || r.name.toLowerCase().includes(text) || r.email.toLowerCase().includes(text));
    return [...list].sort((a, b) => {
      const x = val(a, sort.key), y = val(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [data, q, sort]);

  const current = dayKey(Date.now(), tz).slice(0, 7);
  const dl = (format: "pdf" | "xlsx") => attempt(() => downloadFromApi(`/attendance/workspace/${workspaceId}/export?format=${format}&month=${ym}`, `attendance.${format}`));
  const head = (key: SortKey, label: string, right = true) => (
    <th className={cn("px-3 py-2.5 font-medium", right ? "text-right" : "text-left")}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  if (isLoading || !data) return <Skeleton className="h-96" />;
  const o = data.overall;
  const chart = o.ratingSpread.map((r) => ({ name: `${r.stars} star`, count: r.count, stars: r.stars }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav ym={ym} onChange={setYm} current={current} />
        {canExport && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => dl("xlsx")}><FileSpreadsheet className="h-4 w-4" /> Excel (everyone)</Button>
            <Button size="sm" variant="outline" onClick={() => dl("pdf")}><FileText className="h-4 w-4" /> PDF (everyone)</Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Average score" value={o.avgScore ?? "—"} sub={`${o.people} people`} />
        <Stat label="Average attendance" value={o.avgAttendance == null ? "—" : `${o.avgAttendance}%`} />
        <Stat label="Average punctuality" value={o.avgPunctuality == null ? "—" : `${o.avgPunctuality}%`} />
        <Stat label="Total hours worked" value={`${o.totalHours}h`} />
        <Stat label="Late check-ins" value={o.totalLate} cls={o.totalLate ? "text-amber-600" : ""} />
        <Stat label="Absent days" value={o.totalAbsent} cls={o.totalAbsent ? "text-destructive" : ""} />
        <Stat label="Leave days taken" value={o.totalLeaveDays} />
      </div>

      <Card><CardContent className="space-y-3 p-5">
        <div>
          <h3 className="font-medium">Ratings this month</h3>
          <p className="text-xs text-muted-foreground">How many people fall in each star group. Score = 60% attendance + 25% punctuality + 15% hours completed.</p>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v} ${v === 1 ? "person" : "people"}`, ""]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>{chart.map((c) => <Cell key={c.stars} fill={STAR_COLORS[c.stars]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent></Card>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Everyone</h3>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person…" className="max-w-xs" />
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>
                {head("name", "Person", false)}
                <th className="px-3 py-2.5 text-right font-medium">Present</th>
                <th className="px-3 py-2.5 text-right font-medium">Half</th>
                {head("absent", "Absent")}
                <th className="px-3 py-2.5 text-right font-medium">Leave</th>
                {head("late", "Late")}
                {head("hours", "Avg hours")}
                {head("attendance", "Attendance")}
                {head("score", "Rating")}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!rows.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No one matches.</td></tr>}
              {rows.map((r) => (
                <tr key={r.userId} className="cursor-pointer hover:bg-secondary/30" onClick={() => onOpen(r.userId)}>
                  <td className="px-3 py-2.5"><PersonCell p={r} /></td>
                  <td className="px-3 py-2.5 text-right">{r.summary.present}</td>
                  <td className="px-3 py-2.5 text-right">{r.summary.halfDays}</td>
                  <td className={cn("px-3 py-2.5 text-right", r.summary.absent && "font-medium text-destructive")}>{r.summary.absent}</td>
                  <td className="px-3 py-2.5 text-right">{r.summary.paidLeave + r.summary.unpaidLeave}</td>
                  <td className={cn("px-3 py-2.5 text-right", r.summary.late && "text-amber-600")}>{r.summary.late}</td>
                  <td className="px-3 py-2.5 text-right">{r.summary.avgMinutes ? fmtDur(r.summary.avgMinutes) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{r.summary.attendanceRate == null ? "—" : `${r.summary.attendanceRate}%`}</td>
                  <td className="px-3 py-2.5 text-right" title={r.rating.label}><span className="inline-flex items-center justify-end gap-2"><Stars value={r.rating.stars} size={13} /><span className="w-6 text-xs text-muted-foreground">{r.summary.score ?? ""}</span></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-muted-foreground">Click a person to see every day, correct a record or download their own report. Approved paid leave and holidays do not lower anyone's rating.</p>
      </div>
    </div>
  );
}