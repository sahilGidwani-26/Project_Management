import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ForecastHistoryRow, ProjectForecast as Forecast } from "@/types";
import { useProject, useProjectResource } from "@/hooks/useProject";
import { ChanceCurve, STATE_META, StateBadge, TrendChart, WeeklyBars, daysBetween, fmtDate } from "@/components/forecast/forecastUi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const LEVELS: [keyof Forecast["dates"], string, string][] = [
  ["p50", "50% sure", "a coin flip"],
  ["p70", "70% sure", "likely"],
  ["p85", "85% sure", "safe, promise this date"],
  ["p95", "95% sure", "almost certain"],
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function ProjectForecast() {
  const { projectId } = useProject();
  const [remove, setRemove] = useState(0);
  const [speedPct, setSpeedPct] = useState(100);
  const [applied, setApplied] = useState({ remove: 0, speedPct: 100 });
  const [shown, setShown] = useState<Forecast | null>(null);

  // wait until the slider stops moving before asking the server again
  useEffect(() => {
    const t = setTimeout(() => setApplied({ remove, speedPct }), 350);
    return () => clearTimeout(t);
  }, [remove, speedPct]);

  useEffect(() => { setShown(null); setRemove(0); setSpeedPct(100); }, [projectId]);

  const { data, isError } = useQuery({
    queryKey: ["forecast", projectId, applied.remove, applied.speedPct],
    queryFn: async () => (await api.get(`/projects/${projectId}/forecast?remove=${applied.remove}&speed=${applied.speedPct / 100}`)).data.data as Forecast,
    enabled: !!projectId,
  });
  useEffect(() => { if (data) setShown(data); }, [data]);

  const { data: history } = useProjectResource<ForecastHistoryRow[]>("forecast-history", projectId, "forecast/history");

  const f = shown;
  if (!f) {
    return <div className="p-6">{isError ? <p className="text-sm text-destructive">Could not load the forecast.</p> : <Skeleton className="h-64" />}</div>;
  }

  const w = f.whatIf;
  const meta = STATE_META[f.state];
  const ready = f.state !== "NOT_ENOUGH_DATA" && f.state !== "COMPLETE";
  const touched = remove !== 0 || speedPct !== 100;
  const shiftDays = w ? daysBetween(w.dates.p85, f.dates.p85) : null; // positive = what-if is earlier
  const trendWord = { up: "Speeding up", down: "Slowing down", flat: "Steady" }[f.throughput.trend];
  const trendIcon = { up: "↑", down: "↓", flat: "→" }[f.throughput.trend];

  const tryFix = () => {
    if (!f.fix) return;
    setRemove(Math.min(f.fix.removeNeeded, f.openTasks));
    setSpeedPct(100);
  };
  const trySpeed = () => {
    if (!f.fix || f.fix.speedNeededPct == null) return;
    setRemove(0);
    setSpeedPct(Math.min(300, Math.max(50, Math.ceil((100 + f.fix.speedNeededPct) / 5) * 5)));
  };

  const hist = (history || []).map((h) => ({ day: h.day, p85: h.p85, deadline: h.deadline }));
  const first = (history || []).find((h) => h.p85);
  const last = [...(history || [])].reverse().find((h) => h.p85);
  const moved = first && last && first.day !== last.day ? daysBetween(first.p85, last.p85) : null;

  return (
    <div className="space-y-6 p-6">
      {/* ------------- headline ------------- */}
      <Card className={cn("border-l-4", meta.border)}>
        <CardContent className="space-y-2 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <StateBadge state={f.state} />
            <span className="text-xs text-muted-foreground">{plural(f.openTasks, "open task")} · pace {f.throughput.perWeek} tasks / week</span>
          </div>

          {f.state === "COMPLETE" && <p className="text-lg font-semibold">All tasks are done. Nothing left to forecast.</p>}
          {f.state === "NOT_ENOUGH_DATA" && (
            <>
              <p className="text-lg font-semibold">Not enough history for a reliable date yet</p>
              <p className="text-sm text-muted-foreground">{f.reason}</p>
              <p className="text-xs text-muted-foreground">A wrong date is worse than no date, so nothing is guessed until the team has a track record.</p>
            </>
          )}
          {ready && (
            <>
              <p className="text-lg font-semibold">
                {f.dates.p85 ? <>85% sure it is done by <span className="text-primary">{fmtDate(f.dates.p85)}</span></> : "At the current pace this is more than a year away"}
              </p>
              {f.deadline ? (
                <p className="text-sm">
                  Deadline <b>{fmtDate(f.deadline)}</b> · chance to meet it: <b className={f.probability != null && f.probability >= 85 ? "text-emerald-600" : f.probability != null && f.probability >= 50 ? "text-amber-600" : "text-red-600"}>{f.probability}%</b>
                  {f.daysLate85 ? <span className="text-muted-foreground"> · the safe date is about {plural(f.daysLate85, "day")} after the deadline</span> : null}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">This project has no due date. Set one (Edit project) to see the chance of meeting it.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {ready && (
        <>
          {/* ------------- date levels ------------- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LEVELS.map(([k, label, hint]) => {
              const wd = w?.dates[k];
              return (
                <Card key={k} className={cn(k === "p85" && "ring-1 ring-primary/40")}>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">{label} <span className="opacity-70">· {hint}</span></p>
                    <p className="mt-1 text-xl font-semibold">{f.dates[k] ? fmtDate(f.dates[k]) : "> 1 year"}</p>
                    {w && <p className="text-xs text-emerald-600">what-if: {wd ? fmtDate(wd) : "> 1 year"}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* ------------- chance curve ------------- */}
          <Card><CardContent className="space-y-3 p-5">
            <h3 className="font-medium">Chance of being done by each date</h3>
            <ChanceCurve base={f.distribution} whatIf={w?.distribution} deadline={f.deadline} />
            <p className="text-xs text-muted-foreground">
              Read it like this: pick a date on the bottom, go up to the line, and the height is the chance the work is finished by then. Where the line crosses the dashed <b>85%</b> mark is the date you can safely promise.
            </p>
          </CardContent></Card>

          {/* ------------- what-if ------------- */}
          <Card><CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-medium">What if…?</h3>
                <p className="text-xs text-muted-foreground">Move the sliders and the forecast updates. Nothing is changed in your project.</p>
              </div>
              {touched && <Button size="sm" variant="outline" onClick={() => { setRemove(0); setSpeedPct(100); }}>Reset</Button>}
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm"><span>Move tasks out of scope</span><b>{remove} of {f.openTasks}</b></div>
                <input type="range" className="w-full" min={0} max={Math.max(f.openTasks, 1)} step={1} value={remove} onChange={(e) => setRemove(Number(e.target.value))} aria-label="Tasks to remove from scope" />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-sm"><span>Team speed</span><b>{speedPct}%</b></div>
                <input type="range" className="w-full" min={50} max={300} step={5} value={speedPct} onChange={(e) => setSpeedPct(Number(e.target.value))} aria-label="Team speed" />
                <p className="text-[11px] text-muted-foreground">100% = today's pace. 125% is roughly one more person on a team of four.</p>
              </div>
            </div>

            {w && (
              <div className="rounded-md bg-emerald-500/10 p-3 text-sm">
                <p>
                  Safe date (85%): <b>{f.dates.p85 ? fmtDate(f.dates.p85) : "> 1 year"}</b> → <b className="text-emerald-700 dark:text-emerald-300">{w.dates.p85 ? fmtDate(w.dates.p85) : "> 1 year"}</b>
                  {shiftDays != null && shiftDays !== 0 && <span className="text-muted-foreground"> ({plural(Math.abs(shiftDays), "day")} {shiftDays > 0 ? "earlier" : "later"})</span>}
                </p>
                {f.deadline && w.probability != null && f.probability != null && (
                  <p>Chance to meet the deadline: <b>{f.probability}%</b> → <b className="text-emerald-700 dark:text-emerald-300">{w.probability}%</b></p>
                )}
              </div>
            )}

            {f.fix && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">To meet the deadline with 85% confidence</p>
                <p className="text-muted-foreground">
                  At today's pace the team can safely finish about <b>{f.fix.capacity85}</b> of the {f.remaining} open tasks by {fmtDate(f.deadline)}. You can:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.fix.removeNeeded > 0 && <Button size="sm" variant="outline" onClick={tryFix}>Move {plural(f.fix.removeNeeded, "task")} out of scope</Button>}
                  {f.fix.speedNeededPct != null && f.fix.speedNeededPct > 0 && <Button size="sm" variant="outline" onClick={trySpeed}>Work about {f.fix.speedNeededPct}% faster</Button>}
                  <Button size="sm" variant="ghost" onClick={() => {}} disabled className="hidden" />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">These buttons only set the sliders above so you can see the result. Or move the deadline.</p>
              </div>
            )}
          </CardContent></Card>
        </>
      )}

      {/* ------------- pace ------------- */}
      {f.throughput.weekly.length > 0 && (
        <Card><CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Team pace (tasks finished per week)</h3>
            <span className="text-sm"><b>{f.throughput.perWeek}</b> / week · {trendIcon} {trendWord}</span>
          </div>
          <WeeklyBars weeks={f.throughput.weekly} />
          <p className="text-xs text-muted-foreground">
            The forecast is built from what the team <b>really finished</b> on each of the last {f.throughput.windowDays} days ({f.throughput.doneInWindow} tasks), replayed 3,000 times to see how things could play out. It improves as more history builds up.
          </p>
        </CardContent></Card>
      )}

      {/* ------------- trend ------------- */}
      {hist.filter((h) => h.p85).length >= 2 && (
        <Card><CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Is the safe date moving?</h3>
            {moved != null && (
              <span className={cn("text-sm", moved > 0 ? "text-red-600" : moved < 0 ? "text-emerald-600" : "text-muted-foreground")}>
                {moved === 0 ? "No change" : `${plural(Math.abs(moved), "day")} ${moved > 0 ? "later" : "earlier"}`} since {fmtDate(first!.day)}
              </span>
            )}
          </div>
          <TrendChart rows={hist} />
          <p className="text-xs text-muted-foreground">One point per day. A line going <b>up</b> means the safe finish date keeps slipping, going <b>down</b> means the team is catching up.</p>
        </CardContent></Card>
      )}

      <p className="text-[11px] text-muted-foreground">Updated {new Date(f.generatedAt).toLocaleString()}. Forecasts are estimates, not promises.</p>
    </div>
  );
}