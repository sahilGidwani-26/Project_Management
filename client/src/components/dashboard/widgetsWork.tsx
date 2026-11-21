import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, Bug, CheckCircle2, FolderKanban, ListChecks, Target, TrendingUp, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { timeAgo } from "@/lib/projectMeta";
import { cn, initials } from "@/lib/utils";
import type { WidgetProps } from "./dashTypes";
import { ChartEmpty, Donut, Kpi, Panel, PRIORITY_COLORS, SEVERITY_COLORS, STATUS_COLORS, WSkel, colorFor, projectStatusColor, shortDate, tip } from "./widgetUi";

const base = (w: string) => `/app/${w}`;
const dueText = (d: string | null) => {
  if (!d) return { t: "No due date", cls: "text-muted-foreground" };
  const left = Math.ceil((+new Date(d) - Date.now()) / 864e5);
  if (left < 0) return { t: `${-left}d overdue`, cls: "text-red-600 dark:text-red-400 font-medium" };
  if (left === 0) return { t: "Due today", cls: "text-amber-600 dark:text-amber-400 font-medium" };
  return { t: `${left}d left`, cls: left <= 3 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground" };
};
const axis = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } } as const;

/* --------------------------------- numbers --------------------------------- */

export function KpiProjects({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel h="h-24" />;
  return <Kpi icon={FolderKanban} label="Active projects" value={ov.stats.activeProjects ?? 0} sub={`of ${ov.stats.projects ?? 0} in total`} to={`${base(workspaceId)}/projects`} />;
}

export function KpiMyOpen({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel h="h-24" />;
  return <Kpi icon={ListChecks} tone="blue" label="My open tasks" value={ov.stats.myOpen} sub={`${ov.stats.myDueWeek} due in the next 7 days`} spark={ov.trend.map((t) => t.created)} sparkColor="#3B82F6" to={`${base(workspaceId)}/my-tasks`} />;
}

export function KpiOverdue({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel h="h-24" />;
  const s = ov.stats;
  return <Kpi icon={AlertTriangle} tone={s.overdue ? "red" : "green"} label="Overdue tasks" value={s.overdue} sub={s.overdue ? `${s.myOverdue} of them are yours` : "Nothing is late. Nice."} to={`${base(workspaceId)}/tasks`} />;
}

export function KpiCompleted({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel h="h-24" />;
  const { completed7: c, completedPrev7: p } = ov.stats;
  const pct = p ? Math.round(((c - p) / p) * 100) : c ? 100 : 0;
  return <Kpi icon={CheckCircle2} tone="green" label="Done in 7 days" value={c} delta={{ pct, goodWhenUp: true }} sub={`${p} the week before`} spark={ov.trend.map((t) => t.completed)} sparkColor="#10B981" to={`${base(workspaceId)}/tasks`} />;
}

export function KpiTeam({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel h="h-24" />;
  return <Kpi icon={Users} tone="violet" label="Team members" value={ov.stats.members ?? 0} sub="active in this workspace" to={`${base(workspaceId)}/team`} />;
}

/* ---------------------------------- charts ---------------------------------- */

export function TasksByStatus({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  const data = ov.byStatus.map((s, i) => ({ name: s.status, value: s.count, fill: colorFor(STATUS_COLORS, s.status, i) }));
  return (
    <Panel title="Tasks by status" icon={ListChecks} action={{ to: `${base(workspaceId)}/tasks`, label: "All tasks" }}>
      <div className="h-56">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 30, left: 0, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={88} {...axis} tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={tip} cursor={{ fill: "hsl(var(--secondary))" }} />
              <Bar dataKey="value" name="Tasks" radius={[0, 6, 6, 0]} barSize={18}>
                {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
                <LabelList dataKey="value" position="right" style={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartEmpty text="No tasks yet" />}
      </div>
    </Panel>
  );
}

export function TasksByPriority({ ov }: WidgetProps) {
  if (!ov) return <WSkel />;
  const total = ov.byPriority.reduce((a, x) => a + x.count, 0);
  const data = ov.byPriority.map((p, i) => ({ name: p.priority, value: p.count, fill: colorFor(PRIORITY_COLORS, p.priority, i) }));
  return <Panel title="Open tasks by priority" icon={Target}><Donut data={data} center={total} sub="open" /></Panel>;
}

export function ProjectStatus({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  const map = new Map<string, number>();
  ov.projects.forEach((p) => map.set(p.status || "No status", (map.get(p.status || "No status") || 0) + 1));
  const data = [...map.entries()].map(([name, value], i) => ({ name, value, fill: projectStatusColor(name, i) }));
  return <Panel title="Projects by status" icon={FolderKanban} action={{ to: `${base(workspaceId)}/projects`, label: "Projects" }}><Donut data={data} center={ov.projects.length} sub="projects" /></Panel>;
}

export function Trend({ ov }: WidgetProps) {
  if (!ov) return <WSkel />;
  return (
    <Panel title="Created vs completed" icon={TrendingUp}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={ov.trend} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3B82F6" stopOpacity={0.35} /><stop offset="100%" stopColor="#3B82F6" stopOpacity={0} /></linearGradient>
              <linearGradient id="gDone" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.4} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tickFormatter={shortDate} interval={1} minTickGap={14} {...axis} />
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip contentStyle={tip} labelFormatter={(l) => shortDate(String(l))} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="created" name="Created" stroke="#3B82F6" strokeWidth={2} fill="url(#gCreated)" />
            <Area type="monotone" dataKey="completed" name="Completed" stroke="#10B981" strokeWidth={2} fill="url(#gDone)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Last 14 days. “Completed” is counted from the day a task was last changed to Done.</p>
    </Panel>
  );
}

export function Completion({ ov }: WidgetProps) {
  if (!ov) return <WSkel />;
  const s = ov.stats;
  return (
    <Panel title="Completion" icon={CheckCircle2}>
      <div className="relative mx-auto h-44 max-w-[14rem]">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={[{ name: "done", value: s.completionRate, fill: "hsl(var(--primary))" }]} innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" cornerRadius={12} background={{ fill: "hsl(var(--secondary))" }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-3xl font-semibold">{s.completionRate}%</p><p className="text-[11px] text-muted-foreground">of all tasks done</p></div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">{s.doneTasks} of {s.totalTasks} tasks are Done · {s.openTasks} still open</p>
    </Panel>
  );
}

export function Heatmap({ ov }: WidgetProps) {
  if (!ov) return <WSkel h="h-40" />;
  const max = Math.max(1, ...ov.heat.map((h) => h.count));
  const pad = new Date(`${ov.heat[0].date}T00:00:00Z`).getUTCDay();
  const cells: ({ date: string; count: number } | null)[] = [...Array(pad).fill(null), ...ov.heat];
  const total = ov.heat.reduce((a, h) => a + h.count, 0);
  const best = ov.heat.reduce((b, h) => (h.count > b.count ? h : b), ov.heat[0]);
  return (
    <Panel title="Activity over 12 weeks" icon={Activity}>
      <div className="overflow-x-auto pb-1">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
          {cells.map((c, i) =>
            c ? (
              <div key={c.date} title={`${shortDate(c.date)}: ${c.count} task${c.count === 1 ? "" : "s"} completed`} className="h-5 w-5 rounded-[5px] bg-secondary" style={c.count ? { background: `hsl(var(--primary) / ${0.22 + (c.count / max) * 0.78})` } : undefined} />
            ) : <div key={`p${i}`} className="h-5 w-5" />
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{total} tasks completed{best.count ? ` · best day ${shortDate(best.date)} (${best.count})` : ""}</span>
        <span className="flex items-center gap-1">Less {[0.15, 0.4, 0.65, 1].map((a) => <span key={a} className="h-3 w-3 rounded-sm" style={{ background: `hsl(var(--primary) / ${a})` }} />)} More</span>
      </div>
    </Panel>
  );
}

export function Bugs({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  const order = ["Critical", "High", "Medium", "Low", "Unrated"];
  const data = order.map((s) => ({ name: s, value: ov.bugs?.find((b) => b.severity === s)?.count || 0 }));
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <Panel title="Open bugs by severity" icon={Bug}>
      <div className="h-48">
        {total ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 16, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" {...axis} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip contentStyle={tip} cursor={{ fill: "hsl(var(--secondary))" }} />
              <Bar dataKey="value" name="Bugs" radius={[6, 6, 0, 0]}>
                {data.map((d) => <Cell key={d.name} fill={SEVERITY_COLORS[d.name]} />)}
                <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartEmpty text="No open bugs. 🎉" />}
      </div>
      <Link to={`${base(workspaceId)}/projects`} className="mt-1 inline-block text-xs text-primary hover:underline">Open a project to see its Bugs tab</Link>
    </Panel>
  );
}

export function Workload({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  const data = (ov.workload || []).map((w) => ({ name: w.name.split(" ")[0], normal: w.open - w.overdue, overdue: w.overdue }));
  return (
    <Panel title="Team workload" icon={Users} action={{ to: `${base(workspaceId)}/analytics`, label: "Analytics" }}>
      <div className="h-56">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={70} {...axis} tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={tip} cursor={{ fill: "hsl(var(--secondary))" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="normal" name="Open" stackId="w" fill="hsl(var(--primary))" barSize={16} />
              <Bar dataKey="overdue" name="Overdue" stackId="w" fill="#EF4444" radius={[0, 6, 6, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartEmpty text="No assigned tasks right now" />}
      </div>
    </Panel>
  );
}

/* ----------------------------------- lists ----------------------------------- */

export function ProjectsProgress({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  const list = ov.projects.filter((p) => !p.finished).sort((a, b) => b.overdue - a.overdue || a.progress - b.progress).slice(0, 7);
  return (
    <Panel title="Project progress" icon={FolderKanban} action={{ to: `${base(workspaceId)}/projects`, label: "All projects" }}>
      {!list.length && <ChartEmpty text="No running projects" />}
      <div className="space-y-3.5">
        {list.map((p) => (
          <Link key={p._id} to={`${base(workspaceId)}/projects/${p._id}/overview`} className="block">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2"><span className="text-base">{p.icon || "📁"}</span><span className="truncate font-medium">{p.name}</span>{p.overdue > 0 && <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">{p.overdue} overdue</span>}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{p.done}/{p.total} · {p.progress}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full transition-all", p.overdue ? "bg-amber-500" : "bg-primary")} style={{ width: `${p.progress}%` }} /></div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

export function Attention({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  return (
    <Panel title="Needs attention" icon={AlertTriangle}>
      {!ov.attention.length ? (
        <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"><CheckCircle2 className="h-8 w-8 text-emerald-500" />Every project is on track.</div>
      ) : (
        <div className="space-y-3">
          {ov.attention.map((p) => (
            <Link key={p._id} to={`${base(workspaceId)}/projects/${p._id}/overview`} className="block rounded-lg border border-border p-3 transition hover:border-primary/40">
              <p className="flex items-center gap-2 text-sm font-medium"><span>{p.icon || "📁"}</span>{p.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{p.reasons.map((r) => <span key={r} className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">{r}</span>)}</div>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function Deadlines({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  return (
    <Panel title="Project deadlines" icon={Target}>
      {!ov.deadlines.length && <ChartEmpty text="No project has an end date" />}
      <div className="divide-y divide-border">
        {ov.deadlines.map((d) => {
          const late = d.daysLeft < 0;
          return (
            <Link key={d._id} to={`${base(workspaceId)}/projects/${d._id}/overview`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-secondary/30">
              <span className="min-w-0"><span className="block truncate font-medium">{d.name}</span><span className="text-xs text-muted-foreground">{shortDate(d.endDate)} · {d.progress}% done</span></span>
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", late ? "bg-red-500/10 text-red-600 dark:text-red-400" : d.daysLeft <= 7 ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-secondary text-muted-foreground")}>{late ? `${-d.daysLeft}d late` : d.daysLeft === 0 ? "Today" : `${d.daysLeft}d left`}</span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

export function MyTasks({ ov, workspaceId }: WidgetProps) {
  if (!ov) return <WSkel />;
  return (
    <Panel title="My tasks" icon={ListChecks} action={{ to: `${base(workspaceId)}/my-tasks`, label: "All my tasks" }}>
      {!ov.tasks.length && <ChartEmpty text="No open task is assigned to you" />}
      <div className="divide-y divide-border">
        {ov.tasks.map((t) => {
          const d = dueText(t.dueDate);
          return (
            <Link key={t._id} to={t.projectId ? `${base(workspaceId)}/projects/${t.projectId}/board` : `${base(workspaceId)}/tasks`} className="flex items-center gap-3 py-2 text-sm hover:bg-secondary/30">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(STATUS_COLORS, t.status) }} title={t.status} />
              <span className="min-w-0 flex-1"><span className="block truncate">{t.type === "Bug" ? "🐛 " : ""}{t.title}</span><span className="text-xs text-muted-foreground">{t.projectName || "No project"} · {t.status}</span></span>
              <span className={cn("shrink-0 text-xs", d.cls)}>{d.t}</span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

export function RecentActivity({ ov }: WidgetProps) {
  if (!ov) return <WSkel />;
  return (
    <Panel title="Recent activity" icon={Activity}>
      {!ov.activity.length && <ChartEmpty text="No activity yet" />}
      <div className="space-y-3">
        {ov.activity.map((a) => (
          <div key={a._id} className="flex items-start gap-3 text-sm">
            <Avatar className="h-7 w-7 shrink-0"><AvatarImage src={a.actor?.profileImage} /><AvatarFallback className="text-[10px]">{initials(a.actor?.name || "?")}</AvatarFallback></Avatar>
            <div className="min-w-0">
              <p className="leading-snug"><b>{a.actor?.name || "Someone"}</b> <span className="text-muted-foreground">{a.action.replace(/_/g, " ")}</span>{a.title ? <span> · {a.title}</span> : null}</p>
              <p className="text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}