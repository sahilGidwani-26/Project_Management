import { cn } from "@/lib/utils";
import { dayMs } from "@/lib/projectMeta";

export interface GanttItem {
  id: string;
  label: string;
  sub?: string;
  start?: string;
  end?: string;
  color?: string;
  progress?: number;
  onClick?: () => void;
}

const LABEL_W = 230;

/** Bina library ka Gantt chart. Jin items ki date nahi hai wo skip hote hain. */
export function Gantt({ items, dayWidth = 26 }: { items: GanttItem[]; dayWidth?: number }) {
  const rows = items
    .filter((i) => i.start || i.end)
    .map((i) => {
      const s = new Date((i.start || i.end)!).setHours(0, 0, 0, 0);
      const e = new Date((i.end || i.start)!).setHours(0, 0, 0, 0);
      return { ...i, s: Math.min(s, e), e: Math.max(s, e) };
    });
  if (!rows.length) return null;

  const min = Math.min(...rows.map((r) => r.s)) - 2 * dayMs;
  const max = Math.max(...rows.map((r) => r.e)) + 3 * dayMs;
  const days = Math.round((max - min) / dayMs) + 1;
  const width = days * dayWidth;
  const today = new Date().setHours(0, 0, 0, 0);
  const todayX = today >= min && today <= max ? ((today - min) / dayMs) * dayWidth + dayWidth / 2 : null;

  const ticks = Array.from({ length: days }, (_, i) => new Date(min + i * dayMs)).map((d, i) => ({ d, i })).filter(({ d }) => d.getDay() === 1 || d.getDate() === 1);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div style={{ minWidth: LABEL_W + width }}>
        <div className="flex border-b border-border bg-secondary/50 text-[10px] text-muted-foreground">
          <div className="sticky left-0 z-10 shrink-0 bg-secondary px-3 py-2 font-medium" style={{ width: LABEL_W }}>Name</div>
          <div className="relative h-8" style={{ width }}>
            {ticks.map(({ d, i }) => (
              <span key={i} className="absolute top-2 border-l border-border pl-1" style={{ left: i * dayWidth }}>
                {d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
            ))}
          </div>
        </div>

        {rows.map((r) => {
          const left = ((r.s - min) / dayMs) * dayWidth;
          const w = Math.max(((r.e - r.s) / dayMs + 1) * dayWidth, dayWidth * 0.8);
          return (
            <div key={r.id} className={cn("flex border-b border-border last:border-0 hover:bg-secondary/30", r.onClick && "cursor-pointer")} onClick={r.onClick}>
              <div className="sticky left-0 z-10 shrink-0 truncate bg-card px-3 py-2 text-xs" style={{ width: LABEL_W }} title={r.label}>
                <span className="font-medium">{r.label}</span>
                {r.sub && <span className="ml-1.5 text-[10px] text-muted-foreground">{r.sub}</span>}
              </div>
              <div className="relative h-9" style={{ width }}>
                {todayX !== null && <div className="absolute inset-y-0 w-px bg-destructive/50" style={{ left: todayX }} />}
                <div className="absolute top-2 h-5 overflow-hidden rounded" style={{ left, width: w, background: `${r.color || "#6366F1"}55`, border: `1px solid ${r.color || "#6366F1"}` }}>
                  <div className="h-full" style={{ width: `${r.progress ?? 0}%`, background: r.color || "#6366F1" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}