import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Check, FolderKanban, LayoutDashboard, ListChecks, RefreshCw, Video } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardGrid, WidgetTray } from "@/components/dashboard/DashboardGrid";
import { useDashLayout } from "@/components/dashboard/useDashLayout";
import type { DashOverview } from "@/components/dashboard/dashTypes";
import { cn } from "@/lib/utils";

const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export default function Dashboard() {
  const { workspaceId } = useParams();
  const w = workspaceId!;
  const { user } = useAuth();
  const { can } = usePermissions();
  const { currentWorkspace } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const L = useDashLayout(w);

  const { data, isError, refetch, isFetching } = useQuery({
    queryKey: ["dash-overview", w],
    queryFn: async () => (await api.get(`/dashboard/workspace/${w}/overview`)).data.data as DashOverview,
    enabled: !!w,
    refetchInterval: 60_000,
  });

  const quick = [
    { to: "projects", label: "Projects", icon: FolderKanban, ok: can("projects.view") },
    { to: "my-tasks", label: "My tasks", icon: ListChecks, ok: can("tasks.view") },
    { to: "attendance", label: "Attendance", icon: CalendarCheck, ok: can("attendance.view") },
    { to: "meetings", label: "Meetings", icon: Video, ok: can("meetings.view") },
  ].filter((q) => q.ok);

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${user?.name?.split(" ")[0] || "there"}`}
        description={`${currentWorkspace?.name || "Your workspace"} · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`}
        actions={
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" aria-label="Refresh" onClick={() => refetch()}><RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /></Button>
            <Button size="sm" variant={editing ? "default" : "outline"} onClick={() => setEditing((e) => !e)}>
              {editing ? <><Check className="h-4 w-4" /> Done</> : <><LayoutDashboard className="h-4 w-4" /> Customize</>}
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {quick.length > 0 && !editing && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <Link key={q.to} to={`/app/${w}/${q.to}`} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm transition hover:border-primary/40 hover:bg-primary/5"><q.icon className="h-3.5 w-3.5 text-muted-foreground" />{q.label}</Link>
            ))}
          </div>
        )}

        {editing && <WidgetTray L={L} />}

        {isError && (
          <Card className="flex items-center justify-between gap-3 border-destructive/40 p-4 text-sm">
            <span>Could not load the dashboard data.</span><Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
          </Card>
        )}

        {!L.ready ? <Skeleton className="h-96" /> : <DashboardGrid L={L} editing={editing} ov={data} workspaceId={w} />}
      </div>
    </div>
  );
}