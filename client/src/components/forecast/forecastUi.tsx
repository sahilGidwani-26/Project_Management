import { ForecastState } from "@/types";
import { cn } from "@/lib/utils";

export const STATE_META: Record<ForecastState, { label: string; cls: string; dot: string; border: string }> = {
  COMPLETE: { label: "Complete", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", dot: "bg-blue-500", border: "border-blue-500" },
  ON_TRACK: { label: "On track", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", border: "border-emerald-500" },
  NEEDS_ATTENTION: { label: "Needs attention", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-500", border: "border-amber-500" },
  AT_RISK: { label: "At risk", cls: "bg-red-500/15 text-red-700 dark:text-red-300", dot: "bg-red-500", border: "border-red-500" },
  NO_DEADLINE: { label: "No deadline", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300", dot: "bg-slate-400", border: "border-slate-400" },
  NOT_ENOUGH_DATA: { label: "Not enough data", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300", dot: "bg-slate-400", border: "border-slate-400" },
  PENDING: { label: "Calculating…", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300", dot: "bg-slate-400", border: "border-slate-400" },
};

export function StateBadge({ state }: { state: ForecastState }) {
  const m = STATE_META[state] || STATE_META.PENDING;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium", m.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/** Dates from the server are UTC midnights, so they are always shown in UTC (no off-by-one day). */
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
export const fmtShort = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
/** days from a to b (positive when b is later). */
export const daysBetween = (a?: string | null, b?: string | null) => (a && b ? Math.round((+new Date(b) - +new Date(a)) / 864e5) : null);

/* ------------------------------ chance curve ------------------------------ */

type Pt = { date: string; p: number };

export function ChanceCurve({ base, whatIf, deadline }: { base: Pt[]; whatIf?: Pt[]; deadline?: string | null }) {
  const W = 680, H = 250, P = 36;
  const ms = (s: string) => +new Date(s);
  const all = [...base, ...(whatIf || [])].map((d) => ms(d.date));
  if (!all.length) return <p className="text-sm text-muted-foreground">Nothing to draw yet.</p>;

  const dl = deadline ? ms(deadline) : null;
  let min = Math.min(...all), max = Math.max(...all);
  if (dl != null) { min = Math.min(min, dl); max = Math.max(max, dl); }
  if (max === min) max = min + 864e5;
  const pad = (max - min) * 0.03;
  min -= pad; max += pad;

  const x = (t: number) => P + ((t - min) / (max - min)) * (W - P * 2);
  const y = (p: number) => H - P - (p / 100) * (H - P * 2);
  const line = (pts: Pt[]) => pts.map((d) => `${x(ms(d.date))},${y(d.p)}`).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 520, width: "100%" }} role="img" aria-label="Chance of finishing by each date">
        {[0, 50, 85, 100].map((p) => (
          <g key={p}>
            <line x1={P} x2={W - P} y1={y(p)} y2={y(p)} stroke="currentColor" strokeOpacity={p === 85 ? 0.45 : 0.12} strokeDasharray={p === 85 ? "5 4" : undefined} />
            <text x={4} y={y(p) + 3} fontSize="10" fill="currentColor" fillOpacity={0.6}>{p}%</text>
          </g>
        ))}
        <text x={P} y={H - 10} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmtShort(min)}</text>
        <text x={W / 2} y={H - 10} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity={0.6}>{fmtShort((min + max) / 2)}</text>
        <text x={W - P} y={H - 10} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity={0.6}>{fmtShort(max)}</text>

        {dl != null && (
          <g>
            <line x1={x(dl)} x2={x(dl)} y1={P - 8} y2={H - P} stroke="#EF4444" strokeWidth="2" />
            <text x={x(dl)} y={P - 12} fontSize="10" textAnchor="middle" fill="#EF4444">Deadline</text>
          </g>
        )}
        <polyline points={line(base)} fill="none" stroke="#6366F1" strokeWidth="2.5" />
        {whatIf && whatIf.length > 0 && <polyline points={line(whatIf)} fill="none" stroke="#10B981" strokeWidth="2.5" />}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-[#6366F1] align-middle" />Current pace</span>
        {whatIf && whatIf.length > 0 && <span><span className="mr-1 inline-block h-0.5 w-4 bg-[#10B981] align-middle" />What-if</span>}
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-[#EF4444] align-middle" />Deadline</span>
        <span>Dashed line = 85% (safe)</span>
      </div>
    </div>
  );
}

/* ------------------------------ weekly bars ------------------------------ */

export function WeeklyBars({ weeks }: { weeks: { weekStart: string; done: number }[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.done));
  return (
    <div className="flex items-end gap-2">
      {weeks.map((w) => (
        <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1" title={`Week of ${fmtDate(w.weekStart)}: ${w.done} task(s) finished`}>
          <span className="text-[10px]">{w.done}</span>
          <div className="flex h-24 w-full items-end">
            <div className="w-full rounded-t bg-indigo-500" style={{ height: `${Math.max((w.done / max) * 100, w.done ? 4 : 1)}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground">{fmtShort(+new Date(w.weekStart))}</span>
        </div>
      ))}
    </div>
  );
}

/* --------------------- "is the safe date moving?" chart --------------------- */

export function TrendChart({ rows }: { rows: { day: string; p85?: string | null; deadline?: string | null }[] }) {
  const pts = rows.filter((r) => r.p85).map((r) => ({ x: +new Date(`${r.day}T00:00:00Z`), y: +new Date(r.p85 as string) }));
  if (pts.length < 2) return null;

  const dl = [...rows].reverse().find((r) => r.deadline)?.deadline;
  const dlMs = dl ? +new Date(dl) : null;
  const W = 680, H = 200, P = 40;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (dlMs != null) { y0 = Math.min(y0, dlMs); y1 = Math.max(y1, dlMs); }
  if (y1 === y0) y1 = y0 + 864e5;
  const xx = (t: number) => P + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - P * 2);
  const yy = (t: number) => H - 24 - ((t - y0) / (y1 - y0)) * (H - 24 - 18);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: 480, width: "100%" }} role="img" aria-label="Safe finish date over time">
        <text x={4} y={20} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmtShort(y1)}</text>
        <text x={4} y={H - 24} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmtShort(y0)}</text>
        <text x={P} y={H - 6} fontSize="10" fill="currentColor" fillOpacity={0.6}>{fmtShort(x0)}</text>
        <text x={W - P} y={H - 6} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity={0.6}>{fmtShort(x1)}</text>
        {dlMs != null && (
          <g>
            <line x1={P} x2={W - P} y1={yy(dlMs)} y2={yy(dlMs)} stroke="#EF4444" strokeDasharray="5 4" />
            <text x={W - P} y={yy(dlMs) - 4} fontSize="10" textAnchor="end" fill="#EF4444">Deadline</text>
          </g>
        )}
        <polyline points={pts.map((p) => `${xx(p.x)},${yy(p.y)}`).join(" ")} fill="none" stroke="#6366F1" strokeWidth="2.5" />
        {pts.map((p) => (
          <circle key={p.x} cx={xx(p.x)} cy={yy(p.y)} r={3} fill="#6366F1">
            <title>{`${fmtShort(p.x)}: safe date ${fmtShort(p.y)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}