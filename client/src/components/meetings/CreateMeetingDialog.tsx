import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { MeetingItem } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { AssigneeMultiSelect } from "@/components/tasks/AssigneeMultiSelect";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCESS, genPasscode, toLocalInput } from "@/lib/meetings";
import { cn } from "@/lib/utils";

export interface SavedMeeting { meeting: MeetingItem; passcode?: string; created: boolean }

const H = 3600e3;

export function CreateMeetingDialog({
  open, onOpenChange, workspaceId, meeting, onSaved,
}: { open: boolean; onOpenChange: (v: boolean) => void; workspaceId: string; meeting: MeetingItem | null; onSaved: (r: SavedMeeting) => void }) {
  const { user } = useAuth();
  const editing = !!meeting;
  const [title, setTitle] = useState("");
  const [access, setAccess] = useState<"invited" | "workspace" | "open">("invited");
  const [invited, setInvited] = useState<string[]>([]);
  const [passMode, setPassMode] = useState<"keep" | "set" | "remove">("set");
  const [passcode, setPasscode] = useState("");
  const [waitingRoom, setWaitingRoom] = useState(true);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [shareBy, setShareBy] = useState<"everyone" | "host">("everyone");
  const [maxP, setMaxP] = useState("6");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [expiry, setExpiry] = useState("24h");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!meeting) {
      setTitle(""); setAccess("invited"); setInvited([]); setPassMode("set"); setPasscode(""); setWaitingRoom(true); setChatEnabled(true);
      setShareBy("everyone"); setMaxP("6"); setScheduleOn(false); setScheduledAt(""); setExpiry("24h");
      return;
    }
    setTitle(meeting.title); setAccess(meeting.access); setPassMode(meeting.hasPasscode ? "keep" : "set"); setPasscode(""); setWaitingRoom(meeting.waitingRoom);
    setChatEnabled(meeting.chatEnabled); setShareBy(meeting.shareBy); setMaxP(String(meeting.maxParticipants));
    setScheduleOn(!!meeting.scheduledAt); setScheduledAt(toLocalInput(meeting.scheduledAt)); setExpiry("keep"); setInvited([]);
    api.get(`/meetings/${meeting._id}`).then((r) => setInvited((r.data.data.invited || []).map((u: { _id: string }) => u._id))).catch(() => undefined);
  }, [open, meeting]);

  const pickAccess = (a: "invited" | "workspace" | "open") => {
    setAccess(a);
    if (a === "open" && !editing) setWaitingRoom(true);
  };

  const submit = async () => {
    const t = title.trim();
    if (editing && t.length < 2) return toast.error("Give the meeting a title");
    const start = scheduleOn && scheduledAt ? new Date(scheduledAt) : null;
    if (scheduleOn && !start) return toast.error("Choose the date and time");

    const body: Record<string, unknown> = {
      title: t, access, invitedUserIds: invited, waitingRoom, chatEnabled, shareBy, maxParticipants: Number(maxP) || 6,
      scheduledAt: start ? start.toISOString() : null,
    };

    // passcode only matters for guests (people outside the team), so it exists for "anyone with the link" only
    if (access === "open") {
      if (passMode === "set" && passcode) {
        if (passcode.length < 4 || passcode.length > 20) return toast.error("The passcode must be 4 to 20 characters");
        body.passcode = passcode;
      } else if (passMode === "remove") body.passcode = "";
    }

    if (expiry === "never") body.neverExpires = true;
    else if (expiry === "7d") body.expiresAt = new Date((start ? +start : Date.now()) + 7 * 24 * H).toISOString();
    else if (expiry === "24h" && editing) body.expiresAt = new Date(Date.now() + 24 * H).toISOString();

    setBusy(true);
    try {
      const res = editing ? await api.patch(`/meetings/${meeting!._id}`, body) : await api.post(`/meetings/workspace/${workspaceId}`, body);
      toast.success(editing ? "Meeting saved" : "Meeting created");
      onSaved({ meeting: res.data.data, passcode: access === "open" && body.passcode ? String(body.passcode) : undefined, created: !editing });
      onOpenChange(false);
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={editing ? "Edit meeting" : "New meeting"} onSubmit={submit} busy={busy} submitLabel={editing ? "Save changes" : scheduleOn ? "Schedule meeting" : "Create meeting"} wide>
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder={`${user?.name?.split(" ")[0] || "My"}'s meeting`} autoFocus />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Who can join?</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ACCESS) as ("invited" | "workspace" | "open")[]).map((k) => {
            const a = ACCESS[k];
            return (
              <button key={k} type="button" onClick={() => pickAccess(k)} className={cn("rounded-lg border p-3 text-left transition", access === k ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40")}>
                <a.icon className="mb-1.5 h-4 w-4" />
                <p className="text-sm font-medium">{a.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{a.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <Field label="Invite people (they get an email and a notification)">
        <AssigneeMultiSelect workspaceId={workspaceId} value={invited} onChange={setInvited} excludeUserId={user?._id} placeholder="Choose team members" menuLabel="Invite" />
        {access === "invited" && <p className="text-xs text-amber-600">Only these people can join. Nobody else can, even with the link.</p>}
      </Field>

      {access === "open" && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Guest security</p>
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm">Waiting room</p><p className="text-xs text-muted-foreground">Guests wait until you let them in. Your team skips it.</p></div>
            <Switch checked={waitingRoom} onCheckedChange={setWaitingRoom} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm">Passcode for guests</p>
            {editing && meeting!.hasPasscode && (
              <div className="flex flex-wrap gap-2 text-xs">
                {([["keep", "Keep the current one"], ["set", "Set a new one"], ["remove", "Remove it"]] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setPassMode(v)} className={cn("rounded-md border px-2.5 py-1", passMode === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>{l}</button>
                ))}
              </div>
            )}
            {passMode === "set" && (
              <div className="flex gap-2">
                <Input value={passcode} onChange={(e) => setPasscode(e.target.value)} maxLength={20} placeholder="4 to 20 characters (optional)" className="font-mono" />
                <Button type="button" variant="outline" size="sm" onClick={() => setPasscode(genPasscode())}>Generate</Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{editing && passMode === "keep" ? "The current passcode stays. It is stored safely, so it cannot be shown again." : "You see the passcode only once, right after saving. Share it with your guests."}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between"><p className="text-sm font-medium">Schedule for later</p><Switch checked={scheduleOn} onCheckedChange={setScheduleOn} /></div>
          {scheduleOn && <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />}
          {!scheduleOn && <p className="text-xs text-muted-foreground">Off means the meeting is open to join right away.</p>}
        </div>
        <Field label="Link stays valid">
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {editing && <SelectItem value="keep">Keep as it is</SelectItem>}
              <SelectItem value="24h">{editing ? "24 hours from now" : "24 hours"}</SelectItem>
              <SelectItem value="7d">7 days</SelectItem>
              <SelectItem value="never">Never expires</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Screen sharing">
          <Select value={shareBy} onValueChange={(v) => setShareBy(v as "everyone" | "host")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="everyone">Everyone</SelectItem><SelectItem value="host">Hosts only</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Maximum people">
          <Select value={maxP} onValueChange={setMaxP}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{[2, 3, 4, 5, 6, 7, 8].map((n) => <SelectItem key={n} value={String(n)}>{n} people{n > 6 ? " (slower video)" : ""}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <div className="flex items-end justify-between gap-3 pb-2"><p className="text-sm">Chat</p><Switch checked={chatEnabled} onCheckedChange={setChatEnabled} /></div>
      </div>
    </FormDialog>
  );
}