import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { FolderKanban, CheckSquare, Users, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { WorkspaceForecast } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { StateBadge, fmtDate } from "@/components/forecast/forecastUi";

interface WorkspaceAnalytics {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  teamMembers: number;
  overdueTasks: number;
  tasksByStatus: { _id: string; count: number }[];
}

const statConfig = [
  { key: "totalProjects", label: "Total Projects", icon: FolderKanban },
  { key: "activeProjects", label: "Active Projects", icon: CheckSquare },
  { key: "teamMembers", label: "Team Members", icon: Users },
  { key: "overdueTasks", label: "Overdue Tasks", icon: AlertTriangle },
] as const;

export default function Dashboard() {
  const { workspaceId } = useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-analytics", workspaceId],
    queryFn: async () => (await api.get(`/analytics/workspace/${workspaceId}`)).data.data as WorkspaceAnalytics,
    enabled: !!workspaceId,
  });

  const { data: activity } = useQuery({
    queryKey: ["workspace-activity", workspaceId],
    queryFn: async () => (await api.get(`/analytics/workspace/${workspaceId}/activity?limit=8`)).data.data.items,
    enabled: !!workspaceId,
  });

  const { data: forecast, isLoading: forecastLoading } = useQuery({
    queryKey: ["workspace-forecast", workspaceId],
    queryFn: async () => (await api.get(`/analytics/workspace/${workspaceId}/forecast`)).data.data as WorkspaceForecast,
    enabled: !!workspaceId,
  });

  const chartData = (data?.tasksByStatus || []).map((s) => ({ status: s._id, count: s.count }));
  const risky = (forecast?.projects || []).filter((p) => p.state === "AT_RISK" || p.state === "NEEDS_ATTENTION").slice(0, 5);

  return (
    <div>
      <PageHeader title="Dashboard" description="Your workspace at a glance" />
      <div className="p-6 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statConfig.map((s) => (
            <Card key={s.key}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <s.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  {isLoading ? (
                    <Skeleton className="h-6 w-10" />
                  ) : (
                    <p className="text-2xl font-semibold">{data?.[s.key] ?? 0}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Delivery forecast</CardTitle>
            <Link to={`/app/${workspaceId}/forecast`} className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {forecastLoading && <Skeleton className="h-16 w-full" />}
            {!forecastLoading && !forecast?.projects.length && (
              <p className="text-sm text-muted-foreground">No open projects to forecast yet.</p>
            )}
            {!forecastLoading && !!forecast?.projects.length && !risky.length && (
              <p className="text-sm text-muted-foreground">
                {forecast.summary.onTrack + forecast.summary.complete > 0
                  ? "No project is at risk of missing its deadline."
                  : "Forecasts appear once your projects have a week of finished tasks."}
              </p>
            )}
            {!!risky.length && (
              <div className="divide-y divide-border">
                {risky.map((p) => (
                  <Link
                    key={p.project._id}
                    to={`/app/${workspaceId}/projects/${p.project._id}/forecast`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:bg-secondary/30"
                  >
                    <span className="font-medium"><span className="mr-2">{p.project.icon || "📁"}</span>{p.project.name}</span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      {p.probability != null && <span>{p.probability}% chance</span>}
                      <span>safe date {fmtDate(p.p85)}</span>
                      <span>deadline {fmtDate(p.deadline)}</span>
                      <StateBadge state={p.state} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Tasks by status</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : chartData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="status" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No tasks yet — create a project to get started.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!activity?.length && <p className="text-sm text-muted-foreground">No activity yet.</p>}
              {activity?.map((a: any) => (
                <div key={a._id} className="flex items-start gap-2.5 text-sm">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <div>
                    <span className="font-medium">{a.actorId?.name || "Someone"}</span>{" "}
                    <span className="text-muted-foreground">{a.action.replace(/_/g, " ")}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}