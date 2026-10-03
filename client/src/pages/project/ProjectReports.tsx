import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject, useProjectResource } from "@/hooks/useProject";
import { attempt, downloadFromApi, fmtMinutes, taskStatusColor } from "@/lib/projectMeta";
import { ProjectReports as Reports } from "@/types";

const Stat = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
  <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</CardContent></Card>
);

function Bars({ data, colors }: { data: Record<string, number>; colors?: Record<string, string> }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="space-y-2">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{k}</span>
          <div className="h-3 flex-1 overflow-hidden rounded bg-secondary"><div className="h-full rounded" style={{ width: `${(v / max) * 100}%`, background: colors?.[k] || "hsl(var(--primary))" }} /></div>
          <span className="w-6 text-right text-xs">{v}</span>
        </div>
      ))}
      {!Object.keys(data).length && <p className="text-sm text-muted-foreground">No data yet.</p>}
    </div>
  );
}

function Burndown({ data }: { data: Reports["burndown"] }) {
  const W = 640, H = 200, P = 28;
  const max = Math.max(1, ...data.map((d) => Math.max(d.ideal, d.remaining ?? 0)));
  const x = (i: number) => P + (i / Math.max(data.length - 1, 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const actual = data.map((d, i) => (d.remaining == null ? null : `${x(i)},${y(d.remaining)}`)).filter(Boolean).join(" ");
  const ideal = data.map((d, i) => `${x(i)},${y(d.ideal)}`).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px]" role="img" aria-label="Burndown chart">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeOpacity={0.2} />
        <line x1={P} y1={P} x2={P} y2={H - P} stroke="currentColor" strokeOpacity={0.2} />
        <text x={4} y={P + 4} fontSize="10" fill="currentColor" fillOpacity={0.6}>{Math.round(max)}</text>
        <text x={4} y={H - P} fontSize="10" fill="currentColor" fillOpacity={0.6}>0</text>
        <text x={P} y={H - 8} fontSize="10" fill="currentColor" fillOpacity={0.6}>{data[0]?.date}</text>
        <text x={W - P} y={H - 8} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity={0.6}>{data[data.length - 1]?.date}</text>
        <polyline points={ideal} fill="none" stroke="#94A3B8" strokeDasharray="4 4" strokeWidth="2" />
        <polyline points={actual} fill="none" stroke="#6366F1" strokeWidth="2.5" />
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-muted-foreground"><span><span className="mr-1 inline-block h-0.5 w-4 bg-[#6366F1] align-middle" />Remaining</span><span><span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-400 align-middle" />Ideal</span></div>
    </div>
  );
}

export default function ProjectReports() {
  const { projectId, project } = useProject();
  const { data, isLoading } = useProjectResource<Reports>("reports", projectId);
  if (isLoading || !data) return <div className="p-6"><Skeleton className="h-64" /></div>;
  const { summary: s } = data;
  const trendMax = Math.max(1, ...data.trend.flatMap((t) => [t.created, t.completed]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h2 className="font-semibold">Project report</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => attempt(() => downloadFromApi(`/projects/${projectId}/export`, "tasks.csv"))}>Export CSV</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}>Print / Save as PDF</Button>
        </div>
      </div>
      <h1 className="hidden text-xl font-semibold print:block">{project?.name} · report</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Completion" value={`${s.completionRate}%`} sub={`${s.done}/${s.total} tasks`} />
        <Stat label="Overdue" value={s.overdue} />
        <Stat label="Avg. time to complete" value={`${s.avgCompletionDays}d`} />
        <Stat label="Estimated" value={fmtMinutes(s.estimatedMinutes)} />
        <Stat label="Logged" value={fmtMinutes(s.loggedMinutes)} sub={s.estimatedMinutes ? `${Math.round((s.loggedMinutes / s.estimatedMinutes) * 100)}% of estimate` : undefined} />
      </div>

      <Card><CardContent className="space-y-3 p-5"><h3 className="font-medium">Burndown</h3><Burndown data={data.burndown} /></CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardContent className="space-y-3 p-5"><h3 className="font-medium">Tasks by status</h3><Bars data={data.statusCounts} colors={taskStatusColor} /></CardContent></Card>
        <Card><CardContent className="space-y-3 p-5"><h3 className="font-medium">Tasks by priority</h3><Bars data={data.priorityCounts} colors={{ Low: "#94A3B8", Medium: "#3B82F6", High: "#F59E0B", Urgent: "#EF4444" }} /></CardContent></Card>
      </div>

      <Card><CardContent className="space-y-3 p-5">
        <h3 className="font-medium">Last 14 days: created vs completed</h3>
        <div className="flex h-32 items-end gap-1.5">
          {data.trend.map((t) => (
            <div key={t.date} className="flex flex-1 flex-col items-center gap-1" title={`${t.date}: ${t.created} created, ${t.completed} completed`}>
              <div className="flex h-24 w-full items-end gap-0.5">
                <div className="flex-1 rounded-t bg-indigo-400" style={{ height: `${(t.created / trendMax) * 100}%` }} />
                <div className="flex-1 rounded-t bg-emerald-500" style={{ height: `${(t.completed / trendMax) * 100}%` }} />
              </div>
              <span className="text-[9px] text-muted-foreground">{t.date.slice(8)}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground"><span><span className="mr-1 inline-block h-2 w-2 rounded bg-indigo-400" />Created</span><span><span className="mr-1 inline-block h-2 w-2 rounded bg-emerald-500" />Completed</span></div>
      </CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardContent className="p-5">
          <h3 className="mb-3 font-medium">Team workload</h3>
          {!data.workload.length && <p className="text-sm text-muted-foreground">No assigned tasks yet.</p>}
          <div className="space-y-3">
            {data.workload.map((w) => (
              <div key={w.user._id} className="text-sm">
                <div className="flex justify-between"><span className="font-medium">{w.user.name}</span><span className="text-xs text-muted-foreground">{w.open} open · {w.done} done{w.overdue ? ` · ${w.overdue} overdue` : ""}</span></div>
                <div className="mt-1 flex h-2 overflow-hidden rounded bg-secondary"><div className="bg-emerald-500" style={{ width: `${(w.done / Math.max(w.open + w.done, 1)) * 100}%` }} /><div className="bg-amber-500" style={{ width: `${(w.open / Math.max(w.open + w.done, 1)) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <h3 className="mb-3 font-medium">Time logged by person</h3>
          {!data.timeByUser.length && <p className="text-sm text-muted-foreground">No time logged yet.</p>}
          <div className="divide-y divide-border">
            {data.timeByUser.map((t) => (
              <div key={t._id} className="flex justify-between py-2 text-sm"><span>{t.name || "Unknown"}</span><span className="text-muted-foreground">{fmtMinutes(t.minutes)}{t.billable ? ` · ${fmtMinutes(t.billable)} billable` : ""}</span></div>
            ))}
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}