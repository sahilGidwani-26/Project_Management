import { useState } from "react";
import { TeamStandup, TeamStandupMember } from "@/types";
import { useProject, useProjectResource } from "@/hooks/useProject";
import { StandupColumns } from "@/components/standup/standupUi";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, initials } from "@/lib/utils";

const Stat = ({ label, value, cls }: { label: string; value: number; cls?: string }) => (
  <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p></CardContent></Card>
);

function MemberCard({ m, workspaceId }: { m: TeamStandupMember; workspaceId: string }) {
  const [open, setOpen] = useState(m.blockers.length > 0 && !m.note?.away);
  return (
    <Card className={cn(m.blockers.length > 0 && "border-l-4 border-l-red-500")}>
      <CardContent className="space-y-3 p-4">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8"><AvatarImage src={m.user.profileImage} /><AvatarFallback className="text-xs">{initials(m.user.name)}</AvatarFallback></Avatar>
            <div>
              <p className="text-sm font-medium">{m.user.name}</p>
              {m.user.jobTitle && <p className="text-xs text-muted-foreground">{m.user.jobTitle}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {m.note?.away && <Badge variant="secondary">Away today</Badge>}
            <span className="text-muted-foreground">{m.counts.done} done · {m.counts.open} open</span>
            {m.blockers.length > 0 && <Badge variant="outline" className="border-red-500 text-red-600">{m.blockers.length} blocker{m.blockers.length === 1 ? "" : "s"}</Badge>}
            <span className="text-muted-foreground">{open ? "Hide" : "Show"}</span>
          </div>
        </button>

        {(m.note?.plan || m.note?.blockers) && (
          <div className="grid gap-2 rounded-md bg-secondary/50 p-3 text-sm sm:grid-cols-2">
            {m.note?.plan && <p><span className="text-xs text-muted-foreground">Plan: </span>{m.note.plan}</p>}
            {m.note?.blockers && <p><span className="text-xs text-muted-foreground">Says blocked by: </span>{m.note.blockers}</p>}
          </div>
        )}

        {open && <StandupColumns s={m} workspaceId={workspaceId} />}
      </CardContent>
    </Card>
  );
}

export default function ProjectStandup() {
  const { workspaceId, projectId } = useProject();
  const { data, isLoading } = useProjectResource<TeamStandup>("team-standup", projectId, "standup");

  if (isLoading || !data) return <div className="p-6"><Skeleton className="h-64" /></div>;
  const dateLabel = new Date(`${data.day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="font-semibold">Team standup · {dateLabel}</h2>
        <p className="text-xs text-muted-foreground">
          Built from this project only: task moves, commits, time logs and discussion from the last {data.windowHours} hours. People with blockers come first.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="People" value={data.summary.members} />
        <Stat label={`Tasks finished (${data.windowHours}h)`} value={data.summary.done} cls="text-emerald-600" />
        <Stat label="People with blockers" value={data.summary.blockedPeople} cls={data.summary.blockedPeople ? "text-red-600" : ""} />
        <Stat label="Away today" value={data.summary.away} />
      </div>

      {!data.members.length && <p className="text-sm text-muted-foreground">This project has no members yet.</p>}
      <div className="space-y-3">
        {data.members.map((m) => <MemberCard key={m.user._id} m={m} workspaceId={workspaceId} />)}
      </div>

      <p className="text-xs text-muted-foreground">
        Members add their own plan and “away” status from <b>Standup</b> in the sidebar. A task counts for the people it is assigned to.
      </p>
    </div>
  );
}