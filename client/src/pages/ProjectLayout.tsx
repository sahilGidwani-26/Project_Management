import { useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertCircle, AlertTriangle, Archive, BarChart3, Bug, Building2, CalendarDays, CheckCircle2, ClipboardList, FolderKanban, Flag, GitBranch, KanbanSquare,
  Layers, LayoutDashboard, ListChecks, Lock, MessageSquare, MoreHorizontal, Paperclip, Pencil, Repeat, Rocket, Settings, Star, Target, Timer, TrendingUp, User, Users, Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { PriorityBadge } from "@/components/common/PriorityBadge";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { NoAccess } from "@/components/permissions/permissionUi";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProject";
import { usePermissions } from "@/hooks/usePermissions";
import { NavAccess, PROJECT_GROUPS, PROJECT_TAB_ACCESS, ruleAllowed } from "@/lib/accessMap";
import { attempt, statusDot } from "@/lib/projectMeta";
import { cn, formatDate, initials } from "@/lib/utils";

interface ProjectHealth { state: "ON_TRACK" | "NEEDS_ATTENTION" | "AT_RISK"; reasons: string[] }

const healthConfig = {
  ON_TRACK: { label: "On track", icon: CheckCircle2, cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  NEEDS_ATTENTION: { label: "Needs attention", icon: AlertCircle, cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  AT_RISK: { label: "At risk", icon: AlertTriangle, cls: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
};

const GROUP_ICONS: Record<string, LucideIcon> = { project: FolderKanban, work: KanbanSquare, planning: Flag, insights: BarChart3, collab: MessageSquare, connect: Zap, more: MoreHorizontal };
const TAB_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard, members: Users, settings: Settings,
  board: KanbanSquare, list: ListChecks, bugs: Bug, timeline: Layers, calendar: CalendarDays,
  sprints: Repeat, poker: Target, releases: Rocket,
  reports: BarChart3, "sprint-reports": Activity, forecast: TrendingUp, time: Timer, risks: AlertTriangle,
  discussion: MessageSquare, files: Paperclip, standup: ClipboardList,
  github: GitBranch, automation: Zap,
};

interface Group { key: string; label: string; items: NavAccess[] }

export default function ProjectLayout() {
  const { workspaceId, projectId, project, isAdmin, refresh } = useProject();
  const { can } = usePermissions();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const lastTab = useRef<Record<string, string>>({}); // the tab you used last in each group

  const { data: health } = useQuery({
    queryKey: ["project-health", projectId],
    queryFn: async () => (await api.get(`/analytics/project/${projectId}/health`)).data.data as ProjectHealth,
    enabled: !!projectId,
  });
  const hc = health ? healthConfig[health.state] : null;

  /* ---- only what this person may open (the Settings tab also needs the project admin role) ---- */
  const visibleTabs = PROJECT_TAB_ACCESS.filter((t) => ruleAllowed(t, can) && (t.to !== "settings" || isAdmin));
  const byKey = new Map(visibleTabs.map((t) => [t.to, t]));
  const inGroups = new Set(PROJECT_GROUPS.flatMap((g) => g.tabs));
  const groups: Group[] = [
    ...PROJECT_GROUPS.map((g) => ({ key: g.key, label: g.label, items: g.tabs.map((k) => byKey.get(k)).filter(Boolean) as NavAccess[] })),
    { key: "more", label: "More", items: visibleTabs.filter((t) => !inGroups.has(t.to)) },
  ].filter((g) => g.items.length > 0);

  const base = `/app/${workspaceId}/projects/${projectId}`;
  const tab = pathname.split("/")[5]; // /app/<workspace>/projects/<project>/<tab>
  const current = PROJECT_TAB_ACCESS.find((t) => t.to === tab);
  const blocked = !!current && (!ruleAllowed(current, can) || (current.to === "settings" && !isAdmin));
  const active = groups.find((g) => g.items.some((i) => i.to === tab)) || groups[0];
  if (active && tab) lastTab.current[active.key] = tab;
  const nextTab = groups[0]?.items[0]?.to;

  const openGroup = (g: Group) => {
    const remembered = lastTab.current[g.key];
    navigate(`${base}/${g.items.some((i) => i.to === remembered) ? remembered : g.items[0].to}`);
  };

  const color = project?.color && /^#[0-9a-f]{6}$/i.test(project.color) ? project.color : null;
  const members = project?.members || [];

  return (
    <div>
      {project?.status === "Archived" && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-amber-500/10 px-4 py-2 text-sm md:px-6">
          <span className="flex items-center gap-2"><Archive className="h-4 w-4" /> This project is archived.</span>
          {isAdmin && can("projects.archive") && (
            <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.post(`/projects/${projectId}/restore`), "Project restored")) && refresh()}>Restore</Button>
          )}
        </div>
      )}

      {/* ------------------------------- header ------------------------------- */}
      <div className="px-4 pb-4 pt-5 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl"
              style={{ background: color ? `${color}26` : "hsl(var(--primary) / 0.12)" }}
            >
              {project?.icon || "📁"}
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">{project?.name || "Loading…"}</h1>
                {project && <PriorityBadge priority={project.priority} />}
                {project && (
                  <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDot[project.status]}`} />{project.status}
                  </span>
                )}
                {project?.visibility === "private" && <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"><Lock className="h-3 w-3" /> Private</span>}
                {project && (
                  <button type="button" aria-label={project.isFavorite ? "Remove from favorites" : "Add to favorites"} title="Favorite" className="rounded-md p-1 hover:bg-secondary" onClick={async () => (await attempt(() => api.post(`/projects/${projectId}/favorite`))) && refresh()}>
                    <Star className={cn("h-4 w-4", project.isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                  </button>
                )}
              </div>
              {project?.description && <p className="line-clamp-2 max-w-3xl text-sm text-muted-foreground">{project.description}</p>}
              {project && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  {project.managerId && <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{project.managerId.name}</span>}
                  {(project.startDate || project.endDate) && (
                    <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{project.startDate ? formatDate(project.startDate) : "…"} → {project.endDate ? formatDate(project.endDate) : "…"}</span>
                  )}
                  {project.clientName && <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{project.clientName}</span>}
                  {members.length > 0 && (
                    <span className="flex items-center gap-2">
                      <span className="flex -space-x-2">
                        {members.slice(0, 5).map((m) => (
                          <Avatar key={m._id} className="h-6 w-6 border-2 border-background" title={m.name}><AvatarImage src={m.profileImage} /><AvatarFallback className="text-[9px]">{initials(m.name)}</AvatarFallback></Avatar>
                        ))}
                      </span>
                      {members.length > 5 ? `+${members.length - 5}` : `${members.length} ${members.length === 1 ? "member" : "members"}`}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {hc && (
              <span className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", hc.cls)} title={health!.reasons.join(", ")}>
                <hc.icon className="h-3.5 w-3.5" />{hc.label}
              </span>
            )}
            {isAdmin && can("projects.edit") && <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
          </div>
        </div>

        {health && health.reasons.length > 0 && health.state !== "ON_TRACK" && (
          <div className="mt-3 flex flex-wrap gap-1.5">{health.reasons.map((r) => <span key={r} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{r}</span>)}</div>
        )}
      </div>

      {/* --------------------- menu: groups on top, tabs of the group below --------------------- */}
      <div className="sticky top-0 z-20 border-y border-border bg-background/95 backdrop-blur">
        <nav aria-label="Project sections" className="flex gap-0.5 overflow-x-auto px-3 md:px-5">
          {groups.map((g) => {
            const Icon = GROUP_ICONS[g.key] || MoreHorizontal;
            const on = active?.key === g.key;
            return (
              <button
                key={g.key}
                type="button"
                title={g.label}
                aria-current={on ? "page" : undefined}
                onClick={() => (on ? undefined : openGroup(g))}
                className={cn("flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors", on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                <Icon className={cn("h-4 w-4", on && "text-primary")} />
                <span className="hidden sm:inline">{g.label}</span>
              </button>
            );
          })}
        </nav>

        {active && active.items.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-t border-border bg-secondary/30 px-4 py-2 md:px-6">
            {active.items.map((i) => {
              const Icon = TAB_ICONS[i.to] || LayoutDashboard;
              const on = i.to === tab;
              return (
                <Link
                  key={i.to}
                  to={`${base}/${i.to}`}
                  aria-current={on ? "page" : undefined}
                  className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors", on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground")}
                >
                  <Icon className="h-3.5 w-3.5" />{i.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {blocked ? <NoAccess page={current?.label} workspaceId={workspaceId} next={nextTab ? `projects/${projectId}/${nextTab}` : "projects"} /> : <Outlet />}
      {project && <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} workspaceId={workspaceId} project={project} />}
    </div>
  );
}