import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { Task } from "@/types";
import { useProject } from "@/hooks/useProject";
import { usePermissions } from "@/hooks/usePermissions";
import { StatusBadge } from "@/components/common/StatusBadge";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { CreateTaskDialog } from "@/components/tasks/CreateTaskDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { severityCls } from "@/lib/projectMeta";
import { cn, formatDate, initials } from "@/lib/utils";

// Bug severity -> badge colours (Minor/Major/Critical reuse the Low/High/Critical styles)
const sevStyle: Record<string, string> = { Minor: severityCls.Low, Major: severityCls.High, Critical: severityCls.Critical };

const STAGES: [string, string][] = [
  ["open", "Open (not closed)"],
  ["new", "New (Todo / Backlog)"],
  ["progress", "Being fixed"],
  ["qa", "Awaiting QA"],
  ["closed", "Closed"],
  ["all", "All"],
];

const inStage = (t: Task, stage: string) => {
  switch (stage) {
    case "open": return t.status !== "Done";
    case "new": return t.status === "Todo" || t.status === "Backlog";
    case "progress": return t.status === "In Progress";
    case "qa": return t.status === "In Review";
    case "closed": return t.status === "Done";
    default: return true;
  }
};

const Stat = ({ label, value, cls }: { label: string; value: number; cls?: string }) => (
  <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p></CardContent></Card>
);

export default function ProjectBugs() {
  const { workspaceId, projectId } = useProject();
  const { canCreateTask } = usePermissions();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [stage, setStage] = useState("open");
  const [selected, setSelected] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // key starts with "tasks-list" so every task create/update elsewhere refreshes this list too
  const { data, isLoading } = useQuery({
    queryKey: ["tasks-list", projectId, "bugs"],
    queryFn: async () => (await api.get(`/tasks?projectId=${projectId}&type=Bug&limit=200&sort=created`)).data.data as Task[],
    enabled: !!projectId,
  });

  const bugs = data || [];
  const open = bugs.filter((t) => t.status !== "Done");
  const list = bugs.filter(
    (t) =>
      inStage(t, stage) &&
      (severity === "all" || t.bugDetails?.severity === severity) &&
      (!search.trim() || t.title.toLowerCase().includes(search.trim().toLowerCase()))
  );

  return (
    <div className="space-y-4 p-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open bugs" value={open.length} />
        <Stat label="Critical (open)" value={open.filter((t) => t.bugDetails?.severity === "Critical").length} cls={open.some((t) => t.bugDetails?.severity === "Critical") ? "text-destructive" : ""} />
        <Stat label="Awaiting QA" value={bugs.filter((t) => t.status === "In Review").length} cls="text-violet-600" />
        <Stat label="Closed" value={bugs.filter((t) => t.status === "Done").length} cls="text-emerald-600" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bugs..." className="pl-8" />
        </div>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{STAGES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {["Critical", "Major", "Minor"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {canCreateTask && <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>🐛 Report bug</Button>}
      </div>

      {isLoading && <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}

      {!isLoading && !list.length && (
        <p className="text-sm text-muted-foreground">
          {bugs.length ? "No bugs match these filters." : "No bugs reported yet. Use “Report bug” or set a task's Type to Bug."}
        </p>
      )}

      {!!list.length && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs text-muted-foreground">
              <tr>{["ID", "Bug", "Severity", "Status", "Assignees", "Found in", "Fixed in", "Reported by", "Created"].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((t) => (
                <tr key={t._id} className="cursor-pointer hover:bg-secondary/30" onClick={() => setSelected(t)}>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</td>
                  <td className="px-4 py-2.5 font-medium">{t.title}</td>
                  <td className="px-4 py-2.5">
                    {t.bugDetails?.severity ? <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", sevStyle[t.bugDetails.severity])}>{t.bugDetails.severity}</span> : "—"}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
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
                    ) : <span className="text-xs text-muted-foreground">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{t.bugDetails?.foundInVersion || "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{t.bugDetails?.fixedInVersion || "—"}</td>
                  <td className="px-4 py-2.5 text-xs">{t.reporterId?.name || "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <TaskDetailDialog task={selected} open onOpenChange={(v) => !v && setSelected(null)} />}
      {createOpen && (
        <CreateTaskDialog workspaceId={workspaceId} projectId={projectId} defaultType="Bug" open={createOpen} onOpenChange={setCreateOpen} />
      )}
    </div>
  );
}