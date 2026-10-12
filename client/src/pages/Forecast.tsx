import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { WorkspaceForecast } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { StateBadge, fmtDate } from "@/components/forecast/forecastUi";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const Stat = ({ label, value, cls }: { label: string; value: number; cls?: string }) => (
  <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p></CardContent></Card>
);

export default function Forecast() {
  const { workspaceId } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["workspace-forecast", workspaceId],
    queryFn: async () => (await api.get(`/analytics/workspace/${workspaceId}/forecast`)).data.data as WorkspaceForecast,
    enabled: !!workspaceId,
  });

  const rows = data?.projects || [];
  const s = data?.summary;

  return (
    <div>
      <PageHeader title="Delivery forecast" description="Which projects will finish on time, based on how fast your team really works" />
      <div className="space-y-6 p-6">
        {isLoading && <Skeleton className="h-64" />}

        {!isLoading && !rows.length && (
          <EmptyState icon={TrendingUp} title="No open projects" description="Forecasts appear here for projects that are Planning, Active or On Hold." />
        )}

        {s && !!rows.length && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="At risk" value={s.atRisk} cls={s.atRisk ? "text-red-600" : ""} />
            <Stat label="Needs attention" value={s.needsAttention} cls={s.needsAttention ? "text-amber-600" : ""} />
            <Stat label="On track" value={s.onTrack} cls="text-emerald-600" />
            <Stat label="Complete" value={s.complete} cls="text-blue-600" />
          </div>
        )}

        {!!rows.length && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>{["Project", "Status", "Chance to meet deadline", "Safe date (85%)", "Deadline", "Open tasks", "Pace / week"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.project._id} className="hover:bg-secondary/30">
                    <td className="px-4 py-2.5 font-medium">
                      <Link to={`/app/${workspaceId}/projects/${r.project._id}/forecast`} className="hover:underline">
                        <span className="mr-2">{r.project.icon || "📁"}</span>{r.project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5"><StateBadge state={r.state} /></td>
                    <td className="px-4 py-2.5">
                      {r.probability == null ? <span className="text-muted-foreground">—</span> : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                            <div className={cn("h-full", r.probability >= 85 ? "bg-emerald-500" : r.probability >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${r.probability}%` }} />
                          </div>
                          <span className="text-xs">{r.probability}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{fmtDate(r.p85)}</td>
                    <td className="px-4 py-2.5 text-xs">{fmtDate(r.deadline)}</td>
                    <td className="px-4 py-2.5 text-xs">{r.remaining ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{r.fresh ? r.perWeek : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Projects with fewer than 5 recently finished tasks show “Not enough data”. Project leads get an email when a project becomes <b>At risk</b> (at most once a week per project).
        </p>
      </div>
    </div>
  );
}