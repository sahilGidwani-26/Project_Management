import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { DepartmentGroup, Project, WorkspaceRole } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { FormDialog, Field } from "@/components/common/FormDialog";
import { MemberAvatar, RoleBadge } from "@/components/people/peopleUi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isManagerRole } from "@/lib/people";
import { cn } from "@/lib/utils";

const PROJECT_ROLES = [["MEMBER", "Member"], ["VIEWER", "Viewer"], ["ADMIN", "Project admin"]] as const;

function AddToProjectDialog({ group, workspaceId, onClose }: { group: DepartmentGroup | null; workspaceId: string; onClose: () => void }) {
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: projects } = useQuery({
    queryKey: ["projects-picker", workspaceId],
    queryFn: async () => (await api.get(`/projects/workspace/${workspaceId}?limit=100`)).data.data as Project[],
    enabled: !!group,
  });

  useEffect(() => {
    if (group) { setProjectId(""); setRole("MEMBER"); setPicked(new Set(group.members.map((m) => m.userId))); }
  }, [group]);

  if (!group) return null;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/workspaces/${workspaceId}/members/add-to-project`, { projectId, role, userIds: [...picked] });
      const d = res.data.data;
      toast.success(res.data.message);
      if (d.alreadyInProject) toast.info(`${d.alreadyInProject} were already in the project`);
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  return (
    <FormDialog open onOpenChange={(v) => !v && onClose()} title={`Add ${group.name || "these people"} to a project`} onSubmit={submit} busy={busy} disabled={!projectId || picked.size === 0} submitLabel={`Add ${picked.size} to project`}>
      <Field label="Project">
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger><SelectValue placeholder="Choose a project" /></SelectTrigger>
          <SelectContent>{projects?.map((p) => <SelectItem key={p._id} value={p._id}>{p.icon || "📁"} {p.name}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Their role in the project">
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PROJECT_ROLES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="space-y-1">
        <p className="text-sm font-medium">People ({picked.size} of {group.members.length})</p>
        <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
          {group.members.map((m) => (
            <label key={m.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/50">
              <input type="checkbox" checked={picked.has(m.userId)} onChange={() => toggle(m.userId)} />
              <MemberAvatar name={m.name} image={m.profileImage} className="h-6 w-6" />
              <span className="flex-1 truncate">{m.name}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">People already in the project are skipped. Everyone added gets an email.</p>
      </div>
    </FormDialog>
  );
}

export default function TeamDepartments() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const myRole = currentWorkspace?.myRole as WorkspaceRole | undefined;
  const manager = isManagerRole(myRole);
  const [adding, setAdding] = useState<DepartmentGroup | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["departments", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/departments`)).data.data as DepartmentGroup[],
    enabled: !!workspaceId,
  });

  const groups = data || [];
  const onlyNone = groups.length === 1 && groups[0].key === "";

  return (
    <div>
      <PageHeader
        title="Departments"
        description="People grouped by the department in their profile"
        actions={<Button size="sm" variant="outline" asChild><Link to={`/app/${workspaceId}/team`}>← Team</Link></Button>}
      />
      <div className="space-y-4 p-6">
        {isLoading && <div className="grid gap-4 md:grid-cols-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>}
        {!isLoading && !groups.length && <EmptyState icon={Building2} title="No people yet" description="Add members first, then give them a department." />}
        {onlyNone && <p className="rounded-md bg-secondary px-3 py-2 text-sm">Nobody has a department yet. Open a person's profile, choose <b>Edit profile</b> and fill in <b>Department</b>, or set it when you add or import people.</p>}

        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.key || "none"}><CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{g.name || "No department"}</h3>
                  <p className="text-xs text-muted-foreground">
                    {g.count} {g.count === 1 ? "person" : "people"}
                    {manager && g.openTasks != null ? ` · ${g.openTasks} open tasks` : ""}
                    {manager && g.overdue ? <span className="text-destructive"> · {g.overdue} overdue</span> : null}
                  </p>
                </div>
                {manager && <Button size="sm" variant="outline" onClick={() => setAdding(g)}>Add to project</Button>}
              </div>
              <div className="divide-y divide-border">
                {g.members.map((m) => (
                  <button key={m.memberId} type="button" onClick={() => navigate(`/app/${workspaceId}/team/${m.memberId}`)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-secondary/30">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <MemberAvatar name={m.name} image={m.profileImage} className="h-8 w-8" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{m.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{m.designation || m.email}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {manager && m.openTasks != null && <span className={cn("text-xs", m.openTasks > 8 ? "text-amber-600" : "text-muted-foreground")}>{m.openTasks} open</span>}
                      <RoleBadge role={m.role} />
                    </span>
                  </button>
                ))}
              </div>
            </CardContent></Card>
          ))}
        </div>
      </div>

      <AddToProjectDialog group={adding} workspaceId={workspaceId!} onClose={() => setAdding(null)} />
    </div>
  );
}