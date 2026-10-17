import { Link } from "react-router-dom";
import { MemberStandup, StandupBlocker, StandupRef } from "@/types";
import { fmtMinutes } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";

const KIND: Record<StandupBlocker["kind"], { icon: string; label: string; cls: string }> = {
  critical: { icon: "🐛", label: "Critical bug", cls: "text-red-600" },
  dependency: { icon: "⛓️", label: "Blocked", cls: "text-red-600" },
  overdue: { icon: "⏰", label: "Overdue", cls: "text-orange-600" },
  review: { icon: "👀", label: "Waiting for review", cls: "text-amber-600" },
  stale: { icon: "🐢", label: "Stuck", cls: "text-amber-600" },
  risk: { icon: "⚠️", label: "Risk / issue", cls: "text-amber-600" },
};

/** Only real github.com links are clickable. */
const ghHref = (u?: string) => (u && /^https:\/\/(www\.)?github\.com\//i.test(u) ? u : undefined);

const taskHref = (workspaceId: string, t: StandupRef) =>
  t.projectId ? `/app/${workspaceId}/projects/${t.projectId}/board?task=${t._id}` : `/app/${workspaceId}/tasks?task=${t._id}`;

export function TaskLine({ t, workspaceId, prefix, note }: { t: StandupRef; workspaceId: string; prefix?: string; note?: string }) {
  return (
    <Link to={taskHref(workspaceId, t)} className="block rounded px-1 py-0.5 text-sm hover:bg-secondary/50">
      {prefix && <span className="mr-1">{prefix}</span>}
      <span className="mr-1.5 font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>
      <span>{t.title}</span>
      {t.projectName && <span className="ml-1.5 text-xs text-muted-foreground">· {t.projectName}</span>}
      {note && <span className="ml-1.5 text-xs text-muted-foreground">· {note}</span>}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

const dueLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : "");

export function StandupColumns({ s, workspaceId, className }: { s: MemberStandup; workspaceId: string; className?: string }) {
  const y = s.yesterday;
  const noYesterday = !y.done.length && !y.inReview.length && !y.started.length && !y.commits.length && !y.timeMinutes && !y.comments;
  const noToday = !s.today.dueToday.length && !s.today.inProgress.length && !s.today.soon.length;

  return (
    <div className={cn("grid gap-6 md:grid-cols-3", className)}>
      {/* yesterday */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">{s.windowHours > 24 ? "Since Friday" : "Yesterday"}</h4>
        {noYesterday && <p className="text-sm text-muted-foreground">No recorded activity.</p>}
        {!!y.done.length && <Group title="Finished">{y.done.map((t) => <TaskLine key={t._id} t={t} workspaceId={workspaceId} prefix="✅" />)}</Group>}
        {!!y.inReview.length && <Group title="Sent to review">{y.inReview.map((t) => <TaskLine key={t._id} t={t} workspaceId={workspaceId} prefix="👀" />)}</Group>}
        {!!y.started.length && <Group title="Started">{y.started.map((t) => <TaskLine key={t._id} t={t} workspaceId={workspaceId} prefix="▶️" />)}</Group>}
        {!!y.commits.length && (
          <Group title={`${y.commits.length} commit${y.commits.length === 1 ? "" : "s"}`}>
            {y.commits.slice(0, 5).map((c) => {
              const href = ghHref(c.url);
              return (
                <p key={c.sha + c.taskNumber} className="truncate px-1 text-xs text-muted-foreground">
                  <span className="font-mono">{c.sha}</span>{" "}
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">{c.title}</a> : c.title}
                  {c.taskNumber ? ` · TASK-${c.taskNumber}` : ""}
                </p>
              );
            })}
            {y.commits.length > 5 && <p className="px-1 text-xs text-muted-foreground">+{y.commits.length - 5} more</p>}
          </Group>
        )}
        {(y.timeMinutes > 0 || y.comments > 0) && (
          <p className="px-1 text-xs text-muted-foreground">
            {y.timeMinutes > 0 && <>⏱ {fmtMinutes(y.timeMinutes)} logged</>}
            {y.timeMinutes > 0 && y.comments > 0 && " · "}
            {y.comments > 0 && <>💬 {y.comments} discussion message{y.comments === 1 ? "" : "s"}</>}
          </p>
        )}
      </div>

      {/* today */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Today</h4>
        {noToday && <p className="text-sm text-muted-foreground">Nothing scheduled.</p>}
        {!!s.today.dueToday.length && <Group title="Due today">{s.today.dueToday.map((t) => <TaskLine key={t._id} t={t} workspaceId={workspaceId} prefix="📅" />)}</Group>}
        {!!s.today.inProgress.length && <Group title="In progress">{s.today.inProgress.map((t) => <TaskLine key={t._id} t={t} workspaceId={workspaceId} prefix="🔧" />)}</Group>}
        {!!s.today.soon.length && <Group title="Coming up (next 3 days)">{s.today.soon.map((t) => <TaskLine key={t._id} t={t} workspaceId={workspaceId} note={dueLabel(t.dueDate)} />)}</Group>}
      </div>

      {/* blockers */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Blockers</h4>
        {!s.blockers.length && <p className="text-sm text-emerald-600">Nothing is blocking. 🎉</p>}
        {s.blockers.map((b, i) => {
          const k = KIND[b.kind];
          return (
            <div key={i} className="rounded-md border border-border px-2.5 py-1.5">
              <p className={cn("text-xs font-medium", k.cls)}>{k.icon} {k.label}</p>
              {b.task ? <TaskLine t={b.task} workspaceId={workspaceId} /> : null}
              <p className="px-1 text-xs text-muted-foreground">{b.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}