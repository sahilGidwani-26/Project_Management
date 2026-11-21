import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDown, ArrowUp, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const PALETTE = ["#14B8A6", "#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899", "#10B981", "#EF4444", "#06B6D4"];
export const STATUS_COLORS: Record<string, string> = { Backlog: "#94A3B8", Todo: "#3B82F6", "In Progress": "#F59E0B", "In Review": "#8B5CF6", Done: "#10B981" };
export const PRIORITY_COLORS: Record<string, string> = { Low: "#94A3B8", Medium: "#3B82F6", High: "#F59E0B", Urgent: "#EF4444", Critical: "#EF4444" };
export const SEVERITY_COLORS: Record<string, string> = { Critical: "#EF4444", High: "#F97316", Medium: "#F59E0B", Low: "#94A3B8", Unrated: "#CBD5E1" };

export const colorFor = (map: Record<string, string>, key: string, i = 0) => map[key] || PALETTE[i % PALETTE.length];

export function projectStatusColor(s: string, i = 0) {
  if (/complet|done/i.test(s)) return "#10B981";
  if (/hold|pause/i.test(s)) return "#F59E0B";
  if (/archiv|cancel/i.test(s)) return "#94A3B8";
  if (/plan|draft/i.test(s)) return "#3B82F6";
  return PALETTE[i % PALETTE.length];
}

export const tip = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 };
export const shortDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

const TONES = {
  primary: "bg-primary/10 text-primary", red: "bg-red-500/10 text-red-600 dark:text-red-400", amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400", violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400", green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};
export type Tone = keyof typeof TONES;

/* ----------------------------------- chrome ----------------------------------- */

export function Panel({ title, icon: Icon, action, children, body }: { title: string; icon?: LucideIcon; action?: { to: string; label: string }; children: ReactNode; body?: string }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">{Icon && <Icon className="h-4 w-4 text-muted-foreground" />}{title}</h3>
        {action && <Link to={action.to} className="flex items-center gap-0.5 text-xs text-primary hover:underline">{action.label}<ArrowUpRight className="h-3 w-3" /></Link>}
      </div>
      <div className={cn("min-h-0 flex-1 px-5 pb-4 pt-3", body)}>{children}</div>
    </Card>
  );
}

export const WSkel = ({ h = "h-56" }: { h?: string }) => (
  <Card className="h-full p-5"><Skeleton className="mb-4 h-4 w-32" /><Skeleton className={cn("w-full", h)} /></Card>
);

export const ChartEmpty = ({ text = "Nothing to show yet" }: { text?: string }) => (
  <div className="flex h-full min-h-[8rem] items-center justify-center text-center text-sm text-muted-foreground">{text}</div>
);

/* ------------------------------------ KPI ------------------------------------ */

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  const id = `sp${useId().replace(/:/g, "")}`;
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.4} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Kpi({ icon: Icon, label, value, sub, tone = "primary", delta, spark, sparkColor = "#14B8A6", to }: {
  icon: LucideIcon; label: string; value: ReactNode; sub?: string; tone?: Tone; delta?: { pct: number; goodWhenUp: boolean } | null; spark?: number[]; sparkColor?: string; to?: string;
}) {
  const body = (
    <Card className="h-full p-5 transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", TONES[tone])}><Icon className="h-5 w-5" /></div>
        {spark && <Sparkline data={spark} color={sparkColor} />}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium", delta.pct === 0 ? "bg-secondary text-muted-foreground" : (delta.pct > 0) === delta.goodWhenUp ? TONES.green : TONES.red)}>
            {delta.pct > 0 ? <ArrowUp className="h-3 w-3" /> : delta.pct < 0 ? <ArrowDown className="h-3 w-3" /> : null}{Math.abs(delta.pct)}%
          </span>
        )}
      </div>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

/* ------------------------------------ donut ------------------------------------ */

export function Donut({ data, center, sub }: { data: { name: string; value: number; fill: string }[]; center: ReactNode; sub: string }) {
  const total = data.reduce((a, x) => a + x.value, 0);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative h-40 shrink-0">
        {total ? (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} stroke="none">
                  {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
                </Pie>
                <Tooltip contentStyle={tip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-2xl font-semibold">{center}</p><p className="text-[11px] text-muted-foreground">{sub}</p></div>
          </>
        ) : <ChartEmpty />}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.fill }} /><span className="truncate">{d.name}</span><span className="ml-auto text-muted-foreground">{d.value}</span></li>
        ))}
      </ul>
    </div>
  );
}