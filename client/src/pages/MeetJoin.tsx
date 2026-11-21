import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, Lock, Mic, MicOff, ShieldAlert, Users, Video, VideoOff } from "lucide-react";
import { MeetJoinResult, MeetLookup, joinMeetingApi, lookupMeeting, meetError } from "@/lib/meetApi";
import { useMediaPreview } from "@/hooks/useMediaPreview";
import { RoomStage } from "@/components/meetings/RoomStage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtWhen, parseCode } from "@/lib/meetings";
import { cn } from "@/lib/utils";

type Phase = "loading" | "invalid" | "denied" | "login" | "lobby" | "room";

const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">{children}</div>
);

function Message({ icon: Icon, title, text, children }: { icon: typeof Lock; title: string; text: string; children?: React.ReactNode }) {
  return (
    <Shell>
      <div className="max-w-md space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary"><Icon className="h-5 w-5 text-muted-foreground" /></div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{text}</p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">{children}</div>
      </div>
    </Shell>
  );
}

/* --------------------------------- lobby --------------------------------- */

function Lobby({ code, info, onJoined }: { code: string; info: MeetLookup; onJoined: (r: MeetJoinResult, o: { audio: boolean; video: boolean; micId?: string; camId?: string }) => void }) {
  const pv = useMediaPreview();
  const vref = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState(info.displayName || "");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const guest = !!info.guest;

  useEffect(() => { if (vref.current && vref.current.srcObject !== pv.stream) vref.current.srcObject = pv.stream; }, [pv.stream]);

  const full = (info.live ?? 0) >= (info.maxParticipants ?? 99) && !info.waiting;
  const ready = !busy && !info.locked && (!guest || name.trim().length >= 2) && (!info.requiresPasscode || passcode.length > 0);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await joinMeetingApi(code, { name: guest ? name.trim() : undefined, passcode: passcode || undefined });
      const opts = { audio: pv.audioOn, video: pv.videoOn, micId: pv.micId || undefined, camId: pv.camId || undefined };
      pv.stop(); // let go of the camera so the room can use it
      onJoined(res, opts);
    } catch (e) {
      setErr(meetError(e).message);
      setBusy(false);
    }
  };

  const round = "flex h-11 w-11 items-center justify-center rounded-full border transition";
  const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-xs";

  return (
    <Shell>
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-neutral-900">
            <video ref={vref} autoPlay playsInline muted className={cn("h-full w-full -scale-x-100 object-cover", !pv.videoOn && "invisible")} />
            {!pv.videoOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-300">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-700 text-2xl font-semibold">{(name || "?").trim().charAt(0).toUpperCase()}</div>
                <p className="text-xs">{pv.hasCam ? "Camera is off" : "No camera"}</p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
              <button type="button" onClick={pv.toggleAudio} disabled={!pv.hasMic} aria-label="Microphone" className={cn(round, pv.audioOn ? "border-white/30 bg-white/15 text-white" : "border-red-500 bg-red-500 text-white", !pv.hasMic && "opacity-50")}>{pv.audioOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</button>
              <button type="button" onClick={pv.toggleVideo} disabled={!pv.hasCam} aria-label="Camera" className={cn(round, pv.videoOn ? "border-white/30 bg-white/15 text-white" : "border-red-500 bg-red-500 text-white", !pv.hasCam && "opacity-50")}>{pv.videoOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</button>
            </div>
          </div>

          {pv.hasMic && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Mic className="h-3.5 w-3.5" /><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pv.audioOn ? pv.level * 100 : 0}%` }} /></div></div>}
          {pv.error && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs">{pv.error} <button className="underline" onClick={pv.retry}>Try again</button></p>}

          <div className="grid gap-2 sm:grid-cols-2">
            {pv.devices.mics.length > 1 && <select className={sel} value={pv.micId} onChange={(e) => pv.selectMic(e.target.value)}>{pv.devices.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select>}
            {pv.devices.cams.length > 1 && <select className={sel} value={pv.camId} onChange={(e) => pv.selectCam(e.target.value)}>{pv.devices.cams.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select>}
          </div>
          <p className="text-xs text-muted-foreground">Tip: use headphones to avoid echo.</p>
        </div>

        <Card><CardContent className="space-y-4 p-6">
          <div>
            <p className="text-xs text-muted-foreground">You are joining</p>
            <h1 className="text-xl font-semibold">{info.title}</h1>
            <p className="text-sm text-muted-foreground">Hosted by {info.hostName}</p>
          </div>

          <p className="flex items-center gap-1.5 text-sm"><Users className="h-4 w-4 text-muted-foreground" />{info.live ? `${info.live} ${info.live === 1 ? "person is" : "people are"} in this meeting` : "Nobody is in yet"}</p>
          {info.scheduledAt && new Date(info.scheduledAt).getTime() > Date.now() && <p className="rounded-md bg-secondary px-3 py-2 text-xs">Scheduled for {fmtWhen(info.scheduledAt)}. You can join early.</p>}

          {guest ? (
            <div className="space-y-1.5"><p className="text-sm font-medium">Your name</p><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Enter your name" autoFocus /></div>
          ) : (
            <p className="text-sm">Joining as <b>{info.displayName}</b></p>
          )}

          {info.requiresPasscode && (
            <div className="space-y-1.5"><p className="text-sm font-medium">Passcode</p><Input value={passcode} onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ready && submit()} placeholder="Ask the host" /></div>
          )}

          {info.waiting && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs">The host will have to let you in. Please wait after you click the button.</p>}
          {info.locked && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600">The host has locked this meeting. Nobody new can join right now.</p>}
          {full && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600">This meeting looks full ({info.maxParticipants} people). You can still try.</p>}
          {err && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600">{err}</p>}

          <Button className="w-full" size="lg" disabled={!ready} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{info.waiting ? "Ask to join" : "Join now"}</Button>
        </CardContent></Card>
      </div>
    </Shell>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function MeetJoin() {
  const { code: raw } = useParams();
  const code = parseCode(raw || "");
  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("");
  const [info, setInfo] = useState<MeetLookup | null>(null);
  const [room, setRoom] = useState<{ join: MeetJoinResult; opts: { audio: boolean; video: boolean; micId?: string; camId?: string } } | null>(null);
  const [round, setRound] = useState(0);
  const here = `/meet/${raw}`;

  useEffect(() => {
    let dead = false;
    setPhase("loading");
    if (!code) { setMsg("This meeting link looks wrong. Check that you copied all of it."); setPhase("invalid"); return; }
    lookupMeeting(code)
      .then((l) => {
        if (dead) return;
        if (l.requiresLogin) return setPhase("login");
        setInfo(l);
        setPhase("lobby");
      })
      .catch((e) => {
        if (dead) return;
        const { status, message } = meetError(e);
        setMsg(message);
        setPhase(status === 403 ? "denied" : "invalid");
      });
    return () => { dead = true; };
  }, [code, round]);

  const again = () => { setRoom(null); setRound((r) => r + 1); };

  if (phase === "loading") return <Shell><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Shell>;
  if (phase === "invalid") return <Message icon={ShieldAlert} title="This meeting is not available" text={msg}><Button asChild variant="outline"><Link to="/app">Go to Flowbase</Link></Button></Message>;
  if (phase === "login") {
    return (
      <Message icon={Lock} title="Log in to join" text="This meeting is for invited people. Log in with the account that was invited, then you will come straight back here.">
        <Button asChild><Link to={`/login?redirect=${encodeURIComponent(here)}`}>Log in</Link></Button>
        <Button asChild variant="outline"><Link to={`/register?redirect=${encodeURIComponent(here)}`}>Create an account</Link></Button>
      </Message>
    );
  }
  if (phase === "denied") {
    return (
      <Message icon={Lock} title="You cannot join this meeting" text={msg}>
        <Button asChild variant="outline"><Link to={`/login?redirect=${encodeURIComponent(here)}`}>Log in with another account</Link></Button>
        <Button asChild variant="ghost"><Link to="/app">Go to Flowbase</Link></Button>
      </Message>
    );
  }
  if (phase === "room" && room) return <RoomStage join={room.join} opts={room.opts} onRejoin={again} />;
  return <Lobby key={round} code={code} info={info!} onJoined={(join, opts) => { setRoom({ join, opts }); setPhase("room"); }} />;
}