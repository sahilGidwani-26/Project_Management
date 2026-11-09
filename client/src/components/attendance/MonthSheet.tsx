import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AttMatrix } from "@/types";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CODE_CLS, dayKey, fmtDate, weekday } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { MonthNav, PersonCell } from "./attendanceUi";

const LEGEND: [string, string][] = [["P", "Present"], ["PL", "Present, late"], ["HD", "Half day"], ["A", "Absent"], ["L", "Leave"], ["H", "Holiday"], ["W", "Week off"], ["I", "No check-out"]];

export function MonthSheet({ workspaceId, ym, setYm, tz, onOpen }: { workspaceId: string; ym: string; setYm: (v: string) => void; tz: string; onOpen: (userId: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["att-matrix", workspaceId, ym],
    queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/matrix?month=${ym}`)).data.data as AttMatrix,
  });
  const current = dayKey(Date.now(), tz).slice(0, 7);

  if (isLoading || !data) return <Skeleton className="h-96" />;
  const hol = new Map(data.holidays.map((h) => [h.date, h.name]));

  return (
    <div className="space-y-4">
      <MonthNav ym={ym} onChange={setYm} current={current} />

      <div className="flex flex-wrap gap-2 text-xs">
        {LEGEND.map(([c, l]) => <span key={c} className="flex items-center gap-1.5"><span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-medium", CODE_CLS[c])}>{c}</span>{l}</span>)}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 min-w-[170px] bg-secondary px-3 py-2 text-left font-medium">Person</th>
              {data.dates.map((d) => {
                const wd = weekday(d);
                return (
                  <th key={d} title={hol.get(d) || fmtDate(d, { weekday: "long", day: "numeric", month: "short" })} className={cn("min-w-[26px] px-0.5 py-1 text-center font-medium", hol.has(d) && "bg-violet-500/20 text-violet-700 dark:text-violet-300")}>
                    <div>{Number(d.slice(8))}</div>
                    <div className="text-[9px] font-normal">{"SMTWTFS"[wd]}</div>
                  </th>
                );
              })}
              {["P", "A", "L", "Late"].map((h) => <th key={h} className="px-2 py-2 text-center font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {!data.rows.length && <tr><td colSpan={data.dates.length + 5} className="px-4 py-8 text-center text-muted-foreground">Nobody is tracked yet.</td></tr>}
            {data.rows.map((r) => (
              <tr key={r.userId} className="border-t border-border hover:bg-secondary/20">
                <td className="sticky left-0 z-10 cursor-pointer bg-background px-3 py-1.5" onClick={() => onOpen(r.userId)}><PersonCell p={r} /></td>
                {r.codes.map((c, i) => (
                  <td key={i} className="p-0.5 text-center">
                    {c && c !== "-" ? <span className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded px-0.5 font-medium", CODE_CLS[c])}>{c}</span> : <span className="text-muted-foreground/40">{c}</span>}
                  </td>
                ))}
                <td className="px-2 text-center font-medium text-emerald-600">{r.present}</td>
                <td className={cn("px-2 text-center font-medium", r.absent && "text-destructive")}>{r.absent}</td>
                <td className="px-2 text-center">{r.leave}</td>
                <td className={cn("px-2 text-center", r.late && "text-amber-600")}>{r.late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground">Hover a column heading to see the holiday name. The Late count includes days marked PL.</p>
    </div>
  );
}