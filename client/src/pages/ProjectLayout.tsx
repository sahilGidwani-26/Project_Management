import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle2, Star } from "lucide-react";
import { api } from "@/lib/api";
import { PriorityBadge } from "@/components/common/PriorityBadge";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProject";
import { attempt, statusDot } from "@/lib/projectMeta";
import { cn, formatDate, initials } from "@/lib/utils";

interface ProjectHealth { state: "ON_TRACK" | "NEEDS_ATTENTION" | "AT_RISK"; reasons: string[] }

const tabs = [
  ["overview", "Overview"], ["board", "Board"], ["list", "List"], ["timeline", "Timeline"], ["calendar", "Calendar"],
  ["sprints", "Sprints"], ["files", "Files"], ["discussion", "Discussion"], ["members", "Members"], ["reports", "Reports"],
  ["time", "Time"], ["risks", "Risks"], ["automation", "Automation"], ["settings", "Settings"],
] as const;

const healthConfig = {
  ON_TRACK: { label: "On track", icon: CheckCircle2, cls: "text-success" },
  NEEDS_ATTENTION: { label: "Needs attention", icon: AlertCircle, cls: "text-warning" },
  AT_RISK: { label: "At risk", icon: AlertTriangle, cls: "text-destructive" },
};

export default function ProjectLayout() {
  const { workspaceId, projectId, project, isAdmin, refresh } = useProject();
  const [editOpen, setEditOpen] = useState(false);

  const { data: health } = useQuery({
    queryKey: ["project-health", projectId],
    queryFn: async () => (await api.get(`/analytics/project/${projectId}/health`)).data.data as ProjectHealth,
    enabled: !!projectId,
  });
  const hc = health ? healthConfig[health.state] : null;
  const visibleTabs = tabs.filter(([to]) => to !== "settings" || isAdmin);

  return (
    <div>
      {project?.status === "Archived" && (
        <div className="flex items-center justify-between border-b border-border bg-amber-500/10 px-6 py-2 text-sm">
          <span>This project is archived.</span>
          {isAdmin && <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.post(`/projects/${projectId}/restore`), "Project restored")) && refresh()}>Restore</Button>}
        </div>
      )}

      <div className="border-b border-border px-6 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl">{project?.icon || "📁"}</span>
              <h1 className="text-lg font-semibold">{project?.name || "Loading..."}</h1>
              {project && <PriorityBadge priority={project.priority} />}
              {project && <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${statusDot[project.status]}`} />{project.status}</span>}
              {project?.visibility === "private" && <Badge variant="outline" className="text-[10px]">Private</Badge>}
              {project && (
                <button aria-label="Favorite" onClick={async () => (await attempt(() => api.post(`/projects/${projectId}/favorite`))) && refresh()}>
                  <Star className={cn("h-4 w-4", project.isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                </button>
              )}
            </div>
            {project?.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{project.description}</p>}
            {project && (
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {project.managerId && <span>Manager: {project.managerId.name}</span>}
                {(project.startDate || project.endDate) && <span>{project.startDate ? formatDate(project.startDate) : "…"} → {project.endDate ? formatDate(project.endDate) : "…"}</span>}
                {project.clientName && <span>Client: {project.clientName}</span>}
                <div className="flex -space-x-2">
                  {project.members.slice(0, 5).map((m) => (
                    <Avatar key={m._id} className="h-5 w-5 border-2 border-background" title={m.name}><AvatarImage src={m.profileImage} /><AvatarFallback className="text-[8px]">{initials(m.name)}</AvatarFallback></Avatar>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {hc && (
              <div className="flex items-center gap-1.5" title={health!.reasons.join(", ")}>
                <hc.icon className={cn("h-4 w-4", hc.cls)} />
                <span className={cn("text-sm font-medium", hc.cls)}>{hc.label}</span>
              </div>
            )}
            {isAdmin && <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>Edit</Button>}
          </div>
        </div>

        {health && health.reasons.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">{health.reasons.map((r) => <span key={r} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{r}</span>)}</div>
        )}

        <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto">
          {visibleTabs.map(([to, label]) => (
            <NavLink key={to} to={`/app/${workspaceId}/projects/${projectId}/${to}`}
              className={({ isActive }) => cn("shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors", isActive ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
      {project && <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} workspaceId={workspaceId} project={project} />}
    </div>
  );
}