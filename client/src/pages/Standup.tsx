import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { MyStandup } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { StandupColumns } from "@/components/standup/standupUi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attempt } from "@/lib/projectMeta";

const HOURS = [5, 6, 7, 8, 9, 10, 11, 12];
const hourLabel = (h: number) => `${h === 12 ? 12 : h}:00 ${h < 12 ? "AM" : "PM"}`;

export default function Standup() {
  const { workspaceId } = useParams();
  const qc = useQueryClient();
  const key = ["standup", workspaceId];

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get(`/standup/workspace/${workspaceId}/me`)).data.data as MyStandup,
    enabled: !!workspaceId,
  });

  const [plan, setPlan] = useState("");
  const [blockers, setBlockers] = useState("");
  const [away, setAway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!data) return;
    setPlan(data.note?.plan || "");
    setBlockers(data.note?.blockers || "");
    setAway(!!data.note?.away);
  }, [data?.day, data?.note?.plan, data?.note?.blockers, data?.note?.away]);

  if (isLoading) return <div><PageHeader title="Standup" description="Built automatically from your work" /><div className="p-6"><Skeleton className="h-64" /></div></div>;
  if (isError || !data) return <div><PageHeader title="Standup" /><p className="p-6 text-sm text-destructive">Could not load your standup.</p></div>;

  const dirty = plan !== (data.note?.plan || "") || blockers !== (data.note?.blockers || "") || away !== !!data.note?.away;
  const dateLabel = new Date(`${data.day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  const saveNote = async () => {
    setBusy(true);
    const ok = await attempt(() => api.put(`/standup/workspace/${workspaceId}/note`, { plan, blockers, away }), "Note saved");
    setBusy(false);
    if (ok) qc.invalidateQueries({ queryKey: key });
  };

  const savePrefs = async (body: { standupDigest?: boolean; standupHour?: number }, ok: string) => {
    if (await attempt(() => api.patch("/standup/preferences", body), ok)) qc.invalidateQueries({ queryKey: key });
  };

  const emailNow = async () => {
    setSending(true);
    try {
      const res = await api.post(`/standup/workspace/${workspaceId}/email-me`);
      toast.success(res.data.message || "Email sent");
    } catch (e) {
      toast.error(apiError(e));
    }
    setSending(false);
  };

  return (
    <div>
      <PageHeader title="Standup" description={`${dateLabel} · built automatically from your tasks, commits, time logs and discussion`} />

      <div className="space-y-6 p-6">
        {/* ---------- my note + email ---------- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Your note for today</h3>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={away} onChange={(e) => setAway(e.target.checked)} /> I'm away today
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">What I'll do today</p>
                  <Textarea value={plan} onChange={(e) => setPlan(e.target.value)} maxLength={1000} placeholder="Finish the login API, review Priya's PR" className="min-h-[90px]" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">What is blocking me</p>
                  <Textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} maxLength={1000} placeholder="Need the design file from the client" className="min-h-[90px]" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Your teammates see this on the project's Standup tab, next to the automatic part.</p>
                <Button size="sm" disabled={busy || !dirty} onClick={saveNote}>Save note</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-5">
              <h3 className="font-medium">Morning email</h3>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={data.prefs.standupDigest} onChange={(e) => savePrefs({ standupDigest: e.target.checked }, e.target.checked ? "Daily standup email turned on" : "Daily standup email turned off")} />
                <span>Email me this standup every weekday morning</span>
              </label>
              {data.prefs.standupDigest && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Send it around</p>
                  <Select value={String(data.prefs.standupHour)} onValueChange={(v) => savePrefs({ standupHour: Number(v) }, "Time saved")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <Button size="sm" variant="outline" disabled={sending || !data.emailConfigured} onClick={emailNow}>{sending ? "Sending…" : "Email me now"}</Button>
              {!data.emailConfigured && <p className="text-xs text-amber-600">Email is not set up on the server (SMTP settings are missing).</p>}
              <p className="text-[11px] text-muted-foreground">
                Days and times follow your profile timezone: <b>{data.timezone}</b>. If that is wrong, update the timezone in your profile. Weekends are skipped, and nothing is sent when there is nothing to report.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ---------- the automatic standup ---------- */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Your automatic standup</h3>
              <p className="text-xs text-muted-foreground">{data.counts.open} open task{data.counts.open === 1 ? "" : "s"} assigned to you · across all projects</p>
            </div>
            {away && <p className="rounded-md bg-secondary px-3 py-2 text-sm">You marked yourself <b>away</b> today. Save the note so your team sees it.</p>}
            <StandupColumns s={data} workspaceId={workspaceId!} />
            <p className="text-xs text-muted-foreground">
              “{data.windowHours > 24 ? "Since Friday" : "Yesterday"}” means the last {data.windowHours} hours. A task counts for the people it is assigned to. A task is flagged as stuck after 3 days In Progress or 2 days In Review.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}