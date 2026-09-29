import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { CalendarDays, CalendarPlus, Check, Clock, Copy, Loader2, MapPin, Pencil, Trash2, Users, Video } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { renderLiteMarkdown } from "@/lib/markdown";
import { initials } from "@/lib/utils";
import { CalendarEvent } from "@/types/calendar";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EventFormDialog } from "./EventFormDialog";
import { toast } from "sonner";

function googleCalendarUrl(e: CalendarEvent) {
  const f = (d: string) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${f(e.startTime)}/${f(e.endTime)}`,
    details: [e.description, e.meetingLink ? `Join: ${e.meetingLink}` : ""].filter(Boolean).join("\n\n"),
    location: e.meetingLink || e.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function EventDetailDialog({
  eventId,
  workspaceId,
  open,
  onOpenChange,
}: {
  eventId: string;
  workspaceId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { role } = usePermissions();

  const [editing, setEditing] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: event, isLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => (await api.get(`/events/${eventId}`)).data.data as CalendarEvent,
    enabled: open,
  });

  useEffect(() => {
    if (event && !editingNotes) setNotes(event.notes ?? "");
  }, [event, editingNotes]);

  const refreshAll = () =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "events" || q.queryKey[0] === "event" });

  const isManager = role === "OWNER" || role === "ADMIN" || role === "PROJECT_MANAGER";
  const isOrganizer = !!event && event.organizerId._id === user?._id;
  const isAttendee = !!event && event.attendeeIds.some((a) => a._id === user?._id);
  const canManage = isOrganizer || isManager;
  const canEditNotes = role !== "VIEWER" && (isOrganizer || isAttendee || isManager);
  const cancelled = event?.status === "cancelled";

  const start = event ? new Date(event.startTime) : null;
  const end = event ? new Date(event.endTime) : null;
  const now = Date.now();
  const phase = start && end ? (now < start.getTime() ? "upcoming" : now <= end.getTime() ? "live" : "ended") : null;

  const copyLink = async () => {
    if (!event?.meetingLink) return;
    await navigator.clipboard.writeText(event.meetingLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await api.patch(`/events/${eventId}/notes`, { notes });
      await refreshAll();
      setEditingNotes(false);
      toast.success("Notes saved");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSavingNotes(false);
    }
  };

  const cancelEvent = async () => {
    if (!window.confirm("Cancel this event? Attendees will be emailed a cancellation.")) return;
    try {
      await api.delete(`/events/${eventId}`);
      await refreshAll();
      toast.success("Event cancelled");
      onOpenChange(false);
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto scrollbar-thin">
          {isLoading || !event || !start || !end ? (
            <>
              <DialogTitle className="sr-only">Event</DialogTitle>
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2 pr-6">
                  <Badge variant="secondary" className="gap-1">
                    {event.type === "meeting" ? <Video className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
                    {event.type === "meeting" ? "Meeting" : "Event"}
                  </Badge>
                  {cancelled && <Badge variant="destructive">Cancelled</Badge>}
                  {!cancelled && phase === "live" && <Badge className="bg-emerald-600 text-white">Live now</Badge>}
                  {!cancelled && phase === "upcoming" && (
                    <span className="text-xs text-muted-foreground">
                      Starts {formatDistanceToNowStrict(start, { addSuffix: true })}
                    </span>
                  )}
                  {!cancelled && phase === "ended" && <span className="text-xs text-muted-foreground">Ended</span>}
                </div>
                <DialogTitle className="text-xl">{event.title}</DialogTitle>
              </DialogHeader>

              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {format(start, "EEEE, d MMMM yyyy")} · {format(start, "h:mm a")} – {format(end, "h:mm a")}
                  </span>
                </p>
                {event.location && (
                  <p className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" /> {event.location}
                  </p>
                )}
              </div>

              {!cancelled && (
                <div className="flex flex-wrap items-center gap-2">
                  {event.meetingLink && (
                    <>
                      <Button asChild>
                        <a href={event.meetingLink} target="_blank" rel="noreferrer">
                          <Video className="h-4 w-4" /> Join meeting
                        </a>
                      </Button>
                      <Button variant="outline" onClick={copyLink}>
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? "Copied" : "Copy link"}
                      </Button>
                    </>
                  )}
                  <Button variant="outline" asChild>
                    <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">
                      <CalendarPlus className="h-4 w-4" /> Add to Google Calendar
                    </a>
                  </Button>
                </div>
              )}

              <div className="border-t border-border pt-4">
                <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4" /> People ({event.attendeeIds.length + 1})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {[{ ...event.organizerId, organizer: true }, ...event.attendeeIds.map((a) => ({ ...a, organizer: false }))].map(
                    (p) => (
                      <div key={p._id} className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-xs">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={p.profileImage} />
                          <AvatarFallback className="text-[9px]">{initials(p.name)}</AvatarFallback>
                        </Avatar>
                        {p.name}
                        {p.organizer && <span className="text-muted-foreground">· organizer</span>}
                      </div>
                    )
                  )}
                </div>
              </div>

              {event.description && (
                <div className="border-t border-border pt-4">
                  <h4 className="mb-1.5 text-sm font-semibold">Description</h4>
                  <div className="text-sm text-foreground/90" dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(event.description) }} />
                </div>
              )}

              <div className="border-t border-border pt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Meeting notes</h4>
                  {canEditNotes && !editingNotes && (
                    <button
                      onClick={() => setEditingNotes(true)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Edit notes"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {editingNotes ? (
                  <div className="space-y-2">
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="min-h-[160px]"
                      autoFocus
                      placeholder={"## Discussion\n- Point 1\n\n## Decisions\n\n## Action items\n- [Name] — task"}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingNotes(false);
                          setNotes(event.notes ?? "");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
                        {savingNotes && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save notes
                      </Button>
                    </div>
                  </div>
                ) : event.notes ? (
                  <div className="text-sm text-foreground/90" dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(event.notes) }} />
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    No notes yet — write down what was discussed, decisions and action items after the meeting.
                  </p>
                )}

                {event.notesUpdatedAt && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Last edited by {event.notesUpdatedBy?.name ?? "someone"} · {format(new Date(event.notesUpdatedAt), "d MMM, h:mm a")}
                  </p>
                )}
              </div>

              {canManage && !cancelled && (
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={cancelEvent}>
                    <Trash2 className="h-3.5 w-3.5" /> Cancel event
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {editing && event && (
        <EventFormDialog
          workspaceId={workspaceId}
          open={editing}
          onOpenChange={setEditing}
          initialDate={new Date(event.startTime)}
          event={event}
        />
      )}
    </>
  );
}