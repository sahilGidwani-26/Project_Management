import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtCell } from "@/lib/reportFmt";
import { ChartCard } from "./ChartCard";
import type { Kpi, SectionDef, TableDef } from "./analyticsTypes";

const TONE: Record<string, string> = { good: "text-emerald-600 dark:text-emerald-400", bad: "text-destructive", warn: "text-amber-600 dark:text-amber-400", info: "text-blue-600 dark:text-blue-400" };

function KpiCard({ k }: { k: Kpi }) {
  return (
    <Card className="p-4">
      <p className="truncate text-xs text-muted-foreground">{k.label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tracking-tight", k.tone && TONE[k.tone])}>{k.value}</p>
      {k.sub && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{k.sub}</p>}
    </Card>
  );
}

function DataTable({ t }: { t: TableDef }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [all, setAll] = useState(false);

  const rows = useMemo(() => {
    if (!sort) return t.rows;
    const get = (r: Record<string, any>) => r[sort.key];
    return [...t.rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // empty cells always go last
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return c * sort.dir;
    });
  }, [t.rows, sort]);

  const shown = all ? rows : rows.slice(0, 15);
  const flip = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-4">
        <h3 className="text-sm font-semibold">{t.title}</h3>
        {t.note && <p className="text-xs text-muted-foreground">{t.note}</p>}
      </div>
      {!t.rows.length ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing to show for this period.</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>
                  {t.columns.map((c) => {
                    const right = (c.fmt || "text") !== "text";
                    return (
                      <th key={c.key} className={cn("whitespace-nowrap px-4 py-2.5 font-medium", right ? "text-right" : "text-left")} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                        <button type="button" onClick={() => flip(c.key)} className={cn("inline-flex items-center gap-1 hover:text-foreground", right && "flex-row-reverse")}>
                          {c.label}
                          {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r, i) => (
                  <tr key={i} className="hover:bg-secondary/30">
                    {t.columns.map((c) => {
                      const right = (c.fmt || "text") !== "text";
                      const txt = fmtCell(r[c.key], c.fmt);
                      return <td key={c.key} title={right ? undefined : txt} className={cn("px-4 py-2", right ? "whitespace-nowrap text-right tabular-nums" : "max-w-[280px] truncate")}>{txt}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 15 && (
            <div className="border-t border-border px-5 py-2.5 text-center">
              <Button size="sm" variant="ghost" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${rows.length} rows`}</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function ReportView({ section }: { section: SectionDef }) {
  const empty = !section.kpis.length && !section.charts.length && !section.tables.length;
  if (empty) return <Card className="p-10 text-center text-sm text-muted-foreground">There is nothing to report here yet.</Card>;
  return (
    <div className="space-y-6">
      {section.kpis.length > 0 && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{section.kpis.map((k) => <KpiCard key={k.label} k={k} />)}</div>}
      {section.charts.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{section.charts.map((c) => <ChartCard key={c.id} c={c} />)}</div>}
      {section.tables.map((t) => <DataTable key={t.id} t={t} />)}
      {section.notes.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-border bg-secondary/40 p-4">
          {section.notes.map((n) => <p key={n} className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{n}</p>)}
        </div>
      )}
    </div>
  );
}