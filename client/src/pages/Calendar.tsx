import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { CalendarDays, CheckSquare, ChevronLeft, ChevronRight, Clock, FolderKanban, Plus, Video } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { Task } from "@/types";
import { CalendarEvent, DeadlineProject } from "@/types/calendar";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { EventFormDialog } from "@/components/calendar/EventFormDialog";
import { EventDetailDialog } from "@/components/calendar/EventDetailDialog";

type DayItem =
  | { kind: "event"; key: string; sort: number; event: CalendarEvent }
  | { kind: "task"; key: string; sort: number; task: Task }
  | { kind: "project"; key: string; sort: number; project: DeadlineProject };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
const LAST = Number.MAX_SAFE_INTEGER;

function chipClass(item: DayItem) {
  if (item.kind === "event") {
    return item.event.type === "meeting"
      ? "bg-primary/15 text-primary"
      : "bg-violet-500/15 text-violet-700 dark:text-violet-300";
  }
  if (item.kind === "task") {
    return cn(
      "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      item.task.status === "Done" && "line-through opacity-60"
    );
  }
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
}

function chipLabel(item: DayItem) {
  if (item.kind === "event") return `${format(new Date(item.event.startTime), "h:mm a")} ${item.event.title}`;
  if (item.kind === "task") return `TASK-${item.task.taskNumber} ${item.task.title}`;
  return `${item.project.name} deadline`;
}

export default function CalendarPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isViewer } = usePermissions();

  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [showDeadlines, setShowDeadlines] = useState(true);
  const [formDate, setFormDate] = useState<Date | null>(null); // non-null => "new event" dialog is open
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridEnd = endOfWeek(endOfMonth(cursor));
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gridStart.getTime(), gridEnd.getTime()]
  );

  const from = gridStart.toISOString();
  const to = addDays(gridEnd, 1).toISOString();
  // Task/project due dates are stored as plain dates, so pad the range a day each side for timezones.
  const deadlineFrom = subDays(gridStart, 1).toISOString();
  const deadlineTo = addDays(gridEnd, 2).toISOString();

  const { data: events } = useQuery({
    queryKey: ["events", workspaceId, from, to],
    queryFn: async () =>
      (await api.get(`/events/workspace/${workspaceId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`))
        .data.data as CalendarEvent[],
    enabled: !!workspaceId,
  });

  const { data: deadlines } = useQuery({
    queryKey: ["calendar-deadlines", workspaceId, deadlineFrom, deadlineTo],
    queryFn: async () =>
      (
        await api.get(
          `/events/workspace/${workspaceId}/deadlines?from=${encodeURIComponent(deadlineFrom)}&to=${encodeURIComponent(deadlineTo)}`
        )
      ).data.data as { tasks: Task[]; projects: DeadlineProject[] },
    enabled: !!workspaceId && showDeadlines,
  });

  const itemsByDay = useMemo(() => {
    const map: Record<string, DayItem[]> = {};
    const push = (k: string, item: DayItem) => {
      if (!map[k]) map[k] = [];
      map[k].push(item);
    };

    events?.forEach((e) => {
      const s = new Date(e.startTime);
      push(dayKey(s), { kind: "event", key: `e-${e._id}`, sort: s.getTime(), event: e });
    });

    if (showDeadlines) {
      deadlines?.tasks.forEach((t) => {
        if (t.dueDate) push(t.dueDate.slice(0, 10), { kind: "task", key: `t-${t._id}`, sort: LAST - 1, task: t });
      });
      deadlines?.projects.forEach((p) => {
        push(p.endDate.slice(0, 10), { kind: "project", key: `p-${p._id}`, sort: LAST, project: p });
      });
    }

    Object.values(map).forEach((arr) => arr.sort((a, b) => a.sort - b.sort));
    return map;
  }, [events, deadlines, showDeadlines]);

  // Open an event straight from an email link (?event=<id>)
  useEffect(() => {
    const id = searchParams.get("event");
    if (!id) return;
    (async () => {
      try {
        const res = await api.get(`/events/${id}`);
        const ev = res.data.data as CalendarEvent;
        const d = new Date(ev.startTime);
        setCursor(d);
        setSelectedDay(d);
        setDetailEventId(ev._id);
      } catch {
        toast.error("Couldn't open that event");
      } finally {
        searchParams.delete("event");
        setSearchParams(searchParams, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams]);

  // Live updates when someone creates/edits an event you're part of
  useEffect(() => {
    const socket = getSocket();
    const onChanged = () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "events" || q.queryKey[0] === "event" });
    socket.on("event:changed", onChanged);
    return () => {
      socket.off("event:changed", onChanged);
    };
  }, [qc]);

  const openItem = (item: DayItem) => {
    if (item.kind === "event") setDetailEventId(item.event._id);
    else if (item.kind === "task") setDetailTask(item.task);
    else navigate(`/app/${workspaceId}/projects/${item.project._id}/board`);
  };

  const goToday = () => {
    const now = new Date();
    setCursor(now);
    setSelectedDay(now);
  };

  const selectedItems = itemsByDay[dayKey(selectedDay)] ?? [];

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Meetings, events and deadlines for your team"
        actions={
          !isViewer ? (
            <Button size="sm" onClick={() => setFormDate(selectedDay)}>
              <Plus className="h-4 w-4" /> New event
            </Button>
          ) : undefined
        }
      />

      <div className="p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCursor(subMonths(cursor, 1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <h2 className="min-w-[9.5rem] text-base font-semibold">{format(cursor, "MMMM yyyy")}</h2>
            <Button variant="ghost" size="sm" onClick={goToday}>
              Today
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary/60" /> Meeting</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-violet-500/60" /> Event</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500/60" /> Task due</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500/60" /> Project deadline</span>
            <label className="flex items-center gap-2 text-foreground">
              <Switch checked={showDeadlines} onCheckedChange={setShowDeadlines} />
              Deadlines
            </label>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* Month grid */}
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-7 border-b border-border bg-secondary/40">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((day) => {
                const items = itemsByDay[dayKey(day)] ?? [];
                return (
                  <div
                    key={day.toISOString()}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDay(day)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDay(day);
                      }
                    }}
                    className={cn(
                      "min-h-[64px] cursor-pointer border-b border-r border-border p-1 text-left transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:min-h-[104px]",
                      !isSameMonth(day, cursor) && "bg-secondary/20 text-muted-foreground",
                      isSameDay(day, selectedDay) && "ring-2 ring-inset ring-primary"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                        isToday(day) && "bg-primary font-semibold text-primary-foreground"
                      )}
                    >
                      {format(day, "d")}
                    </span>

                    <div className="mt-1 hidden space-y-0.5 md:block">
                      {items.slice(0, 3).map((item) => (
                        <div
                          key={item.key}
                          onClick={(e) => {
                            e.stopPropagation();
                            openItem(item);
                          }}
                          className={cn("truncate rounded px-1.5 py-0.5 text-[11px] font-medium hover:brightness-95", chipClass(item))}
                          title={chipLabel(item)}
                        >
                          {chipLabel(item)}
                        </div>
                      ))}
                      {items.length > 3 && (
                        <div className="px-1 text-[11px] text-muted-foreground">+{items.length - 3} more</div>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">
                      {items.slice(0, 4).map((item) => (
                        <span key={item.key} className={cn("h-1.5 w-1.5 rounded-full", chipClass(item).split(" ")[0])} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected day panel */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">{isToday(selectedDay) ? "Today" : format(selectedDay, "EEEE")}</p>
                <h3 className="text-base font-semibold">{format(selectedDay, "d MMMM yyyy")}</h3>
              </div>
              {!isViewer && (
                <Button size="sm" variant="outline" onClick={() => setFormDate(selectedDay)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              )}
            </div>

            {!selectedItems.length && (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <CalendarDays className="h-6 w-6" />
                <p className="text-sm">Nothing scheduled</p>
              </div>
            )}

            <div className="space-y-2">
              {selectedItems.map((item) => {
                if (item.kind === "event") {
                  const e = item.event;
                  return (
                    <div key={item.key} className="rounded-lg border border-border p-3">
                      <button className="w-full text-left" onClick={() => openItem(item)}>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(e.startTime), "h:mm a")} – {format(new Date(e.endTime), "h:mm a")}
                        </p>
                        <p className="mt-0.5 text-sm font-medium">{e.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {e.type === "meeting" ? "Meeting" : "Event"} · {e.attendeeIds.length + 1} people
                        </p>
                      </button>
                      {e.type === "meeting" && e.meetingLink && (
                        <Button asChild size="sm" className="mt-2 h-7 text-xs">
                          <a href={e.meetingLink} target="_blank" rel="noreferrer">
                            <Video className="h-3.5 w-3.5" /> Join
                          </a>
                        </Button>
                      )}
                    </div>
                  );
                }

                if (item.kind === "task") {
                  const t = item.task;
                  return (
                    <button
                      key={item.key}
                      onClick={() => openItem(item)}
                      className="flex w-full items-start gap-2 rounded-lg border border-border p-3 text-left hover:bg-secondary/40"
                    >
                      <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">TASK-{t.taskNumber} · due · {t.status}</p>
                        <p className={cn("truncate text-sm font-medium", t.status === "Done" && "line-through opacity-60")}>{t.title}</p>
                      </div>
                    </button>
                  );
                }

                return (
                  <button
                    key={item.key}
                    onClick={() => openItem(item)}
                    className="flex w-full items-start gap-2 rounded-lg border border-border p-3 text-left hover:bg-secondary/40"
                  >
                    <FolderKanban className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Project deadline</p>
                      <p className="truncate text-sm font-medium">{item.project.name}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {formDate && workspaceId && (
        <EventFormDialog
          workspaceId={workspaceId}
          open={!!formDate}
          onOpenChange={(v) => !v && setFormDate(null)}
          initialDate={formDate}
        />
      )}

      {detailEventId && workspaceId && (
        <EventDetailDialog
          eventId={detailEventId}
          workspaceId={workspaceId}
          open
          onOpenChange={(v) => !v && setDetailEventId(null)}
        />
      )}

      {detailTask && (
        <TaskDetailDialog
          task={detailTask}
          open
          onOpenChange={(v) => {
            if (!v) {
              setDetailTask(null);
              qc.invalidateQueries({ queryKey: ["calendar-deadlines"] });
            }
          }}
        />
      )}
    </div>
  );
}