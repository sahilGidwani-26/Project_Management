import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X, ChevronLeft, ChevronRight, ListChecks, Plus, FolderKanban } from "lucide-react";
import { api } from "@/lib/api";
import { Task, WorkspaceMember, Project } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { PriorityBadge } from "@/components/common/PriorityBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, initials, cn, isOverdue } from "@/lib/utils";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { CreateTaskDialog } from "@/components/tasks/CreateTaskDialog";
import { usePermissions } from "@/hooks/usePermissions";

const PAGE_SIZE = 20;

export default function Tasks() {
  const { workspaceId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canCreateTask } = usePermissions();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [assigneeId, setAssigneeId] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all"); // "all" | "none" | <projectId>
  const [page, setPage] = useState(1);

  const { data: members } = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/members`)).data.data as WorkspaceMember[],
    enabled: !!workspaceId,
  });

  const { data: projects } = useQuery({
    queryKey: ["projects-picker", workspaceId],
    queryFn: async () => (await api.get(`/projects/workspace/${workspaceId}?limit=100`)).data.data as Project[],
    enabled: !!workspaceId,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-tasks", workspaceId, search, status, priority, assigneeId, projectFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ workspaceId: workspaceId!, page: String(page), limit: String(PAGE_SIZE), sort: "created" });
      if (search) params.set("search", search);
      if (status !== "all") params.set("status", status);
      if (priority !== "all") params.set("priority", priority);
      if (assigneeId !== "all") params.set("assigneeId", assigneeId);
      if (projectFilter !== "all") params.set("projectId", projectFilter);
      const res = await api.get(`/tasks?${params.toString()}`);
      return res.data as { data: Task[]; pagination: { total: number; totalPages: number; page: number } };
    },
    enabled: !!workspaceId,
  });

  // If we arrived via an email link (?task=<id>), auto-open that task once loaded.
  useEffect(() => {
    const taskId = searchParams.get("task");
    if (taskId && data?.data) {
      const found = data.data.find((t) => t._id === taskId);
      if (found) {
        setSelectedTask(found);
        searchParams.delete("task");
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [data, searchParams, setSearchParams]);

  const tasks = data?.data || [];
  const pagination = data?.pagination;
  const hasFilters = search || status !== "all" || priority !== "all" || assigneeId !== "all" || projectFilter !== "all";

  const clearFilters = () => {
    setSearch(""); setStatus("all"); setPriority("all"); setAssigneeId("all"); setProjectFilter("all"); setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Every task across this workspace, with or without a project"
        actions={
          canCreateTask ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New task
            </Button>
          ) : undefined
        }
      />

      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search tasks..." className="pl-8" />
          </div>

          <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              <SelectItem value="none">No project</SelectItem>
              {projects?.map((p) => (
                <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["Backlog", "Todo", "In Progress", "In Review", "Done"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(1); }}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {["Low", "Medium", "High", "Urgent"].map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={assigneeId} onValueChange={(v) => { setAssigneeId(v); setPage(1); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Assignee" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              {members?.map((m) => (
                <SelectItem key={m.userId._id} value={m.userId._id}>{m.userId.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

        {isLoading && <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}

        {!isLoading && !tasks.length && (
          <EmptyState
            icon={ListChecks}
            title={hasFilters ? "No tasks match your filters" : "No tasks yet"}
            description={hasFilters ? "Try clearing a filter or searching something else." : "Create your first task — it doesn't need a project."}
            actionLabel={!hasFilters && canCreateTask ? "New task" : undefined}
            onAction={!hasFilters && canCreateTask ? () => setCreateOpen(true) : undefined}
          />
        )}

        {!!tasks.length && (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">ID</th>
                    <th className="px-4 py-2.5 text-left font-medium">Task</th>
                    <th className="px-4 py-2.5 text-left font-medium">Project</th>
                    <th className="px-4 py-2.5 text-left font-medium">Assignees</th>
                    <th className="px-4 py-2.5 text-left font-medium">Priority</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">Due date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tasks.map((t) => (
                    <tr key={t._id} className="cursor-pointer hover:bg-secondary/30" onClick={() => setSelectedTask(t)}>
                      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">TASK-{t.taskNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{t.title}</td>
                      <td className="px-4 py-2.5">
                        {t.projectId ? (
                          <Badge variant="outline" className="gap-1">
                            <FolderKanban className="h-3 w-3" /> {t.projectId.name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No project</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {t.assigneeIds?.length ? (
                          <div className="flex -space-x-2">
                            {t.assigneeIds.slice(0, 3).map((a) => (
                              <Avatar key={a._id} className="h-6 w-6 border-2 border-card" title={a.name}>
                                <AvatarImage src={a.profileImage} />
                                <AvatarFallback className="text-[9px]">{initials(a.name)}</AvatarFallback>
                              </Avatar>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5"><PriorityBadge priority={t.priority} /></td>
                      <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                      <td className={cn("px-4 py-2.5 text-xs", isOverdue(t.dueDate) && t.status !== "Done" && "text-destructive font-medium")}>
                        {t.dueDate ? formatDate(t.dueDate) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination && pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>Page {pagination.page} of {pagination.totalPages} — {pagination.total} tasks</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedTask && (
        <TaskDetailDialog task={selectedTask} open={!!selectedTask} onOpenChange={(v) => !v && setSelectedTask(null)} />
      )}
      {createOpen && workspaceId && (
        <CreateTaskDialog workspaceId={workspaceId} open={createOpen} onOpenChange={setCreateOpen} />
      )}
    </div>
  );
}