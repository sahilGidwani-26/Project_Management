import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, UserPlus, X } from "lucide-react";
import { api } from "@/lib/api";
import { InvitationItem, WorkspaceMember, WorkspaceRole } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { AddMemberDialog } from "@/components/people/AddMemberDialog";
import { MemberAvatar, RoleBadge, StatusPills } from "@/components/people/peopleUi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EMPLOYMENT, ROLES, copyText, employmentLabel, isAdminRole, roleLabel } from "@/lib/people";
import { cn, formatDate } from "@/lib/utils";
import { Users } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BulkImportDialog } from "@/components/people/BulkImportDialog";
import { attempt, downloadFromApi, timeAgo } from "@/lib/projectMeta";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/hooks/useRoles";

type View = "grid" | "table";

const Stat = ({ label, value, cls }: { label: string; value: number; cls?: string }) => (
  <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p></CardContent></Card>
);

export default function WorkspaceTeam() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const myRole = currentWorkspace?.myRole as WorkspaceRole | undefined;
  const admin = isAdminRole(myRole);
  const { can } = usePermissions();
  const { roles } = useRoles(workspaceId);
  const roleOptions: [string, string][] = roles ? roles.map((r) => [r._id, r.name]) : ROLES.map((r) => [r, roleLabel(r)]);

  const [view, setView] = useState<View>(() => (localStorage.getItem("fb_team_view") as View) || "grid");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [dept, setDept] = useState("all");
  const [emp, setEmp] = useState("all");
  const [status, setStatus] = useState("active");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => localStorage.setItem("fb_team_view", view), [view]);

  // admins also see deactivated people (key differs from the plain ["members", id] list used by pickers elsewhere)
  const { data: members, isLoading } = useQuery({
    queryKey: ["team-members", workspaceId, admin],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/members${admin ? "?status=all" : ""}`)).data.data as WorkspaceMember[],
    enabled: !!workspaceId && !!myRole,
  });

  const { data: invitations } = useQuery({
    queryKey: ["invitations", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/invitations`)).data.data as InvitationItem[],
    enabled: !!workspaceId && admin,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["team-members", workspaceId] });
    qc.invalidateQueries({ queryKey: ["members", workspaceId] });
    qc.invalidateQueries({ queryKey: ["invitations", workspaceId] });
    qc.invalidateQueries({ queryKey: ["departments", workspaceId] });
  };

  const all = members || [];
  const departments = useMemo(() => [...new Set(all.map((m) => m.profile?.department).filter(Boolean) as string[])].sort(), [all]);

  const q = search.trim().toLowerCase();
  const list = all.filter((m) => {
    if (status === "active" && m.status !== "active") return false;
    if (status === "deactivated" && m.status !== "deactivated") return false;
    if (role !== "all" && m.roleRefId !== role && m.role !== role) return false;
    if (dept !== "all" && m.profile?.department !== dept) return false;
    if (emp !== "all" && m.profile?.employmentType !== emp) return false;
    if (q && ![m.userId.name, m.userId.email, m.profile?.designation, m.profile?.company, m.profile?.department].some((v) => v?.toLowerCase().includes(q))) return false;
    return true;
  });

  const active = all.filter((m) => m.status === "active");
  const filtered = !!q || role !== "all" || dept !== "all" || emp !== "all" || status !== "active";
  const go = (m: WorkspaceMember) => navigate(`/app/${workspaceId}/team/${m._id}`);
  const base = `/workspaces/${workspaceId}/invitations`;

  return (
    <div>
      <PageHeader
        title="Team"
        description="People, roles and progress in this workspace"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can("roles.view") && <Button size="sm" variant="outline" asChild><Link to={`/app/${workspaceId}/roles`}>Roles</Link></Button>}
            <Button size="sm" variant="outline" asChild><Link to={`/app/${workspaceId}/team/departments`}>Departments</Link></Button>
            <Button size="sm" variant="outline" asChild><Link to={`/app/${workspaceId}/team/org-chart`}>Org chart</Link></Button>
            {admin && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const priv = window.confirm("Include private details (phone, address, date of birth) in the file?\n\nOK = include them. Cancel = work details only.");
                    attempt(() => downloadFromApi(`/workspaces/${workspaceId}/members/export${priv ? "?private=1" : ""}`, "team.csv"));
                  }}
                >
                  Export CSV
                </Button>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>Import CSV</Button>
                <Button size="sm" onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" /> Add member</Button>
              </>
            )}
          </div>
        }
      />

      <div className="space-y-6 p-6">
        {admin && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active members" value={active.length} />
            <Stat label="Owners & admins" value={active.filter((m) => isAdminRole(m.role)).length} />
            <Stat label="Pending invitations" value={invitations?.length || 0} cls={invitations?.length ? "text-amber-600" : ""} />
            <Stat label="Deactivated" value={all.filter((m) => m.status === "deactivated").length} />
          </div>
        )}

        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, designation…" className="pl-8" />
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Role" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All roles</SelectItem>{roleOptions.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          {!!departments.length && (
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All departments</SelectItem>{departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select value={emp} onValueChange={setEmp}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All types</SelectItem>{EMPLOYMENT.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          {admin && (
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="deactivated">Deactivated</SelectItem>
                <SelectItem value="all">Everyone</SelectItem>
              </SelectContent>
            </Select>
          )}
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setRole("all"); setDept("all"); setEmp("all"); setStatus("active"); }}><X className="h-3.5 w-3.5" /> Clear</Button>}
          <div className="ml-auto flex rounded-md border border-border p-0.5">
            {([["grid", "Cards"], ["table", "Table"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={cn("rounded px-3 py-1 text-xs font-medium", view === v ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
        </div>

        {isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>}
        {!isLoading && !list.length && <EmptyState icon={Users} title={filtered ? "No one matches" : "No members yet"} description={filtered ? "Try changing or clearing the filters." : "Add your first teammate."} />}

        {/* cards */}
        {!!list.length && view === "grid" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((m) => {
              const title = m.profile?.designation || m.userId.jobTitle;
              return (
                <Card key={m._id} onClick={() => go(m)} className={cn("cursor-pointer transition-shadow hover:shadow-md", m.status === "deactivated" && "opacity-60")}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start gap-3">
                      <MemberAvatar name={m.userId.name} image={m.userId.profileImage} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.userId.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{title || m.userId.email}</p>
                        {title && <p className="truncate text-xs text-muted-foreground">{m.userId.email}</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <RoleBadge role={m.role} name={m.roleName} color={m.roleColor} />
                      <StatusPills m={m} />
                      {m.profile?.employmentType && <Badge variant="outline" className="text-[10px]">{employmentLabel(m.profile.employmentType)}</Badge>}
                    </div>
                    {(m.profile?.department || m.profile?.company) && (
                      <p className="truncate text-xs text-muted-foreground">{[m.profile?.department, m.profile?.company].filter(Boolean).join(" · ")}</p>
                    )}
                    {admin && m.userId.lastLoginAt && <p className="text-[11px] text-muted-foreground">Last login {timeAgo(m.userId.lastLoginAt)}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* table */}
        {!!list.length && view === "table" && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-xs text-muted-foreground">
                <tr>{["Name", "Role", "Designation", "Department", "Company", "Type", "Joined", ...(admin ? ["Last login"] : [])].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((m) => (
                  <tr key={m._id} onClick={() => go(m)} className={cn("cursor-pointer hover:bg-secondary/30", m.status === "deactivated" && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <MemberAvatar name={m.userId.name} image={m.userId.profileImage} className="h-7 w-7" />
                        <div><p className="font-medium">{m.userId.name}</p><p className="text-xs text-muted-foreground">{m.userId.email}</p></div>
                        <StatusPills m={m} />
                      </div>
                    </td>
                    <RoleBadge role={m.role} name={m.roleName} color={m.roleColor} />
                    <td className="px-4 py-2.5 text-xs">{m.profile?.designation || m.userId.jobTitle || "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{m.profile?.department || "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{m.profile?.company || "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{employmentLabel(m.profile?.employmentType) || "—"}</td>
                    <td className="px-4 py-2.5 text-xs">{m.joinedAt ? formatDate(m.joinedAt) : "—"}</td>
                    {admin && <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.userId.lastLoginAt ? timeAgo(m.userId.lastLoginAt) : "never"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* pending invitations */}
        {admin && !!invitations?.length && (
          <section className="space-y-2">
            <h3 className="font-medium">Pending invitations</h3>
            <Card><CardContent className="divide-y divide-border p-0">
              {invitations.map((i) => (
                <div key={i._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{i.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {roleLabel(i.role)} · invited {timeAgo(i.createdAt)}{i.invitedBy ? ` by ${i.invitedBy.name}` : ""} · expires {formatDate(i.expiresAt)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => copyText(`${window.location.origin}/invitations/${i.token}`, "Invitation link copied")}>Copy link</Button>
                    <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.post(`${base}/${i._id}/resend`), "Invitation sent again")) && refresh()}>Resend</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm(`Cancel the invitation for ${i.email}?`) && (await attempt(() => api.delete(`${base}/${i._id}`), "Invitation cancelled")) && refresh()}>Cancel</Button>
                  </div>
                </div>
              ))}
            </CardContent></Card>
          </section>
        )}


        {can("roles.view") && (
          <p className="text-sm text-muted-foreground">
            To see or change what each role can do, open{" "}
            <Link
              to={`/app/${workspaceId}/roles`}
              className="text-primary hover:underline"
            >
              Roles &amp; permissions
            </Link>.
          </p>
        )}

      </div>

      <AddMemberDialog open={addOpen} onOpenChange={setAddOpen} workspaceId={workspaceId!} myRole={myRole} onDone={refresh} />
      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} workspaceId={workspaceId!} onDone={refresh} />
    </div>
  );
}