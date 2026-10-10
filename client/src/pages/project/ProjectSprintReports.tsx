import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CycleStatsData, FlowReport, FlowRow, ReportUnit, SprintDetail, SprintOverview, SprintReportRow } from "@/types";
import { useProject } from "@/hooks/useProject";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { taskStatusColor } from "@/lib/projectMeta";
import { cn, formatDate } from "@/lib/utils";

const typeIcon: Record<string, string> = { Bug: "🐛", Feature: "✨", Improvement: "⚡", Task: "🔧" };
const fmt = (n?: number | null) => (n == null ? "—" : String(Math.round(n * 10) / 10));
const short = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

const Stat = ({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) => (
  <Card><CardContent className="p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
  </CardContent></Card>
);

const Help = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

/* ------------------------------ velocity chart ------------------------------ */

function VelocityChart({ sprints, average, unit }: { sprints: SprintReportRow[]; average: number | null; unit: string }) {
  const n = sprints.length;
  const W = Math.max(480, n * 84 + 60), H = 230, P = 34;
  const max = Math.max(1, ...sprints.flatMap((s) => [s.committed ?? 0, s.completed]));
  const gw = (W - P * 2) / n;
  const bw = Math.min(24, gw / 3);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: Math.min(W, 480), width: "100%" }} role="img" aria-label="Velocity chart">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeOpacity={0.2} />
        <text x={4} y={P} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmt(max)} {unit}</text>
        {average != null && (
          <>
            <line x1={P} x2={W - P} y1={y(average)} y2={y(average)} stroke="#F59E0B" strokeDasharray="5 4" />
            <text x={W - P} y={y(average) - 4} fontSize="10" textAnchor="end" fill="#F59E0B">avg of last 3 completed: {fmt(average)}</text>
          </>
        )}
        {sprints.map((s, i) => {
          const cx = P + gw * i + gw / 2;
          const c = s.committed ?? 0;
          return (
            <g key={s._id}>
              <title>{`${s.name}: committed ${fmt(s.committed)}, completed ${fmt(s.completed)}`}</title>
              <rect x={cx - bw - 1} y={y(c)} width={bw} height={H - P - y(c)} fill="currentColor" fillOpacity={0.2} rx={2} />
              <rect x={cx + 1} y={y(s.completed)} width={bw} height={H - P - y(s.completed)} fill={s.status === "Active" ? "#94A3B8" : "#6366F1"} rx={2} />
              <text x={cx + 1 + bw / 2} y={y(s.completed) - 4} fontSize="10" textAnchor="middle" fill="currentColor">{fmt(s.completed)}</text>
              <text x={cx} y={H - P + 14} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity={0.7}>{s.name.length > 11 ? s.name.slice(0, 10) + "…" : s.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-2 w-3 rounded bg-current opacity-20 align-middle" />Committed at start</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded bg-[#6366F1] align-middle" />Completed</span>
        <span><span className="mr-1 inline-block h-2 w-3 rounded bg-slate-400 align-middle" />Still running</span>
      </div>
    </div>
  );
}

/* ----------------------------- burndown chart ----------------------------- */

function BurndownChart({ data }: { data: NonNullable<SprintDetail["burndown"]> }) {
  const W = 680, H = 230, P = 32;
  if (data.length < 2) return <p className="text-sm text-muted-foreground">Not enough days yet.</p>;
  const max = Math.max(1, ...data.flatMap((d) => [d.ideal, d.remaining ?? 0, d.scope ?? 0]));
  const x = (i: number) => P + (i / (data.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const line = (pick: (d: (typeof data)[number]) => number | null) =>
    data.map((d, i) => (pick(d) == null ? null : `${x(i)},${y(pick(d) as number)}`)).filter(Boolean).join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 520, width: "100%" }} role="img" aria-label="Burndown chart">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeOpacity={0.2} />
        <line x1={P} y1={P} x2={P} y2={H - P} stroke="currentColor" strokeOpacity={0.2} />
        <text x={4} y={P + 4} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmt(max)}</text>
        <text x={4} y={H - P} fontSize="10" fill="currentColor" fillOpacity={0.6}>0</text>
        <text x={P} y={H - 10} fontSize="10" fill="currentColor" fillOpacity={0.6}>{short(data[0].date)}</text>
        <text x={W - P} y={H - 10} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity={0.6}>{short(data[data.length - 1].date)}</text>
        <polyline points={line((d) => d.ideal)} fill="none" stroke="#94A3B8" strokeDasharray="5 4" strokeWidth="2" />
        <polyline points={line((d) => d.scope)} fill="none" stroke="#38BDF8" strokeWidth="1.5" strokeOpacity={0.9} />
        <polyline points={line((d) => d.remaining)} fill="none" stroke="#6366F1" strokeWidth="2.5" />
        {data.map((d, i) => d.remaining != null && <circle key={d.date} cx={x(i)} cy={y(d.remaining)} r={3} fill="#6366F1"><title>{`${short(d.date)}: ${fmt(d.remaining)} left of ${fmt(d.scope)}`}</title></circle>)}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-[#6366F1] align-middle" />Remaining work</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-400 align-middle" />Ideal</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-[#38BDF8] align-middle" />Total scope</span>
      </div>
    </div>
  );
}

/* ------------------------ cumulative flow (stacked area) ------------------------ */

const STACK = ["Done", "In Review", "In Progress", "Todo", "Backlog"];

function FlowChart({ rows }: { rows: FlowRow[] }) {
  const W = 680, H = 250, P = 32;
  const n = rows.length;
  if (n < 2) return <p className="text-sm text-muted-foreground">Not enough days of data yet. Come back tomorrow.</p>;
  const totals = rows.map((r) => STACK.reduce((a, s) => a + (r[s] as number), 0));
  const max = Math.max(1, ...totals);
  const x = (i: number) => P + (i / (n - 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  let lower: number[] = new Array(n).fill(0);
  const paths = STACK.map((s) => {
    const upper = lower.map((l, i) => l + (rows[i][s] as number));
    const top = upper.map((v, i) => `${x(i)},${y(v)}`);
    const bottom = lower.map((v, i) => `${x(i)},${y(v)}`).reverse();
    lower = upper;
    return { s, d: `M${top.join(" L")} L${bottom.join(" L")} Z` };
  });
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 520, width: "100%" }} role="img" aria-label="Cumulative flow diagram">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeOpacity={0.2} />
        <text x={4} y={P + 4} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmt(max)}</text>
        <text x={P} y={H - 10} fontSize="10" fill="currentColor" fillOpacity={0.6}>{short(rows[0].date as string)}</text>
        <text x={W - P} y={H - 10} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity={0.6}>{short(rows[n - 1].date as string)}</text>
        {paths.map((p) => <path key={p.s} d={p.d} fill={taskStatusColor[p.s]} fillOpacity={0.85}><title>{p.s}</title></path>)}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {STACK.map((s) => <span key={s}><span className="mr-1 inline-block h-2 w-3 rounded align-middle" style={{ background: taskStatusColor[s] }} />{s}</span>)}
      </div>
    </div>
  );
}

/* -------------------------------- cycle time -------------------------------- */

function CycleSection({ cycle }: { cycle: CycleStatsData }) {
  const items = cycle.items.filter((i) => i.cycleDays != null);
  const hMax = Math.max(1, ...cycle.histogram.map((h) => h.count));
  const W = 640, H = 200, P = 30;
  const xs = items.map((i) => i.doneAt);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const yMax = Math.max(1, ...items.map((i) => i.cycleDays as number), cycle.cycle.p85 ?? 0);
  const x = (t: number) => P + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - P * 2);
  const y = (v: number) => H - P - (v / yMax) * (H - P * 2);
  const tMax = Math.max(1, ...Object.values(cycle.timeInStatus).map((v) => v ?? 0));

  if (!cycle.cycle.count && !cycle.lead.count) {
    return <p className="text-sm text-muted-foreground">No finished tasks yet. Move a task to <b>In Progress</b> and then <b>Done</b> and cycle time appears here.</p>;
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Cycle time (average)" value={`${fmt(cycle.cycle.avg)}d`} sub={`${cycle.cycle.count} tasks`} />
        <Stat label="Cycle time (median)" value={`${fmt(cycle.cycle.median)}d`} sub="half of the tasks are faster" />
        <Stat label="85% finish within" value={`${fmt(cycle.cycle.p85)}d`} sub="safe number for promises" />
        <Stat label="Lead time (average)" value={`${fmt(cycle.lead.avg)}d`} sub="created → done" />
        <Stat label="Finished tasks" value={String(cycle.lead.count)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-sm font-medium">How long tasks take</h4>
          {cycle.histogram.map((h) => (
            <div key={h.label} className="flex items-center gap-3 text-xs">
              <span className="w-12 shrink-0 text-muted-foreground">{h.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded bg-secondary"><div className="h-full rounded bg-indigo-500" style={{ width: `${(h.count / hMax) * 100}%` }} /></div>
              <span className="w-6 text-right">{h.count}</span>
            </div>
          ))}
          <Help>Each bar counts finished tasks by days from <b>In Progress</b> to <b>Done</b>. A long tail on the right means a few tasks get stuck.</Help>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">Where tasks wait (average days in each status)</h4>
          {Object.entries(cycle.timeInStatus).map(([s, v]) => (
            <div key={s} className="flex items-center gap-3 text-xs">
              <span className="w-24 shrink-0 text-muted-foreground">{s}</span>
              <div className="h-3 flex-1 overflow-hidden rounded bg-secondary"><div className="h-full rounded" style={{ width: `${((v ?? 0) / tMax) * 100}%`, background: taskStatusColor[s] }} /></div>
              <span className="w-12 text-right">{v == null ? "—" : `${fmt(v)}d`}</span>
            </div>
          ))}
          <Help>The longest bar is your bottleneck. For example a long <b>In Review</b> means work waits for a reviewer.</Help>
        </div>
      </div>

      {!!items.length && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Each finished task</h4>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 480, width: "100%" }} role="img" aria-label="Cycle time scatter plot">
              <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="currentColor" strokeOpacity={0.2} />
              <text x={4} y={P} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmt(yMax)}d</text>
              <text x={P} y={H - 10} fontSize="10" fill="currentColor" fillOpacity={0.6}>{new Date(x0).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>
              <text x={W - P} y={H - 10} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity={0.6}>{new Date(x1).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</text>
              {cycle.cycle.median != null && <line x1={P} x2={W - P} y1={y(cycle.cycle.median)} y2={y(cycle.cycle.median)} stroke="#10B981" strokeDasharray="4 4" />}
              {cycle.cycle.p85 != null && <line x1={P} x2={W - P} y1={y(cycle.cycle.p85)} y2={y(cycle.cycle.p85)} stroke="#EF4444" strokeDasharray="4 4" />}
              {items.map((i) => <circle key={i._id} cx={x(i.doneAt)} cy={y(i.cycleDays as number)} r={4} fill="#6366F1" fillOpacity={0.75}><title>{`TASK-${i.taskNumber} ${i.title}: ${fmt(i.cycleDays)} days`}</title></circle>)}
            </svg>
          </div>
          <Help><span className="text-emerald-600">Green line</span> = median, <span className="text-red-500">red line</span> = 85th percentile. Dots high above the red line are the tasks worth reviewing in your retro.</Help>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- page ----------------------------------- */

const LISTS: ["committed" | "added" | "removed" | "completed" | "carriedOver", string][] = [
  ["committed", "Committed"], ["added", "Added later"], ["removed", "Removed"], ["completed", "Completed"], ["carriedOver", "Carried over"],
];

export default function ProjectSprintReports() {
  const { projectId } = useProject();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<"sprint" | "flow">("sprint");
  const [unit, setUnit] = useState<ReportUnit>("tasks");
  const [days, setDays] = useState(30);
  const [list, setList] = useState<(typeof LISTS)[number][0]>("completed");
  const u = unit === "hours" ? "h" : "tasks";

  const overview = useQuery({
    queryKey: ["sprint-reports", projectId, unit],
    queryFn: async () => (await api.get(`/projects/${projectId}/sprint-reports?unit=${unit}`)).data.data as SprintOverview,
    enabled: !!projectId,
  });
  const sprints = overview.data?.sprints || [];
  const sprintId = params.get("sprint") || overview.data?.activeSprintId || sprints[sprints.length - 1]?._id;

  const detail = useQuery({
    queryKey: ["sprint-report", projectId, sprintId, unit],
    queryFn: async () => (await api.get(`/projects/${projectId}/sprint-reports/sprints/${sprintId}?unit=${unit}`)).data.data as SprintDetail,
    enabled: !!projectId && !!sprintId && mode === "sprint",
  });

  const flow = useQuery({
    queryKey: ["flow-report", projectId, days, unit],
    queryFn: async () => (await api.get(`/projects/${projectId}/sprint-reports/flow?days=${days}&unit=${unit}`)).data.data as FlowReport,
    enabled: !!projectId && mode === "flow",
  });

  const est = (mode === "sprint" ? detail.data?.estimates || overview.data?.estimates : flow.data?.estimates);
  const estWarning = unit === "hours" && est && est.withEstimate < est.tasks;
  const d = detail.data;
  const s = d?.summary;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-border p-0.5">
          {([["sprint", "Sprint reports"], ["flow", "Flow & cycle time"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} className={cn("rounded px-3 py-1 text-sm font-medium", mode === v ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Measure in</span>
          <div className="flex rounded-md border border-border p-0.5">
            {([["tasks", "Tasks"], ["hours", "Hours"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setUnit(v)} className={cn("rounded px-3 py-1 text-xs font-medium", unit === v ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {estWarning && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Hours use each task's estimate. Only <b>{est!.withEstimate} of {est!.tasks}</b> tasks have one, so the totals can look low. Add estimates to tasks for accurate hours.
        </p>
      )}

      {/* ===================== SPRINT MODE ===================== */}
      {mode === "sprint" && (
        <>
          {overview.isLoading && <Skeleton className="h-64" />}
          {!overview.isLoading && !sprints.length && (
            <p className="text-sm text-muted-foreground">No sprint has been started yet. Start a sprint in the <b>Sprints</b> tab and its report appears here.</p>
          )}

          {!!sprints.length && (
            <Card><CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Velocity</h3>
                {overview.data!.velocity.average3 != null && (
                  <p className="text-sm">
                    Last 3 completed sprints average <b>{fmt(overview.data!.velocity.average3)} {u}</b>. A realistic plan for the next sprint is about <b>{fmt(overview.data!.velocity.average3)} {u}</b>.
                  </p>
                )}
              </div>
              <VelocityChart sprints={sprints} average={overview.data!.velocity.average3} unit={u} />
              <Help><b>Velocity</b> is how much work your team really finishes in one sprint. Use it to plan the next sprint with a number you have actually achieved, instead of guessing.</Help>
            </CardContent></Card>
          )}

          {!!sprints.length && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-medium">Sprint report</h3>
                <Select value={sprintId} onValueChange={(v) => setParams({ sprint: v }, { replace: true })}>
                  <SelectTrigger className="w-72"><SelectValue placeholder="Choose a sprint" /></SelectTrigger>
                  <SelectContent>
                    {[...sprints].reverse().map((sp) => <SelectItem key={sp._id} value={sp._id}>{sp.name} · {sp.status}</SelectItem>)}
                  </SelectContent>
                </Select>
                {d && !d.planned && <span className="text-xs text-muted-foreground">{d.sprint.startDate ? formatDate(d.sprint.startDate) : "…"} → {d.sprint.endDate ? formatDate(d.sprint.endDate) : "…"}{d.sprint.goal ? ` · Goal: ${d.sprint.goal}` : ""}</span>}
              </div>

              {detail.isLoading && <Skeleton className="h-64" />}
              {d?.planned && <p className="text-sm text-muted-foreground">This sprint has not started yet ({d.taskCount ?? 0} task(s) planned). Its report begins once you start it.</p>}

              {d && !d.planned && s && (
                <>
                  {s.legacy && <p className="text-xs text-muted-foreground">This sprint started before scope tracking existed, so “added / removed” are unknown. Sprints started from now on are tracked exactly.</p>}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                    <Stat label="Committed" value={fmt(s.committed)} sub={`${u} at the start`} />
                    <Stat label="Added later" value={fmt(s.added)} cls={s.added ? "text-amber-600" : ""} sub="scope creep" />
                    <Stat label="Removed" value={fmt(s.removed)} />
                    <Stat label="Completed" value={fmt(s.completed)} cls="text-emerald-600" />
                    <Stat label="Carried over" value={fmt(s.carriedOver)} sub={d.sprint.status === "Completed" ? "moved on" : "not done yet"} />
                    <Stat label="Completion" value={s.completionRate == null ? "—" : `${s.completionRate}%`} sub="of all work in the sprint" />
                    <Stat label="Commitment kept" value={s.commitmentRate == null ? "—" : `${s.commitmentRate}%`} sub="of what was promised" />
                  </div>

                  <Card><CardContent className="space-y-3 p-5">
                    <h4 className="font-medium">Burndown</h4>
                    <BurndownChart data={d.burndown || []} />
                    <Help>The purple line is the work still left. If it stays <b>above the dashed line</b> you are behind plan. If the blue scope line climbs, new work was added during the sprint.</Help>
                  </CardContent></Card>

                  {s.lists && (
                    <Card><CardContent className="space-y-3 p-5">
                      <h4 className="font-medium">Tasks</h4>
                      <div className="flex flex-wrap gap-1">
                        {LISTS.map(([k, label]) => (
                          <button key={k} onClick={() => setList(k)} className={cn("rounded-full border px-3 py-1 text-xs", list === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                            {label} ({s.lists![k].length})
                          </button>
                        ))}
                      </div>
                      {!s.lists[list].length && <p className="text-sm text-muted-foreground">Nothing here.</p>}
                      <div className="divide-y divide-border rounded-md border border-border">
                        {s.lists[list].map((t) => (
                          <div key={t._id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                            <span className="min-w-0 truncate"><span className="mr-1.5">{typeIcon[t.type] || "🔧"}</span><span className="mr-2 font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>{t.title}</span>
                            <span className="flex shrink-0 items-center gap-2">{unit === "hours" && <span className="text-xs text-muted-foreground">{fmt(t.weight)}h</span>}<StatusBadge status={t.status} /></span>
                          </div>
                        ))}
                      </div>
                    </CardContent></Card>
                  )}

                  <Card><CardContent className="space-y-3 p-5">
                    <h4 className="font-medium">Cumulative flow</h4>
                    <FlowChart rows={d.flow || []} />
                    <Help>Each coloured band is the number of tasks in that status on that day. Healthy: bands stay <b>parallel</b> and <b>Done</b> keeps growing. A band that keeps getting wider is a bottleneck.</Help>
                  </CardContent></Card>

                  <Card><CardContent className="space-y-3 p-5">
                    <h4 className="font-medium">Cycle time (this sprint's finished tasks)</h4>
                    {d.cycle && <CycleSection cycle={d.cycle} />}
                  </CardContent></Card>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* ===================== FLOW MODE ===================== */}
      {mode === "flow" && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Last</span>
            <div className="flex rounded-md border border-border p-0.5">
              {[14, 30, 60, 90].map((n) => (
                <button key={n} onClick={() => setDays(n)} className={cn("rounded px-3 py-1 text-xs font-medium", days === n ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{n} days</button>
              ))}
            </div>
          </div>
          {flow.isLoading && <Skeleton className="h-64" />}
          {flow.data && (
            <>
              <Card><CardContent className="space-y-3 p-5">
                <h4 className="font-medium">Cumulative flow (whole project)</h4>
                <FlowChart rows={flow.data.flow} />
                <Help>Shows how work moves through your statuses over time. The vertical gap of a band is the work waiting in that status (work in progress). Wider bands mean more work piling up there.</Help>
              </CardContent></Card>
              <Card><CardContent className="space-y-3 p-5">
                <h4 className="font-medium">Cycle time (tasks finished in the last {days} days)</h4>
                <CycleSection cycle={flow.data.cycle} />
              </CardContent></Card>
            </>
          )}
        </>
      )}
    </div>
  );
}