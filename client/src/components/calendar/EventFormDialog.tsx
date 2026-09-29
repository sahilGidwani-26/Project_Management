import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, Loader2, Video } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CalendarEvent, EventType } from "@/types/calendar";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AssigneeMultiSelect } from "@/components/tasks/AssigneeMultiSelect";
import { toast } from "sonner";

const AUTO_LINK_PREFIX = "https://meet.jit.si/Flowbase-";

export function EventFormDialog({
  workspaceId,
  open,
  onOpenChange,
  initialDate,
  event,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialDate: Date;
  event?: CalendarEvent; // present => edit mode
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isEdit = !!event;
  const start0 = event ? new Date(event.startTime) : null;
  const end0 = event ? new Date(event.endTime) : null;

  const [type, setType] = useState<EventType>(event?.type ?? "meeting");
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [customLink, setCustomLink] = useState(
    event?.meetingLink && !event.meetingLink.startsWith(AUTO_LINK_PREFIX) ? event.meetingLink : ""
  );
  const [date, setDate] = useState(format(start0 ?? initialDate, "yyyy-MM-dd"));
  const [startTime, setStartTime] = useState(start0 ? format(start0, "HH:mm") : "10:00");
  const [endTime, setEndTime] = useState(end0 ? format(end0, "HH:mm") : "11:00");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event?.attendeeIds.map((u) => u._id) ?? []);
  const [notify, setNotify] = useState(true);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const start = new Date(`${date}T${startTime}`);
    const end = new Date(`${date}T${endTime}`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      toast.error("End time must be after start time");
      return;
    }
    if (customLink.trim() && !/^https?:\/\/\S+$/i.test(customLink.trim())) {
      toast.error("Meeting link must start with http:// or https://");
      return;
    }

    const payload = {
      type,
      title,
      description,
      location,
      meetingLink: customLink.trim(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      attendeeIds,
      notifyAttendees: notify,
    };

    setLoading(true);
    try {
      if (isEdit) await api.patch(`/events/${event!._id}`, payload);
      else await api.post("/events", { workspaceId, ...payload });

      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "events" || q.queryKey[0] === "event" });
      toast.success(isEdit ? "Event updated" : "Event created");
      onOpenChange(false);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit event" : "New event"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(["meeting", "event"] as const).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  type === t ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-secondary"
                )}
              >
                {t === "meeting" ? <Video className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                {t === "meeting" ? "Meeting" : "Event"}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-title">Title</Label>
            <Input
              id="ev-title"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sprint planning"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-3 sm:col-span-1">
              <Label htmlFor="ev-date">Date</Label>
              <Input id="ev-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-start">Start</Label>
              <Input id="ev-start" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-end">End</Label>
              <Input id="ev-end" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Attendees</Label>
            <AssigneeMultiSelect
              workspaceId={workspaceId}
              value={attendeeIds}
              onChange={setAttendeeIds}
              placeholder="Add attendees"
              menuLabel="Invite to this event"
              excludeUserId={user?._id}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-desc">Description</Label>
            <Textarea
              id="ev-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda, what to prepare... (## heading, - list supported)"
            />
          </div>

          {type === "meeting" ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-link">Meeting link (optional)</Label>
              <Input
                id="ev-link"
                value={customLink}
                onChange={(e) => setCustomLink(e.target.value)}
                placeholder="https://meet.google.com/..."
              />
              <p className="text-xs text-muted-foreground">
                Leave empty and a video link is created automatically. Paste your own Google Meet / Zoom link to use that instead.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="ev-loc">Location (optional)</Label>
              <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Conference room 2" />
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Email attendees</p>
              <p className="text-xs text-muted-foreground">
                {isEdit ? "Send them the update" : "Send an invitation with a calendar file"}
              </p>
            </div>
            <Switch checked={notify} onCheckedChange={setNotify} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !title.trim()}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}