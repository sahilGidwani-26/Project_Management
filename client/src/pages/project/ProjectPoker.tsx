import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useAuth } from "@/hooks/useAuth";
import { PokerAccuracy, PokerOverview, PokerView } from "@/types";
import { useProject, useProjectResource, useProjectTasks } from "@/hooks/useProject";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attempt } from "@/lib/projectMeta";
import { cn, formatDate, initials } from "@/lib/utils";

const typeIcon: Record<string, string> = { Bug: "🐛", Feature: "✨", Improvement: "⚡", Task: "🔧" };

/** 90 -> "1h 30m", 480 -> "1d" (a working day is 8 hours). */
const human = (m: number) => (m >= 480 && m % 480 === 0 ? `${m / 480}d` : m % 60 === 0 ? `${m / 60}h` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

/* ------------------------------ task picker ------------------------------ */

function PickTasksDialog({
  open, onOpenChange, title, submitLabel, projectId, exclude, nameField, onSubmit, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  submitLabel: string;
  projectId: string;
  exclude?: string[];
  nameField?: { value: string; set: (v: string) => void };
  onSubmit: (ids: string[]) => void;
  busy?: boolean;
}) {
  const { data: tasks } = useProjectTasks(projectId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [onlyNew, setOnlyNew] = useState(true);

  useEffect(() => {
    if (open) { setPicked(new Set()); setOnlyNew(true); }
  }, [open]);

  const skip = new Set(exclude || []);
  const list = (tasks || []).filter((t) => !t.parentTaskId && t.status !== "Done" && !skip.has(t._id) && (!onlyNew || !t.estimatedMinutes));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} submitLabel={submitLabel} busy={busy} onSubmit={() => onSubmit([...picked])} wide>
      {nameField && (
        <Field label="Session name">
          <Input value={nameField.value} onChange={(e) => nameField.set(e.target.value)} placeholder="Sprint 5 estimates" autoFocus />
        </Field>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Only tasks without an estimate
        </label>
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set(list.slice(0, 100).map((t) => t._id)))}>Select all</button>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-1">
        {!list.length && <p className="p-3 text-sm text-muted-foreground">No matching tasks. Untick the filter above to see tasks that already have an estimate.</p>}
        {list.map((t) => (
          <label key={t._id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/50">
            <input type="checkbox" checked={picked.has(t._id)} onChange={() => toggle(t._id)} />
            <span>{typeIcon[t.type || "Task"]}</span>
            <span className="font-mono text-xs text-muted-foreground">TASK-{t.taskNumber}</span>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {t.estimatedMinutes ? <span className="text-xs text-muted-foreground">{human(t.estimatedMinutes)}</span> : null}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{picked.size} selected. You can add or remove tasks during the session too.</p>
    </FormDialog>
  );
}

/* ------------------------------ live session ------------------------------ */

function SessionView({
  projectId, sessionId, canEdit, onBack, onSelect, onChanged,
}: {
  projectId: string;
  sessionId: string;
  canEdit: boolean;
  onBack?: () => void;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = ["poker-session", projectId, sessionId];
  const base = `/projects/${projectId}/poker/sessions/${sessionId}`;
  const [busy, setBusy] = useState(false);
  const [final, setFinal] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const { data: v, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get(base)).data.data as PokerView,
    refetchInterval: 15000, // safety net if the live connection drops
  });

  // live updates: the server pings this room after every change, we then re-fetch OUR view
  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit("poker:join", sessionId);
    const onChange = (p: { sessionId?: string }) => { if (p?.sessionId === sessionId) qc.invalidateQueries({ queryKey: key }); };
    const onReconnect = () => { join(); qc.invalidateQueries({ queryKey: key }); };
    join();
    socket.on("poker:changed", onChange);
    socket.on("connect", onReconnect);
    return () => {
      socket.emit("poker:leave", sessionId);
      socket.off("poker:changed", onChange);
      socket.off("connect", onReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, projectId]);

  const suggested = v?.reveal?.stats.suggestedMinutes ?? null;
  useEffect(() => {
    if (v?.phase === "revealed") setFinal(suggested != null ? String(suggested) : "");
  }, [v?.phase, v?.round, v?.current?._id, suggested]);

  const act = async (path: string, body?: object, ok?: string, method: "post" | "put" = "post") => {
    if (busy) return false;
    setBusy(true);
    const done = await attempt(() => api[method](`${base}/${path}`, body), ok);
    setBusy(false);
    if (done) {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["poker-accuracy", projectId] });
      onChanged();
    }
    return done;
  };

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !v) {
    return (
      <p className="text-sm text-destructive">
        Could not load this session. {onBack && <button className="text-primary underline" onClick={onBack}>Go back</button>}
      </p>
    );
  }

  const active = v.status === "active";
  const voted = v.participants.filter((p) => p.voted).length;
  const cardLabel = (id?: string | null) => v.cards.find((c) => c.id === id)?.label ?? id ?? "";

  // voting should feel instant, so the card is shown as picked right away, the server then confirms
  const castVote = async (id: string) => {
    const value = v.myVote === id ? null : id;
    qc.setQueryData<PokerView>(key, (old) =>
      old
        ? { ...old, myVote: value, participants: old.participants.map((p) => (p.user._id === user?._id ? { ...p, voted: value !== null, vote: value } : p)) }
        : old
    );
    await attempt(() => api.post(`${base}/vote`, { value }));
    qc.invalidateQueries({ queryKey: key }); // also rolls the card back if the server said no
  };

  const startTask = async (id: string) => {
    if (v.current && v.phase !== "idle" && !window.confirm("Voting is in progress on another task. Switching discards its votes. Continue?")) return;
    await act("start-task", { taskId: id });
  };

  const end = async () => {
    if (!window.confirm("End this session? Estimates already saved stay, and everyone gets a summary email.")) return;
    if (await act("end", undefined, "Session ended")) onSelect(sessionId);
  };

  const stats = v.reveal?.stats;
  const statusText = (p: PokerView["participants"][number]) => {
    if (v.phase === "revealed") return p.vote ? cardLabel(p.vote) : "no vote";
    if (v.phase === "voting") return p.voted ? (p.vote ? `✓ ${cardLabel(p.vote)}` : "✓ voted") : "waiting…";
    return "";
  };

  return (
    <div className="space-y-4">
      {/* header */}
      <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{v.name}</h2>
            <Badge variant={active ? "default" : "secondary"}>{active ? "Live" : "Ended"}</Badge>
            {active && v.phase !== "idle" && <Badge variant="outline">Round {v.round}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Facilitator: {v.facilitator?.name || "—"} · {v.participants.length} participant{v.participants.length === 1 ? "" : "s"} · {v.progress.estimated} estimated · {v.progress.remaining} left
            {v.progress.totalMinutes ? ` · total ${human(v.progress.totalMinutes)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onBack && <Button size="sm" variant="outline" onClick={onBack}>Back</Button>}
          {active && canEdit && !v.isParticipant && <Button size="sm" disabled={busy} onClick={() => act("join", undefined, "You joined the session")}>Join session</Button>}
          {active && v.isParticipant && !v.isFacilitator && <Button size="sm" variant="outline" disabled={busy} onClick={() => act("leave", undefined, "You left the session")}>Leave</Button>}
          {v.canTakeOver && <Button size="sm" variant="outline" disabled={busy} onClick={() => window.confirm("Become the facilitator of this session?") && act("take-over", undefined, "You are the facilitator now")}>Take over</Button>}
          {active && v.canControl && <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={end}>End session</Button>}
        </div>
      </CardContent></Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ended: results */}
          {!active && (
            <Card><CardContent className="space-y-3 p-5">
              <h3 className="font-medium">Results</h3>
              {!v.queue.some((q) => q.state === "estimated") && <p className="text-sm text-muted-foreground">No task was estimated in this session.</p>}
              <div className="divide-y divide-border">
                {v.queue.filter((q) => q.state === "estimated").map((q) => (
                  <div key={q._id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 truncate"><span className="mr-1">{typeIcon[q.type] || "🔧"}</span><span className="mr-2 font-mono text-xs text-muted-foreground">TASK-{q.taskNumber}</span>{q.title}</span>
                    <b>{q.pokerMinutes ? human(q.pokerMinutes) : "—"}</b>
                  </div>
                ))}
              </div>
              {v.endedAt && <p className="text-xs text-muted-foreground">Ended {formatDate(v.endedAt)}. The estimates were saved on the tasks.</p>}
            </CardContent></Card>
          )}

          {/* current task */}
          {active && (v.current ? (
            <Card><CardContent className="space-y-2 p-5">
              <p className="text-xs text-muted-foreground">Now estimating</p>
              <h3 className="text-lg font-semibold">
                <span className="mr-2">{typeIcon[v.current.type] || "🔧"}</span>
                <span className="mr-2 font-mono text-sm text-muted-foreground">TASK-{v.current.taskNumber}</span>
                {v.current.title}
              </h3>
              {v.current.description && <p className="line-clamp-6 whitespace-pre-wrap text-sm text-muted-foreground">{v.current.description}</p>}
              <p className="text-xs text-muted-foreground">
                Current estimate: {v.current.estimatedMinutes ? human(v.current.estimatedMinutes) : "none"} · Logged so far: {v.current.actualMinutes ? human(v.current.actualMinutes) : "0m"}
              </p>
            </CardContent></Card>
          ) : (
            <Card><CardContent className="p-5 text-sm text-muted-foreground">
              No task is being voted on. {v.canControl ? "Pick one from the queue on the right (press Vote)." : `Waiting for ${v.facilitator?.name || "the facilitator"} to pick a task.`}
            </CardContent></Card>
          ))}

          {/* deck */}
          {active && v.current && v.phase === "voting" && (
            <Card><CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Pick your card</h3>
                <span className="text-xs text-muted-foreground">{voted} of {v.participants.length} voted</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {v.cards.map((c) => {
                  const sel = v.myVote === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!v.canVote}
                      aria-pressed={sel}
                      onClick={() => castVote(c.id)}
                      title={c.minutes ? human(c.minutes) : c.id === "?" ? "I'm not sure" : "I need a break"}
                      className={cn(
                        "flex h-20 w-14 items-center justify-center rounded-lg border-2 text-lg font-semibold transition",
                        sel ? "-translate-y-1 border-primary bg-primary text-primary-foreground shadow-md" : "border-border hover:border-primary/60",
                        !v.canVote && "cursor-not-allowed opacity-50"
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {!v.isParticipant && <p className="text-sm text-amber-600">{canEdit ? "Join the session to vote." : "You have view-only access, so you cannot vote."}</p>}
              {v.isParticipant && <p className="text-xs text-muted-foreground">Nobody sees your card until the facilitator reveals. Click your card again to take it back. “?” means unclear, ☕ means break.</p>}
            </CardContent></Card>
          )}

          {/* participants */}
          {active && (
            <Card><CardContent className="space-y-3 p-5">
              <h3 className="font-medium">Participants</h3>
              <div className="flex flex-wrap gap-3">
                {v.participants.map((p) => (
                  <div key={p.user._id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <Avatar className="h-7 w-7"><AvatarImage src={p.user.profileImage} /><AvatarFallback className="text-[10px]">{initials(p.user.name)}</AvatarFallback></Avatar>
                    <div>
                      <p className="text-sm font-medium leading-tight">
                        {p.user.name}{p.user._id === v.facilitator?._id && <span className="ml-1 text-[10px] font-normal text-muted-foreground">(facilitator)</span>}
                      </p>
                      <p className={cn("text-xs", p.voted ? "text-emerald-600" : "text-muted-foreground")}>{statusText(p)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          )}

          {/* revealed votes */}
          {active && v.phase === "revealed" && v.reveal && stats && (
            <Card><CardContent className="space-y-4 p-5">
              <h3 className="font-medium">Votes</h3>
              <div className="flex flex-wrap gap-3">
                {v.reveal.votes.map((x) => (
                  <div key={x.user._id} className="flex flex-col items-center gap-1">
                    <div className="flex h-20 w-14 items-center justify-center rounded-lg border-2 border-primary/60 bg-primary/5 text-lg font-semibold">{x.label}</div>
                    <span className="max-w-[4.5rem] truncate text-xs">{x.user.name}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                <span>Median: <b>{stats.median != null ? human(stats.median) : "—"}</b></span>
                <span>Average: <b>{stats.average != null ? human(stats.average) : "—"}</b></span>
                <span>Range: <b>{stats.min != null && stats.max != null ? `${human(stats.min)} to ${human(stats.max)}` : "—"}</b></span>
              </div>
              {stats.agreed && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">🎉 Everyone agrees. Save the estimate.</p>}
              {stats.bigSpread && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">
                  ⚠️ Big spread (lowest {stats.min != null ? human(stats.min) : "?"}, highest {stats.max != null ? human(stats.max) : "?"}). Ask the lowest and the highest voter to explain their thinking, then revote.
                </p>
              )}
              {stats.unsure > 0 && <p className="rounded-md bg-secondary px-3 py-2 text-sm">{stats.unsure} {stats.unsure === 1 ? "person picked" : "people picked"} “?”. Something in the task may be unclear.</p>}
            </CardContent></Card>
          )}

          {/* facilitator controls */}
          {active && v.current && v.canControl && (
            <Card><CardContent className="space-y-3 p-5">
              <h3 className="font-medium">Facilitator</h3>
              {v.phase === "voting" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={busy || voted === 0} onClick={() => act("reveal")}>Reveal votes</Button>
                  <Button variant="outline" disabled={busy} onClick={() => act("skip", undefined, "Task skipped")}>Skip task</Button>
                  <span className="text-xs text-muted-foreground">{voted === 0 ? "Waiting for the first vote." : `${voted} of ${v.participants.length} voted.`}</span>
                </div>
              )}
              {v.phase === "revealed" && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Final estimate</p>
                    <Select value={final} onValueChange={setFinal}>
                      <SelectTrigger className="w-32"><SelectValue placeholder="Choose…" /></SelectTrigger>
                      <SelectContent>
                        {v.cards.filter((c) => c.minutes != null).map((c) => <SelectItem key={c.id} value={String(c.minutes)}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button disabled={busy || !final} onClick={() => act("finalize", { minutes: Number(final) }, `Estimate saved: ${human(Number(final))}`)}>Save estimate</Button>
                  <Button variant="outline" disabled={busy} onClick={() => act("revote", undefined, "New round started")}>Revote</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => act("skip", undefined, "Task skipped")}>Skip</Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">The saved estimate goes into the task's estimate field (it also feeds Sprint reports in hours).</p>
            </CardContent></Card>
          )}
          {active && v.current && !v.canControl && v.phase !== "idle" && (
            <p className="text-sm text-muted-foreground">{v.phase === "voting" ? `Waiting for ${v.facilitator?.name || "the facilitator"} to reveal the votes.` : `Waiting for ${v.facilitator?.name || "the facilitator"} to save the estimate.`}</p>
          )}
        </div>

        {/* queue */}
        <Card className="h-fit"><CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Queue</h3>
            {active && v.canControl && <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>Add tasks</Button>}
          </div>
          {!v.queue.length && <p className="text-sm text-muted-foreground">No tasks in the queue yet.{v.canControl ? " Add some." : ""}</p>}
          <div className="space-y-1.5">
            {v.queue.map((q) => (
              <div key={q._id} className={cn("flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm", q.state === "current" ? "border-primary bg-primary/5" : "border-border")}>
                <div className="min-w-0">
                  <p className="truncate"><span className="mr-1">{typeIcon[q.type] || "🔧"}</span><span className="mr-1.5 font-mono text-xs text-muted-foreground">TASK-{q.taskNumber}</span>{q.title}</p>
                  <p className={cn("text-[11px]", q.state === "estimated" ? "text-emerald-600" : "text-muted-foreground")}>
                    {q.state === "current" ? "Voting now" : q.state === "estimated" ? `Estimated ${q.pokerMinutes ? human(q.pokerMinutes) : ""}` : q.state === "skipped" ? "Skipped" : q.estimatedMinutes ? `Task estimate: ${human(q.estimatedMinutes)}` : "No estimate yet"}
                  </p>
                </div>
                {active && v.canControl && q.state !== "current" && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => startTask(q._id)}>{q.state === "estimated" ? "Re-estimate" : "Vote"}</Button>
                    <button type="button" className="px-1 text-muted-foreground hover:text-destructive" title="Remove from queue" onClick={() => act("queue", { remove: [q._id] }, undefined, "put")}>✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent></Card>
      </div>

      <PickTasksDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add tasks to the queue"
        submitLabel="Add to queue"
        projectId={projectId}
        exclude={v.queue.map((q) => q._id)}
        busy={busy}
        onSubmit={async (ids) => {
          if (!ids.length) return setAddOpen(false);
          if (await act("queue", { add: ids }, "Tasks added", "put")) setAddOpen(false);
        }}
      />
    </div>
  );
}

/* ----------------------------- estimate accuracy ----------------------------- */

function Accuracy({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ["poker-accuracy", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}/poker/accuracy`)).data.data as PokerAccuracy,
    enabled: !!projectId,
  });
  if (!data || !data.estimatedTasks) return null;

  const r = data.medianRatio;
  const verdict =
    data.measured < 3 ? "Not enough finished tasks with logged time yet (at least 3 are needed for a verdict)."
    : r != null && r > 1.25 ? `Tasks usually take about ${Math.round((r - 1) * 100)}% longer than estimated. Next time, nudge your estimates up.`
    : r != null && r < 0.75 ? `Tasks usually finish about ${Math.round((1 - r) * 100)}% faster than estimated. Your estimates lean cautious.`
    : "Your estimates are close to reality. Well calibrated!";

  return (
    <Card><CardContent className="space-y-4 p-5">
      <div>
        <h3 className="font-medium">Estimate accuracy (team)</h3>
        <p className="text-xs text-muted-foreground">Compares poker estimates with the time logged on the same tasks once they are Done. It is about the team, never about one person.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Estimated in poker</p><p className="text-xl font-semibold">{data.estimatedTasks} tasks</p></div>
        <div><p className="text-xs text-muted-foreground">Done with time logged</p><p className="text-xl font-semibold">{data.measured}</p></div>
        <div><p className="text-xs text-muted-foreground">Within ±25% of the estimate</p><p className="text-xl font-semibold">{data.measured ? `${data.within25}%` : "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Typical actual vs estimate</p><p className="text-xl font-semibold">{r != null ? `${r}×` : "—"}</p></div>
      </div>
      <p className="rounded-md bg-secondary px-3 py-2 text-sm">{verdict}</p>
      {data.measured >= 3 && (
        <p className="text-xs text-muted-foreground">
          {data.tookLonger}% took longer · {data.tookLess}% were faster · estimated {human(data.totalEstimated)} in total, actually {human(data.totalActual)}.
        </p>
      )}
      {!!data.items.length && (
        <div className="divide-y divide-border rounded-md border border-border">
          {data.items.slice(0, 10).map((i) => (
            <div key={i._id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate"><span className="mr-2 font-mono text-xs text-muted-foreground">TASK-{i.taskNumber}</span>{i.title}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                est {human(i.estimated)} · logged {human(i.actual)}
                <span className={cn("rounded px-1.5 py-0.5 font-medium", i.ratio > 1.25 ? "bg-amber-500/15 text-amber-700" : i.ratio < 0.75 ? "bg-blue-500/15 text-blue-700" : "bg-emerald-500/15 text-emerald-700")}>{i.ratio}×</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {data.measured === 0 && <p className="text-xs text-muted-foreground">Log time on the <b>Time</b> tab for estimated tasks, and finished ones appear here.</p>}
    </CardContent></Card>
  );
}

/* ----------------------------------- page ----------------------------------- */

export default function ProjectPoker() {
  const { projectId, canEdit } = useProject();
  const { data: overview, isLoading, reload } = useProjectResource<PokerOverview>("poker", projectId, "poker", 20000);
  const [selected, setSelected] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelected(null); }, [projectId]);

  const active = overview?.active || null;
  const sessionId = selected || active?._id || null;

  const start = async (ids: string[]) => {
    setBusy(true);
    const ok = await attempt(() => api.post(`/projects/${projectId}/poker/sessions`, { name: name.trim(), taskIds: ids }), "Session started. Your team was notified");
    setBusy(false);
    if (ok) { setStartOpen(false); setName(""); setSelected(null); await reload(); }
  };

  if (isLoading || !overview) return <div className="p-6"><Skeleton className="h-64" /></div>;

  return (
    <div className="space-y-6 p-6">
      {sessionId ? (
        <SessionView
          key={sessionId}
          projectId={projectId}
          sessionId={sessionId}
          canEdit={canEdit}
          onBack={selected ? () => setSelected(null) : undefined}
          onSelect={setSelected}
          onChanged={() => { reload(); }}
        />
      ) : (
        <Card><CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Planning poker</h2>
              <p className="text-xs text-muted-foreground">Estimate tasks together without people copying each other.</p>
            </div>
            {canEdit ? <Button onClick={() => setStartOpen(true)}>Start a session</Button> : <p className="text-xs text-muted-foreground">You have view-only access.</p>}
          </div>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
            <li>The facilitator picks a task. Everyone picks a card in secret.</li>
            <li>You can see <b>who</b> voted, but not <b>what</b> they picked.</li>
            <li>The facilitator reveals all cards at once. If they differ a lot, talk and revote.</li>
            <li>The agreed estimate is saved on the task. Everyone gets a summary email at the end.</li>
          </ol>
        </CardContent></Card>
      )}

      {!!overview.recent.length && (
        <Card><CardContent className="space-y-2 p-5">
          <h3 className="font-medium">Recent sessions</h3>
          <div className="divide-y divide-border">
            {overview.recent.map((s) => (
              <button key={s._id} type="button" onClick={() => setSelected(s._id)} className="flex w-full flex-wrap items-center justify-between gap-2 py-2.5 text-left text-sm hover:bg-secondary/30">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.tasks} task{s.tasks === 1 ? "" : "s"} · {s.minutes ? human(s.minutes) : "—"} · {s.facilitator}{s.endedAt ? ` · ${formatDate(s.endedAt)}` : ""}</span>
              </button>
            ))}
          </div>
        </CardContent></Card>
      )}

      <Accuracy projectId={projectId} />

      <PickTasksDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        title="Start a planning poker session"
        submitLabel="Start session"
        projectId={projectId}
        nameField={{ value: name, set: setName }}
        busy={busy}
        onSubmit={start}
      />
    </div>
  );
}