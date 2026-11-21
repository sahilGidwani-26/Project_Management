import { useState } from "react";
import { Copy, Globe, Link2, Lock, Users } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { MeetingItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/people";
import { ACCESS, inviteText } from "@/lib/meetings";

export function ShareDialog({ meeting, passcode, onClose, onJoin }: { meeting: MeetingItem | null; passcode?: string; onClose: () => void; onJoin: (code: string) => void }) {
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  if (!meeting) return null;
  const a = ACCESS[meeting.access];

  const send = async () => {
    const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    try {
      const res = await api.post(`/meetings/${meeting._id}/email-invite`, { emails: list });
      toast.success(res.data.data.emailConfigured ? `Invitation sent to ${res.data.data.sent} address(es)` : "Saved, but email is not set up on the server, so nothing was sent. Copy the link instead.");
      setEmails("");
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{meeting.title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${a.cls}`}><a.icon className="h-3.5 w-3.5" /> {a.label}</p>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Meeting link</p>
            <div className="flex gap-2">
              <Input readOnly value={meeting.link} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
              <Button type="button" size="sm" variant="outline" onClick={() => copyText(meeting.link, "Link copied")}><Link2 className="h-4 w-4" /> Copy</Button>
            </div>
            <p className="text-xs text-muted-foreground">Code: <b className="font-mono">{meeting.code}</b></p>
          </div>

          {passcode && (
            <div className="rounded-md bg-amber-500/10 p-3 text-sm">
              <p>Passcode for guests: <b className="font-mono text-base">{passcode}</b></p>
              <p className="text-xs text-muted-foreground">This is the only time it is shown. Your team and invited people do not need it.</p>
            </div>
          )}

          <Button type="button" variant="outline" size="sm" onClick={() => copyText(inviteText(meeting, passcode), "Invitation text copied")}><Copy className="h-4 w-4" /> Copy invitation text</Button>

          {meeting.access === "open" ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="flex items-center gap-1.5 text-sm font-medium"><Globe className="h-4 w-4" /> Email the link to anyone</p>
              <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="friend@gmail.com, client@company.com" />
              <p className="text-xs text-muted-foreground">Up to 20 addresses. The passcode is never emailed. Tell them yourself.</p>
              <Button type="button" size="sm" disabled={busy || !emails.trim()} onClick={send}>Send invitations</Button>
            </div>
          ) : (
            <p className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              {meeting.access === "invited" ? <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              {meeting.access === "invited"
                ? "Only the people you invited can join, so this link is useless to anyone else. To let outsiders in, edit the meeting and choose “Anyone with the link”."
                : "Workspace members who have this link can join. Outsiders cannot. To invite outsiders, choose “Anyone with the link”."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {meeting.status === "active" && <Button onClick={() => onJoin(meeting.code)}>Join now</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}