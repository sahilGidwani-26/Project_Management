import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Copy, Pencil, Plus, Power, Share2, Trash2, Video, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { MeetingItem } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { CreateMeetingDialog, SavedMeeting } from "@/components/meetings/CreateMeetingDialog";
import { ShareDialog } from "@/components/meetings/ShareDialog";
import { MemberAvatar } from "@/components/people/peopleUi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ACCESS, fmtWhen, parseCode } from "@/lib/meetings";
import { copyText } from "@/lib/people";
import { attempt } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";

export default function Meetings() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [code, setCode] = useState("");
  const [dialog, setDialog] = useState<{ open: boolean; meeting: MeetingItem | null }>({ open: false, meeting: null });
  const [share, setShare] = useState<{ meeting: MeetingItem; passcode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const w = workspaceId!;

  const { data, isLoading } = useQuery({
    queryKey: ["meetings", w, tab],
    queryFn: async () => (await api.get(`/meetings/workspace/${w}${tab === "past" ? "?tab=past" : ""}`)).data.data as MeetingItem[],
    refetchInterval: 20_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["meetings", w] });
  const go = (c: string) => navigate(`/meet/${c}`);
  const canControl = (m: MeetingItem) => m.host._id === user?._id || can("meetings.manage");

  const instant = async () => {
    setBusy(true);
    try {
      // an instant meeting is open to workspace members who have the link (no guests)
      const res = await api.post(`/meetings/workspace/${w}`, { title: "", access: "workspace", waitingRoom: false });
      go(res.data.data.code);
    } catch (e) {
      toast.error(apiError(e));
      setBusy(false);
    }
  };

  const joinByCode = () => {
    const c = parseCode(code);
    if (!c) return toast.error("That does not look like a meeting code or link");
    go(c);
  };

  const saved = (r: SavedMeeting) => {
    refresh();
    if (r.created) setShare({ meeting: r.meeting, passcode: r.passcode });
  };

  const end = async (m: MeetingItem) => { if (window.confirm(`End “${m.title}” for everybody? The link stops working.`) && (await attempt(() => api.post(`/meetings/${m._id}/end`), "Meeting ended"))) refresh(); };
  const remove = async (m: MeetingItem) => { if (window.confirm(`Delete “${m.title}”?`) && (await attempt(() => api.delete(`/meetings/${m._id}`), "Meeting deleted"))) refresh(); };

  return (
    <div>
      <PageHeader
        title="Meetings"
        description="Video meetings inside your workspace, with screen sharing"
        actions={
          can("meetings.create") ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, meeting: null })}><Plus className="h-4 w-4" /> New meeting</Button>
              <Button size="sm" disabled={busy} onClick={instant}><Zap className="h-4 w-4" /> Instant meeting</Button>
            </div>
          ) : undefined
        }
      />

      <div className="space-y-6 p-6">
        <Card><CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Video className="h-5 w-5 text-muted-foreground" />
          <Input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && joinByCode()} placeholder="Paste a meeting link or code (abc-defg-hij)" className="max-w-md flex-1" />
          <Button variant="outline" onClick={joinByCode} disabled={!code.trim()}>Join</Button>
          {can("meetings.create") && <p className="w-full text-xs text-muted-foreground sm:w-auto">An instant meeting is open to workspace members who have the link. Use “New meeting” to invite specific people or outsiders.</p>}
        </CardContent></Card>

        <div className="inline-flex rounded-md border border-border p-0.5">
          {([["upcoming", "Live and upcoming"], ["past", "Past"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded px-3 py-1.5 text-sm font-medium", tab === k ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </div>

        {isLoading && <div className="grid gap-4 md:grid-cols-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)}</div>}
        {!isLoading && !data?.length && (
          <EmptyState icon={Video} title={tab === "past" ? "No past meetings" : "No meetings yet"} description={tab === "past" ? "Ended meetings appear here." : can("meetings.create") ? "Start an instant meeting or schedule one." : "Meetings you are invited to appear here."} />
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {data?.map((m) => {
            const a = ACCESS[m.access];
            const live = m.status === "active" && m.live > 0;
            const over = tab === "past";
            return (
              <Card key={m._id} className={cn(over && "opacity-80")}><CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 font-semibold"><span className="truncate">{m.title}</span>{live && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />LIVE · {m.live}</span>}</h3>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><MemberAvatar name={m.host.name} image={m.host.profileImage} className="h-4 w-4" />{m.host.name || "Host"}</p>
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium", a.cls)}><a.icon className="h-3 w-3" />{a.label}</span>
                </div>

                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5"><Clock className="h-3 w-3" />
                    {over ? `${m.status === "ended" ? "Ended" : "Link expired"} ${fmtWhen(m.endedAt || m.expiresAt || m.createdAt)}${m.participants != null ? ` · ${m.participants} joined` : ""}` : m.scheduledAt ? `Scheduled ${fmtWhen(m.scheduledAt)}` : `Started ${fmtWhen(m.createdAt)}`}
                  </p>
                  {!over && <p>{m.expiresAt ? `Link valid until ${fmtWhen(m.expiresAt)}` : "Link never expires"}{m.hasPasscode ? " · passcode set" : ""}{m.locked ? " · locked" : ""}</p>}
                </div>

                {!over && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => go(m.code)}><Video className="h-3.5 w-3.5" /> Join</Button>
                    <Button size="sm" variant="outline" onClick={() => copyText(m.link, "Link copied")}><Copy className="h-3.5 w-3.5" /> Copy link</Button>
                    {canControl(m) && <Button size="sm" variant="outline" onClick={() => setShare({ meeting: m })}><Share2 className="h-3.5 w-3.5" /> Share</Button>}
                    {canControl(m) && <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" onClick={() => setDialog({ open: true, meeting: m })}><Pencil className="h-3.5 w-3.5" /></Button>}
                    {canControl(m) && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="End meeting" onClick={() => end(m)}><Power className="h-3.5 w-3.5" /></Button>}
                  </div>
                )}
                {over && canControl(m) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(m)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
              </CardContent></Card>
            );
          })}
        </div>
      </div>

      <CreateMeetingDialog open={dialog.open} onOpenChange={(v) => setDialog((d) => ({ ...d, open: v }))} workspaceId={w} meeting={dialog.meeting} onSaved={saved} />
      <ShareDialog meeting={share?.meeting || null} passcode={share?.passcode} onClose={() => setShare(null)} onJoin={go} />
    </div>
  );
}