import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { MemberDetail as Detail, MemberProgress, WorkspaceMember, WorkspaceRole } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceMembers } from "@/hooks/useProject";
import { EditProfileDialog } from "@/components/people/EditProfileDialog";
import { CredentialsDialog, MemberAvatar, RoleBadge } from "@/components/people/peopleUi";
import { WeeklyBars } from "@/components/forecast/forecastUi";
import { FormDialog } from "@/components/common/FormDialog";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignableRoles, employmentLabel, roleLabel } from "@/lib/people";
import { attempt, fmtMinutes, taskStatusColor, timeAgo } from "@/lib/projectMeta";
import { cn, formatDate } from "@/lib/utils";

const Row = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="text-right">{value || "—"}</span>
  </div>
);

const Stat = ({ label, value, sub, cls }: { label: string; value: string | number; sub?: string; cls?: string }) => (
  <Card><CardContent className="p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
  </CardContent></Card>
);

/* -------------------------- hand over tasks dialog -------------------------- */

function ReassignDialog({
  open, onOpenChange, title, intro, submitLabel, openTasks, candidates, busy, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  intro: string;
  submitLabel: string;
  openTasks: number;
  candidates: WorkspaceMember[];
  busy: boolean;
  onConfirm: (reassignTo?: string) => void;
}) {
  const [target, setTarget] = useState("none");
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} submitLabel={submitLabel} busy={busy} onSubmit={() => onConfirm(target === "none" ? undefined : target)}>
      <p className="text-sm text-muted-foreground">{intro}</p>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Open tasks ({openTasks}) go to</p>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nobody (leave them assigned)</SelectItem>
            {candidates.map((m) => <SelectItem key={m._id} value={m._id}>{m.userId.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {openTasks > 0 && target === "none" && <p className="text-xs text-amber-600">Tasks left assigned to someone who cannot work will be forgotten. Handing them over is safer.</p>}
      </div>
    </FormDialog>
  );
}

/* --------------------------------- progress --------------------------------- */

const actionText = (a: MemberProgress["recent"][number]) => `${a.action.replace(/_/g, " ")}${a.metadata?.title ? ` · ${a.metadata.title}` : ""}`;

function ProgressTab({ workspaceId, memberId }: { workspaceId: string; memberId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["member-progress", workspaceId, memberId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/members/${memberId}/progress`)).data.data as MemberProgress,
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data) return <p className="text-sm text-destructive">Could not load progress.</p>;
  const s = data.summary;
  const taskHref = (t: MemberProgress["upcoming"][number]) => (t.projectId ? `/app/${workspaceId}/projects/${t.projectId}/board?task=${t._id}` : `/app/${workspaceId}/tasks?task=${t._id}`);
  const maxStatus = Math.max(1, ...Object.values(data.workload.byStatus));

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Counted from tasks assigned to this person. It shows workload and delivery, not a score, so use it for support and planning, not ranking.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Assigned (all time)" value={s.assigned} />
        <Stat label="Open now" value={s.open} />
        <Stat label="Completed" value={s.completed} cls="text-emerald-600" />
        <Stat label="Overdue" value={s.overdue} cls={s.overdue ? "text-destructive" : ""} />
        <Stat label="Completion rate" value={`${s.completionRate}%`} sub="of assigned tasks" />
        <Stat label="On-time rate" value={s.onTimeRate == null ? "—" : `${s.onTimeRate}%`} sub={s.onTimeSample ? `${s.onTimeSample} finished tasks with a due date` : "no finished task had a due date"} />
        <Stat label="Avg. cycle time" value={s.avgCycleDays == null ? "—" : `${s.avgCycleDays}d`} sub={s.cycleSample ? `median ${s.medianCycleDays}d · ${s.cycleSample} tasks` : "needs finished tasks"} />
        <Stat label="Done in last 30 days" value={s.completedLast30Days} />
      </div>

      <Card><CardContent className="space-y-3 p-5">
        <h3 className="font-medium">Tasks finished per week (last 8 weeks)</h3>
        <WeeklyBars weeks={data.weekly} />
      </CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardContent className="space-y-3 p-5">
          <h3 className="font-medium">Workload</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xl font-semibold">{data.workload.openTasks}</p><p className="text-xs text-muted-foreground">open tasks</p></div>
            <div><p className="text-xl font-semibold">{data.workload.estimatedMinutes ? fmtMinutes(data.workload.estimatedMinutes) : "—"}</p><p className="text-xs text-muted-foreground">estimated</p></div>
            <div><p className="text-xl font-semibold">{data.workload.dueThisWeek}</p><p className="text-xs text-muted-foreground">due this week</p></div>
          </div>
          <div className="space-y-1.5">
            {Object.entries(data.workload.byStatus).map(([st, n]) => (
              <div key={st} className="flex items-center gap-3 text-xs">
                <span className="w-24 text-muted-foreground">{st}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded bg-secondary"><div className="h-full rounded" style={{ width: `${(n / maxStatus) * 100}%`, background: taskStatusColor[st] }} /></div>
                <span className="w-5 text-right">{n}</span>
              </div>
            ))}
            {!Object.keys(data.workload.byStatus).length && <p className="text-sm text-muted-foreground">Nothing open right now.</p>}
          </div>
        </CardContent></Card>

        <Card><CardContent className="space-y-3 p-5">
          <h3 className="font-medium">Time and development</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xl font-semibold">{fmtMinutes(data.time.weekMinutes)}</p><p className="text-xs text-muted-foreground">logged in the last 7 days</p></div>
            <div><p className="text-xl font-semibold">{fmtMinutes(data.time.monthMinutes)}</p><p className="text-xs text-muted-foreground">logged in the last 30 days</p></div>
            <div><p className="text-xl font-semibold">{data.development.mergedPrs}</p><p className="text-xs text-muted-foreground">PRs merged ({data.development.days}d)</p></div>
            <div><p className="text-xl font-semibold">{data.development.commits}</p><p className="text-xs text-muted-foreground">commits ({data.development.days}d)</p></div>
          </div>
          <p className="text-[11px] text-muted-foreground">PRs and commits come from GitHub for tasks assigned to this person.</p>
        </CardContent></Card>
      </div>

      <Card><CardContent className="space-y-3 p-5">
        <h3 className="font-medium">Projects</h3>
        {!data.projects.length && <p className="text-sm text-muted-foreground">Not part of any project yet.</p>}
        <div className="divide-y divide-border">
          {data.projects.map((p) => (
            <Link key={p._id} to={`/app/${workspaceId}/projects/${p._id}/overview`} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm hover:bg-secondary/30">
              <span className="font-medium"><span className="mr-2">{p.icon || "📁"}</span>{p.name} <span className="ml-1 text-xs font-normal text-muted-foreground">· {p.role}</span></span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                {p.done}/{p.assigned} tasks done
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary"><span className="block h-full bg-primary" style={{ width: `${p.assigned ? (p.done / p.assigned) * 100 : 0}%` }} /></span>
              </span>
            </Link>
          ))}
        </div>
      </CardContent></Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardContent className="space-y-3 p-5">
          <h3 className="font-medium">Up next</h3>
          {!data.upcoming.length && <p className="text-sm text-muted-foreground">No open tasks.</p>}
          <div className="divide-y divide-border">
            {data.upcoming.map((t) => (
              <Link key={t._id} to={taskHref(t)} className="block py-2 text-sm hover:bg-secondary/30">
                <span className="mr-2 font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>{t.title}
                <p className="text-xs text-muted-foreground">
                  {t.status}{t.projectName ? ` · ${t.projectName}` : ""}
                  {t.dueDate && <span className={cn(new Date(t.dueDate).getTime() < Date.now() && "text-destructive")}> · due {formatDate(t.dueDate)}</span>}
                </p>
              </Link>
            ))}
          </div>
        </CardContent></Card>

        <Card><CardContent className="space-y-3 p-5">
          <h3 className="font-medium">Recent activity</h3>
          {!data.recent.length && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          <div className="divide-y divide-border">
            {data.recent.map((a) => (
              <div key={a._id} className="py-2 text-sm"><span className="text-muted-foreground">{actionText(a)}</span><p className="text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</p></div>
            ))}
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}

/* ----------------------------------- page ----------------------------------- */

export default function MemberDetail() {
  const { workspaceId, memberId: param } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const myRole = currentWorkspace?.myRole as WorkspaceRole | undefined;
  const { data: members } = useWorkspaceMembers(workspaceId);

  // "/team/me" is a shortcut to your own profile
  const mine = param === "me" ? members?.find((m) => m.userId.email?.toLowerCase() === user?.email?.toLowerCase()) : undefined;
  const memberId = param === "me" ? mine?._id : param;

  const { data: d, isLoading, isError } = useQuery({
    queryKey: ["member", workspaceId, memberId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/members/${memberId}`)).data.data as Detail,
    enabled: !!workspaceId && !!memberId,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<{ email: string; password: string; emailQueued: boolean } | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["member", workspaceId] });
    qc.invalidateQueries({ queryKey: ["member-progress", workspaceId] });
    qc.invalidateQueries({ queryKey: ["members", workspaceId] });
    qc.invalidateQueries({ queryKey: ["team-members", workspaceId] });
  };
  const back = () => navigate(`/app/${workspaceId}/team`);
  const base = `/workspaces/${workspaceId}/members/${memberId}`;

  if (param === "me" && members && !mine) return <div><PageHeader title="Profile" /><p className="p-6 text-sm text-muted-foreground">Could not find your profile in this workspace.</p></div>;
  if (isLoading || !memberId || !d) {
    return (
      <div>
        <PageHeader title="Member" />
        <div className="p-6">{isError ? <p className="text-sm text-destructive">Could not load this member. <button className="underline" onClick={back}>Back to team</button></p> : <Skeleton className="h-64" />}</div>
      </div>
    );
  }

  const m = d.member;
  const p = d.permissions;
  const prof = m.profile;
  const pers = d.personal;
  const addr = pers?.address;
  const address = [addr?.line1, addr?.line2, addr?.city, addr?.state, addr?.postalCode, addr?.country].filter(Boolean).join(", ");
  const candidates = (members || []).filter((x) => x._id !== m._id && x.role !== "VIEWER");
  const title = prof?.designation || m.userId.jobTitle;

  const changeRole = async (role: string) => {
    if (await attempt(() => api.patch(base, { role }), "Role updated")) refresh();
  };

  const deactivate = async (reassignTo?: string) => {
    setBusy(true);
    try {
      const res = await api.post(`${base}/deactivate`, { reassignTo });
      toast.success(res.data.data.tasksReassigned ? `Deactivated. ${res.data.data.tasksReassigned} open task(s) handed over.` : "Member deactivated");
      setDeactivateOpen(false);
      refresh();
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  const remove = async (reassignTo?: string) => {
    setBusy(true);
    try {
      const res = await api.delete(base, { params: reassignTo ? { reassignTo } : {} });
      const r = res.data.data;
      toast.success("Member removed");
      if (r.openTasksLeft || r.projectsStillManaged) toast.warning(`Still to sort out: ${r.openTasksLeft} open task(s) assigned and ${r.projectsStillManaged} project(s) they manage.`);
      refresh();
      back();
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  const resend = async () => {
    if (!window.confirm("Create a new temporary password and email it? The old one stops working.")) return;
    try {
      const res = await api.post(`${base}/resend-credentials`);
      setCreds({ email: m.userId.email, password: res.data.data.temporaryPassword, emailQueued: !!res.data.data.emailQueued });
      refresh();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div>
      <PageHeader
        title={m.userId.name}
        description={[title, prof?.company].filter(Boolean).join(" · ") || m.userId.email}
        actions={<Button size="sm" variant="outline" onClick={back}>← Team</Button>}
      />

      <div className="space-y-6 p-6">
        {/* header card */}
        <Card><CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <MemberAvatar name={m.userId.name} image={m.userId.profileImage} className="h-16 w-16" />
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{m.userId.name}</h2>
                  <RoleBadge role={m.role} />
                  {m.status === "deactivated" && <Badge variant="outline" className="border-red-500 text-red-600">Deactivated</Badge>}
                  {p.isSelf && <Badge variant="secondary">You</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{m.userId.email}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {p.canChangeRole && (
                <Select value={m.role} onValueChange={changeRole}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{assignableRoles(myRole).map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {p.canEdit && <Button size="sm" onClick={() => setEditOpen(true)}>Edit profile</Button>}
              {p.canReactivate && <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.post(`${base}/reactivate`), "Member reactivated")) && refresh()}>Reactivate</Button>}
              {p.canDeactivate && <Button size="sm" variant="outline" onClick={() => setDeactivateOpen(true)}>Deactivate</Button>}
              {p.canRemove && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRemoveOpen(true)}>Remove</Button>}
            </div>
          </div>

          {d.awaitingFirstLogin && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm">
              <span>{m.userId.name} has not logged in yet and is still on the temporary password.</span>
              {p.canResendCredentials && <Button size="sm" variant="outline" onClick={resend}>Send new login details</Button>}
            </div>
          )}
        </CardContent></Card>

        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            {p.canViewProgress && <TabsTrigger value="progress">Progress</TabsTrigger>}
          </TabsList>

          <TabsContent value="profile">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card><CardContent className="p-5">
                <h3 className="mb-2 font-medium">Work</h3>
                <Row label="Designation" value={title} />
                <Row label="Department" value={prof?.department} />
                <Row label="Company / organization" value={prof?.company} />
                <Row label="Employment type" value={employmentLabel(prof?.employmentType)} />
                {(p.isSelf || p.canEditAllFields) && <Row label="Employee ID" value={prof?.employeeId} />}
                <Row label="Work location" value={prof?.workLocation} />
                <Row label="Reports to" value={d.reportingManager?.name} />
                <Row label="Joined" value={m.joinedAt ? formatDate(m.joinedAt) : undefined} />
                {(p.isSelf || p.canEditAllFields) && <Row label="Last login" value={m.userId.lastLoginAt ? timeAgo(m.userId.lastLoginAt) : "never"} />}
                <Row label="Open tasks" value={d.openTasks} />
                <div className="pt-3">
                  <p className="mb-1.5 text-sm text-muted-foreground">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {prof?.skills?.length ? prof.skills.map((s) => <Badge key={s} variant="secondary">{s}</Badge>) : <span className="text-sm">—</span>}
                  </div>
                </div>
              </CardContent></Card>

              {pers && (
                <Card><CardContent className="p-5">
                  <h3 className="font-medium">Personal details</h3>
                  <p className="mb-2 text-xs text-muted-foreground">🔒 Only workspace admins and {p.isSelf ? "you" : m.userId.name.split(" ")[0]} can see this.</p>
                  <Row label="Phone" value={pers.phone} />
                  <Row label="Alternate phone" value={pers.alternatePhone} />
                  <Row label="Date of birth" value={pers.dateOfBirth ? formatDate(pers.dateOfBirth) : undefined} />
                  <Row label="Address" value={address} />
                  <Row label="Emergency contact" value={pers.emergencyContact?.name ? `${pers.emergencyContact.name}${pers.emergencyContact.relation ? ` (${pers.emergencyContact.relation})` : ""}${pers.emergencyContact.phone ? `, ${pers.emergencyContact.phone}` : ""}` : undefined} />
                </CardContent></Card>
              )}
            </div>
          </TabsContent>

          {p.canViewProgress && (
            <TabsContent value="progress">
              <ProgressTab workspaceId={workspaceId!} memberId={m._id} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} workspaceId={workspaceId!} detail={d} members={members || []} onSaved={refresh} />

      <ReassignDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`Deactivate ${m.userId.name}`}
        intro="They lose access right away and get an email. Their work, comments and history stay, and you can reactivate them any time."
        submitLabel="Deactivate"
        openTasks={d.openTasks}
        candidates={candidates}
        busy={busy}
        onConfirm={deactivate}
      />
      <ReassignDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${m.userId.name}`}
        intro="They are taken out of the workspace, all its projects and chat channels, and get an email. They can be invited again later."
        submitLabel="Remove from workspace"
        openTasks={d.openTasks}
        candidates={candidates}
        busy={busy}
        onConfirm={remove}
      />

      {creds && <CredentialsDialog open onOpenChange={(v) => !v && setCreds(null)} email={creds.email} password={creds.password} emailQueued={creds.emailQueued} />}
    </div>
  );
}