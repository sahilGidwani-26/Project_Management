import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DragDropContext, Draggable, Droppable, DropResult } from "@hello-pangea/dnd";
import { FolderKanban, Plus, Search, Star, X } from "lucide-react";
import { api } from "@/lib/api";
import { Project } from "@/types";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { PriorityBadge } from "@/components/common/PriorityBadge";
import { SimpleMenu } from "@/components/common/SimpleMenu";
import { Gantt } from "@/components/common/Gantt";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES, PRIORITIES, PROJECT_STATUSES, attempt, statusDot } from "@/lib/projectMeta";
import { cn, formatDate, initials, isOverdue } from "@/lib/utils";

type View = "grid" | "list" | "board" | "timeline";
const VIEWS: [View, string][] = [["grid", "Grid"], ["list", "List"], ["board", "Board"], ["timeline", "Timeline"]];
const SORTS: [string, string][] = [["newest", "Newest"], ["oldest", "Oldest"], ["name", "Name"], ["due", "Due date"], ["progress", "Progress"], ["priority", "Priority"]];

function AvatarStack({ users, max = 3 }: { users: Project["members"]; max?: number }) {
  if (!users?.length) return null;
  return (
    <div className="flex -space-x-2">
      {users.slice(0, max).map((u) => (
        <Avatar key={u._id} className="h-6 w-6 border-2 border-card" title={u.name}>
          <AvatarImage src={u.profileImage} />
          <AvatarFallback className="text-[9px]">{initials(u.name)}</AvatarFallback>
        </Avatar>
      ))}
      {users.length > max && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-secondary text-[9px] font-medium">+{users.length - max}</span>}
    </div>
  );
}

const DueBadge = ({ p }: { p: Project }) =>
  p.endDate ? (
    <span className={cn("text-[11px] text-muted-foreground", isOverdue(p.endDate) && !["Completed", "Cancelled", "Archived"].includes(p.status) && "font-medium text-destructive")}>
      Due {formatDate(p.endDate)}
    </span>
  ) : null;

export default function Projects() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { canCreateProject } = usePermissions();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [view, setView] = useState<View>(() => (localStorage.getItem("fb_projects_view") as View) || "grid");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("newest");
  const [favOnly, setFavOnly] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => localStorage.setItem("fb_projects_view", view), [view]);
  useEffect(() => setSel(new Set()), [archived, status, q]);

  const { data, isLoading } = useQuery({
    queryKey: ["projects", workspaceId, { q, status, priority, category, sort, favOnly, archived }],
    queryFn: async () => {
      const sp = new URLSearchParams({ limit: "200", sort });
      if (q) sp.set("search", q);
      if (status !== "all") sp.set("status", status);
      if (priority !== "all") sp.set("priority", priority);
      if (category !== "all") sp.set("category", category);
      if (favOnly) sp.set("favorite", "true");
      if (archived) sp.set("archived", "true");
      return (await api.get(`/projects/workspace/${workspaceId}?${sp}`)).data.data as Project[];
    },
    enabled: !!workspaceId,
  });
  const projects = data || [];
  const filtered = !!q || status !== "all" || priority !== "all" || category !== "all" || favOnly;

  const refresh = () => qc.invalidateQueries({ queryKey: ["projects", workspaceId] });
  const run = async (fn: () => Promise<unknown>, ok: string) => { if (await attempt(fn, ok)) refresh(); };
  const open = (p: Project) => navigate(`/app/${workspaceId}/projects/${p._id}/overview`);

  const toggleFav = (p: Project) => run(() => api.post(`/projects/${p._id}/favorite`), p.isFavorite ? "Removed from favorites" : "Added to favorites");
  const archive = (p: Project) => run(() => api.post(`/projects/${p._id}/archive`), "Project archived");
  const restore = (p: Project) => run(() => api.post(`/projects/${p._id}/restore`), "Project restored");
  const duplicate = (p: Project) => run(() => api.post(`/projects/${p._id}/duplicate`, {}), "Project duplicated");
  const remove = (p: Project) => window.confirm(`Delete "${p.name}" and all its tasks? This cannot be undone.`) && run(() => api.delete(`/projects/${p._id}`), "Project deleted");
  const bulk = async (action: string, extra: object = {}) => {
    await run(() => api.post(`/projects/bulk/${action === "delete" ? "delete" : "update"}`, { workspaceId, ids: [...sel], action, ...extra }), "Done");
    setSel(new Set());
  };

  const menuFor = (p: Project) => [
    { label: "Open", onClick: () => open(p) },
    { label: p.isFavorite ? "Remove favorite" : "Add to favorites", onClick: () => toggleFav(p) },
    { label: "Edit", onClick: () => setEditing(p), hidden: !canCreateProject },
    { label: "Duplicate", onClick: () => duplicate(p), hidden: !canCreateProject },
    p.status === "Archived"
      ? { label: "Restore", onClick: () => restore(p), hidden: !canCreateProject }
      : { label: "Archive", onClick: () => archive(p), hidden: !canCreateProject },
    { label: "Delete", onClick: () => remove(p), danger: true, hidden: !canCreateProject },
  ];

  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const Check = ({ p }: { p: Project }) =>
    canCreateProject ? (
      <input type="checkbox" checked={sel.has(p._id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(p._id)} className="h-4 w-4" aria-label={`Select ${p.name}`} />
    ) : null;

  const columns = useMemo(() => {
    const m: Record<string, Project[]> = {};
    PROJECT_STATUSES.forEach((s) => (m[s] = []));
    projects.forEach((p) => m[p.status]?.push(p));
    return m;
  }, [projects]);

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return;
    run(() => api.patch(`/projects/${r.draggableId}`, { status: r.destination!.droppableId }), "Status updated");
  };

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Everything your team is working on"
        actions={canCreateProject ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New project</Button> : undefined}
      />

      <div className="space-y-4 p-6">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects, tags, clients…" className="pl-8" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All priorities</SelectItem>{PRIORITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All categories</SelectItem>{CATEGORIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{SORTS.map(([v, l]) => <SelectItem key={v} value={v}>Sort: {l}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant={favOnly ? "secondary" : "outline"} size="sm" onClick={() => setFavOnly((v) => !v)}><Star className={cn("h-3.5 w-3.5", favOnly && "fill-amber-400 text-amber-400")} /> Favorites</Button>
          <Button variant={archived ? "secondary" : "outline"} size="sm" onClick={() => setArchived((v) => !v)}>Archived</Button>
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatus("all"); setPriority("all"); setCategory("all"); setFavOnly(false); }}><X className="h-3.5 w-3.5" /> Clear</Button>}
          <div className="ml-auto flex rounded-md border border-border p-0.5">
            {VIEWS.map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={cn("rounded px-3 py-1 text-xs font-medium", view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
        </div>

        {/* bulk bar */}
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">{sel.size} selected</span>
            {archived ? <Button size="sm" variant="outline" onClick={() => bulk("restore")}>Restore</Button> : <Button size="sm" variant="outline" onClick={() => bulk("archive")}>Archive</Button>}
            <Select onValueChange={(v) => bulk("status", { status: v })}>
              <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Set status…" /></SelectTrigger>
              <SelectContent>{PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => window.confirm(`Delete ${sel.size} project(s) and all their tasks?`) && bulk("delete")}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
          </div>
        )}

        {isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>}

        {!isLoading && !projects.length && (
          <EmptyState
            icon={FolderKanban}
            title={filtered || archived ? "No projects match" : "No projects yet"}
            description={filtered || archived ? "Try changing or clearing the filters." : canCreateProject ? "Create your first project to start organizing tasks with your team." : "No projects have been created in this workspace yet."}
            actionLabel={!filtered && !archived && canCreateProject ? "New project" : undefined}
            onAction={!filtered && !archived && canCreateProject ? () => setCreateOpen(true) : undefined}
          />
        )}

        {/* GRID */}
        {!!projects.length && view === "grid" && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Card key={p._id} className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md" onClick={() => open(p)}>
                <div className="h-1.5" style={{ background: p.color }} />
                {p.coverImage && <img src={p.coverImage} alt="" className="h-24 w-full object-cover" loading="lazy" />}
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Check p={p} />
                      <span className={`h-2 w-2 rounded-full ${statusDot[p.status]}`} />
                      <span className="text-xs text-muted-foreground">{p.status}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <PriorityBadge priority={p.priority} />
                      <button onClick={(e) => { e.stopPropagation(); toggleFav(p); }} aria-label="Favorite"><Star className={cn("h-4 w-4", p.isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} /></button>
                      <SimpleMenu trigger={<span className="px-1 text-lg leading-none">⋯</span>} items={menuFor(p)} />
                    </div>
                  </div>
                  <h3 className="mt-3 flex items-center gap-2 font-semibold"><span>{p.icon || "📁"}</span>{p.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description || "No description"}</p>
                  {!!p.tags?.length && <div className="mt-2 flex flex-wrap gap-1">{p.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>}
                  <div className="mt-4">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${p.progress}%` }} /></div>
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{p.progress}% · {p.taskStats?.done ?? 0}/{p.taskStats?.total ?? 0} tasks{!!p.taskStats?.overdue && <span className="text-destructive"> · {p.taskStats.overdue} overdue</span>}</span>
                      <DueBadge p={p} />
                    </div>
                  </div>
                  <div className="mt-3"><AvatarStack users={p.members} /></div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* LIST */}
        {!!projects.length && view === "list" && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>{["", "Project", "Status", "Priority", "Progress", "Manager", "Team", "Due", ""].map((h, i) => <th key={i} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projects.map((p) => (
                  <tr key={p._id} className="cursor-pointer hover:bg-secondary/30" onClick={() => open(p)}>
                    <td className="px-4 py-2.5"><Check p={p} /></td>
                    <td className="px-4 py-2.5 font-medium"><span className="mr-2">{p.icon || "📁"}</span>{p.name}{p.isFavorite && <Star className="ml-1.5 inline h-3 w-3 fill-amber-400 text-amber-400" />}</td>
                    <td className="px-4 py-2.5"><span className="flex items-center gap-1.5 text-xs"><span className={`h-2 w-2 rounded-full ${statusDot[p.status]}`} />{p.status}</span></td>
                    <td className="px-4 py-2.5"><PriorityBadge priority={p.priority} /></td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${p.progress}%` }} /></div><span className="text-xs text-muted-foreground">{p.progress}%</span></div></td>
                    <td className="px-4 py-2.5 text-xs">{p.managerId?.name || "—"}</td>
                    <td className="px-4 py-2.5"><AvatarStack users={p.members} /></td>
                    <td className="px-4 py-2.5"><DueBadge p={p} /></td>
                    <td className="px-4 py-2.5"><SimpleMenu trigger={<span className="px-1 text-lg leading-none">⋯</span>} items={menuFor(p)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* BOARD */}
        {!!projects.length && view === "board" && (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {PROJECT_STATUSES.map((s) => (
                <div key={s} className="flex w-72 shrink-0 flex-col rounded-lg bg-secondary/40">
                  <div className="flex items-center gap-2 px-3 py-2.5"><span className={`h-2 w-2 rounded-full ${statusDot[s]}`} /><span className="text-sm font-semibold">{s}</span><span className="text-xs text-muted-foreground">{columns[s].length}</span></div>
                  <Droppable droppableId={s}>
                    {(prov, snap) => (
                      <div ref={prov.innerRef} {...prov.droppableProps} className={cn("min-h-[120px] flex-1 space-y-2 px-2 pb-2", snap.isDraggingOver && "rounded-md bg-primary/5")}>
                        {columns[s].map((p, i) => (
                          <Draggable key={p._id} draggableId={p._id} index={i} isDragDisabled={!canCreateProject}>
                            {(dp, ds) => (
                              <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} onClick={() => open(p)} className={cn("cursor-pointer rounded-lg border border-border bg-card p-3 shadow-sm", ds.isDragging && "shadow-lg ring-2 ring-primary/40")}>
                                <div className="flex items-center justify-between"><span className="text-sm font-medium">{p.icon || "📁"} {p.name}</span><PriorityBadge priority={p.priority} /></div>
                                <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary" style={{ width: `${p.progress}%` }} /></div>
                                <div className="mt-2 flex items-center justify-between"><AvatarStack users={p.members} /><DueBadge p={p} /></div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {prov.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              ))}
            </div>
          </DragDropContext>
        )}

        {/* TIMELINE */}
        {!!projects.length && view === "timeline" && (
          <>
            <Gantt
              items={projects.map((p) => ({ id: p._id, label: `${p.icon || "📁"} ${p.name}`, sub: p.status, start: p.startDate || p.endDate, end: p.endDate || p.startDate, color: p.color, progress: p.progress, onClick: () => open(p) }))}
            />
            {projects.some((p) => !p.startDate && !p.endDate) && (
              <p className="text-xs text-muted-foreground">Not shown (no dates): {projects.filter((p) => !p.startDate && !p.endDate).map((p) => p.name).join(", ")}</p>
            )}
          </>
        )}
      </div>

      <ProjectFormDialog open={createOpen} onOpenChange={setCreateOpen} workspaceId={workspaceId!} onCreated={(id) => navigate(`/app/${workspaceId}/projects/${id}/overview`)} />
      <ProjectFormDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} workspaceId={workspaceId!} project={editing || undefined} />
    </div>
  );
}