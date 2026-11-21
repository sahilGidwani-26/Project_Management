import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Hand, LayoutGrid, Link2, Maximize, MessageSquare, Mic, MicOff, Minimize, MonitorUp, PhoneOff, Settings, User, Users, Video, VideoOff, X, type LucideIcon } from "lucide-react";
import { MeetJoinResult } from "@/lib/meetApi";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";
import { useActiveSpeaker } from "@/hooks/useActiveSpeaker";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/people";
import { cn } from "@/lib/utils";
import { VideoTile } from "./VideoTile";
import { ChatPanel, PeoplePanel, SettingsPanel } from "./RoomPanels";

type Opts = { audio: boolean; video: boolean; micId?: string; camId?: string };
type PanelName = "chat" | "people" | "settings";
interface Tile { key: string; pid: string; kind: "cam" | "screen"; name: string; stream: MediaStream | null; micOn: boolean; camOn: boolean; hand: boolean; badges: string[]; conn?: "connecting" | "connected" | "failed" }

function useNarrow() {
  const [n, setN] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 767px)");
    const h = () => setN(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return n;
}

const clock = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(x).padStart(2, "0")}`; };

function Ctl({ label, tone = "neutral", badge, onClick, children }: { label: string; tone?: "neutral" | "off" | "on" | "leave"; badge?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition sm:h-12 sm:w-12",
        tone === "off" ? "bg-red-600 hover:bg-red-500" : tone === "on" ? "bg-white text-neutral-900 hover:bg-white/90" : tone === "leave" ? "w-14 bg-red-600 hover:bg-red-500 sm:w-16" : "bg-white/10 hover:bg-white/20")}>
      {children}
      {!!badge && <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[11px] font-semibold text-white">{badge > 9 ? "9+" : badge}</span>}
    </button>
  );
}

const Screen = ({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) => (
  <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
    <div className="max-w-sm space-y-3 text-center"><h1 className="text-lg font-semibold">{title}</h1><p className="text-sm text-white/60">{text}</p><div className="flex justify-center gap-2 pt-1">{children}</div></div>
  </div>
);

export function RoomStage({ join, opts, onRejoin }: { join: MeetJoinResult; opts: Opts; onRejoin: () => void }) {
  const r = useMeetingRoom(join, opts);
  const rRef = useRef(r);
  rRef.current = r;
  const narrow = useNarrow();

  const [panel, setPanel] = useState<PanelName | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "speaker">("grid");
  const [sinkId, setSinkId] = useState("");
  const [leaveMenu, setLeaveMenu] = useState(false);
  const [lastRead, setLastRead] = useState(() => Date.now());
  const [fs, setFs] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const joinedAt = useRef<number | null>(null);
  const prevHands = useRef(new Set<string>());
  const lastSpeaker = useRef<string | null>(null);
  const joined = r.status === "joined";
  const canShare = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const canSink = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  /* ----------------------------- tiles and speakers ----------------------------- */

  const tiles = useMemo<Tile[]>(() => {
    const list: Tile[] = [{ key: "me", pid: "me", kind: "cam", name: "You", stream: r.localStream, micOn: r.local.audio, camOn: r.local.video, hand: r.local.hand, badges: r.me.isHost ? ["host"] : r.me.controller ? ["co-host"] : [] }];
    for (const p of r.peers) {
      list.push({ key: `p:${p.pid}`, pid: p.pid, kind: "cam", name: p.name, stream: p.camStream, micOn: p.audio, camOn: p.video, hand: p.hand, badges: p.isHost ? ["host"] : p.controller ? ["co-host"] : p.guest ? ["guest"] : [], conn: p.conn });
      if (p.screen && p.screenStream) list.push({ key: `s:${p.pid}`, pid: p.pid, kind: "screen", name: `${p.name}'s screen`, stream: p.screenStream, micOn: true, camOn: true, hand: false, badges: [] });
    }
    return list;
  }, [r.peers, r.localStream, r.local.audio, r.local.video, r.local.hand, r.me.isHost, r.me.controller]);

  const { loudest, talking } = useActiveSpeaker([
    { id: "me", stream: r.localStream, on: r.local.audio },
    ...r.peers.map((p) => ({ id: p.pid, stream: p.camStream, on: p.audio })),
  ]);
  if (loudest && loudest !== "me") lastSpeaker.current = loudest;

  const screenTile = tiles.find((t) => t.kind === "screen");
  let spot: string | null = null;
  if (pinned && tiles.some((t) => t.key === pinned)) spot = pinned;
  else if (screenTile) spot = screenTile.key;
  else if (view === "speaker" && tiles.length > 1) {
    const k = lastSpeaker.current ? `p:${lastSpeaker.current}` : "";
    spot = tiles.some((t) => t.key === k) ? k : tiles.find((t) => t.key !== "me")?.key ?? "me";
  }

  /* --------------------------------- side effects --------------------------------- */

  useEffect(() => { if (panel === "chat") setLastRead(Date.now()); }, [panel, r.chat.length]);

  useEffect(() => { if (!r.notice) return; const t = setTimeout(r.clearNotice, 5000); return () => clearTimeout(t); }, [r.notice]);

  useEffect(() => {
    if (!joined) return;
    if (joinedAt.current == null) joinedAt.current = Date.now();
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - (joinedAt.current as number)) / 1000)), 1000);
    return () => clearInterval(i);
  }, [joined]);

  // tell the host / everybody when somebody raises a hand
  useEffect(() => {
    const now = new Set(r.peers.filter((p) => p.hand).map((p) => p.pid));
    r.peers.forEach((p) => { if (p.hand && !prevHands.current.has(p.pid)) toast(`${p.name} raised a hand`); });
    prevHands.current = now;
  }, [r.peers]);

  useEffect(() => {
    if (!joined) return;
    const prev = document.title;
    document.title = `${join.meeting.title} · Meeting`;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    // keep the phone screen awake while in the meeting
    let lock: { release: () => Promise<void> } | null = null;
    const getLock = async () => { try { lock = await (navigator as any).wakeLock?.request("screen"); } catch { /* not supported */ } };
    const vis = () => { if (document.visibilityState === "visible") getLock(); };
    getLock();
    document.addEventListener("visibilitychange", vis);
    return () => { document.title = prev; window.removeEventListener("beforeunload", warn); document.removeEventListener("visibilitychange", vis); lock?.release().catch(() => undefined); };
  }, [joined, join.meeting.title]);

  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "m") rRef.current.toggleAudio();
      else if (k === "v") rRef.current.toggleVideo();
      else if (k === "h") rRef.current.toggleHand();
      else if (k === "c") setPanel((p) => (p === "chat" ? null : "chat"));
      else if (k === "p") setPanel((p) => (p === "people" ? null : "people"));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* ---------------------------------- other screens ---------------------------------- */

  if (r.status === "ended" || r.status === "error") {
    return (
      <Screen title={r.status === "error" ? "Could not join" : "Meeting over"} text={r.reason}>
        <Button onClick={onRejoin}>Rejoin</Button>
        <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10"><Link to="/app">Go to Flowbase</Link></Button>
      </Screen>
    );
  }
  if (r.status === "connecting") return <Screen title="Connecting…" text="Setting up your camera and the connection." />;
  if (r.status === "waiting") {
    return (
      <Screen title="Waiting for the host" text="You will be let in as soon as the host admits you. Keep this page open.">
        <Button variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={r.leave}>Cancel</Button>
      </Screen>
    );
  }

  /* ----------------------------------- the room ----------------------------------- */

  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); else document.documentElement.requestFullscreen?.().catch(() => undefined); };
  const open = (p: PanelName) => setPanel((x) => (x === p ? null : p));
  const unread = panel === "chat" ? 0 : r.chat.filter((m) => !m.mine && m.at > lastRead).length;
  const waiting = r.me.controller ? r.waitingList.length : 0;

  const renderTile = (t: Tile, className: string, compact = false) => {
    const peer = t.pid !== "me" ? r.peers.find((p) => p.pid === t.pid) : undefined;
    const menu = r.me.controller && peer && !peer.isHost && t.kind === "cam"
      ? [
          ...(peer.audio ? [{ label: "Mute", onClick: () => r.mute(peer.pid) }] : []),
          ...(r.me.isHost && !peer.guest ? [{ label: peer.controller ? "Remove co-host" : "Make co-host", onClick: () => r.promote(peer.pid, !peer.controller) }] : []),
          ...(r.me.isHost || !peer.controller ? [{ label: "Remove from meeting", danger: true, onClick: () => window.confirm(`Remove ${peer.name}?`) && r.remove(peer.pid) }] : []),
        ]
      : undefined;
    return (
      <VideoTile key={t.key} stream={t.stream} name={t.name} local={t.pid === "me"} kind={t.kind} micOn={t.micOn} camOn={t.camOn} hand={t.hand}
        speaking={t.kind === "cam" && talking.includes(t.pid)} badges={t.badges} conn={t.conn} sinkId={sinkId} pinned={pinned === t.key}
        onPin={() => setPinned(pinned === t.key ? null : t.key)} menu={menu} compact={compact} className={className} />
    );
  };

  const n = tiles.length;
  const cols = narrow ? (n <= 2 ? 1 : 2) : n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const spotTile = spot ? tiles.find((t) => t.key === spot) : null;

  return (
    <div className="fixed inset-0 flex flex-col bg-neutral-950 text-white">
      {/* top bar */}
      <header className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{join.meeting.title}</p>
          <p className="text-xs text-white/50">{clock(elapsed)} · {r.peers.length + 1} {r.peers.length ? "people" : "person"}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title={view === "grid" ? "Speaker view" : "Grid view"} aria-label="Change layout" onClick={() => setView(view === "grid" ? "speaker" : "grid")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">{view === "grid" ? <User className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}</button>
          <button type="button" title="Copy meeting link" aria-label="Copy meeting link" onClick={() => copyText(`${window.location.origin}${window.location.pathname}`, "Meeting link copied")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"><Link2 className="h-4 w-4" /></button>
          <button type="button" title="Full screen" aria-label="Full screen" onClick={toggleFs} className="hidden h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 sm:flex">{fs ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}</button>
        </div>
      </header>

      {(!r.online || r.notice) && (
        <div className={cn("absolute left-1/2 top-14 z-30 max-w-[90vw] -translate-x-1/2 rounded-full px-4 py-1.5 text-sm shadow-lg", r.online ? "bg-neutral-800" : "bg-amber-500 text-neutral-900")}>
          {r.online ? r.notice : "Connection lost. Reconnecting…"}
        </div>
      )}

      {/* stage + side panel */}
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2 sm:px-3">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {r.local.screen && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><MonitorUp className="h-4 w-4" /> You are sharing your screen</span>
              <button type="button" className="rounded-md bg-white/20 px-2 py-1 text-xs hover:bg-white/30" onClick={r.toggleScreen}>Stop sharing</button>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {spotTile ? (
              <div className={cn("flex h-full gap-2", narrow ? "flex-col" : "flex-row")}>
                <div className="min-h-0 min-w-0 flex-1">{renderTile(spotTile, "h-full w-full")}</div>
                {n > 1 && (
                  <div className={cn("flex shrink-0 gap-2", narrow ? "h-24 flex-row overflow-x-auto" : "w-56 flex-col overflow-y-auto")}>
                    {tiles.filter((t) => t.key !== spotTile.key).map((t) => renderTile(t, narrow ? "aspect-video h-full shrink-0" : "aspect-video w-full shrink-0", true))}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid h-full gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
                {tiles.map((t) => renderTile(t, "h-full w-full"))}
              </div>
            )}

            {!r.peers.length && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <div className="pointer-events-auto rounded-xl bg-black/70 px-4 py-3 text-center text-sm">
                  <p>You are the only one here.</p>
                  <button type="button" className="mt-1 text-blue-400 underline" onClick={() => copyText(`${window.location.origin}${window.location.pathname}`, "Meeting link copied")}>Copy the meeting link</button> to invite people
                </div>
              </div>
            )}
          </div>
        </main>

        {panel && (
          <aside className="fixed inset-x-0 bottom-0 z-40 flex h-[70vh] flex-col rounded-t-2xl bg-neutral-900 shadow-2xl md:static md:z-auto md:h-auto md:w-80 md:shrink-0 md:rounded-xl md:shadow-none">
            <div className="flex items-center justify-between px-3 pt-3">
              <div className="flex gap-1">
                {([["chat", "Chat"], ["people", "People"], ["settings", "Settings"]] as [PanelName, string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setPanel(k)} className={cn("rounded-full px-3 py-1 text-sm", panel === k ? "bg-white/15" : "text-white/60 hover:text-white")}>{l}</button>
                ))}
              </div>
              <button type="button" aria-label="Close panel" onClick={() => setPanel(null)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-white/10 pt-1">
              {panel === "chat" && <ChatPanel room={r} />}
              {panel === "people" && <PeoplePanel room={r} selfName={join.name} />}
              {panel === "settings" && <SettingsPanel room={r} sinkId={sinkId} setSinkId={setSinkId} canSink={canSink} />}
            </div>
          </aside>
        )}
      </div>

      {/* control bar */}
      <footer className="relative flex items-center justify-center gap-2 px-2 pb-3 pt-1 sm:gap-3">
        <Ctl label={r.local.audio ? "Mute (M)" : "Unmute (M)"} tone={r.local.audio ? "neutral" : "off"} onClick={r.toggleAudio}>{r.local.audio ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</Ctl>
        <Ctl label={r.local.video ? "Turn camera off (V)" : "Turn camera on (V)"} tone={r.local.video ? "neutral" : "off"} onClick={r.toggleVideo}>{r.local.video ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</Ctl>
        {canShare && <Ctl label={r.local.screen ? "Stop sharing" : "Share screen"} tone={r.local.screen ? "on" : "neutral"} onClick={r.toggleScreen}><MonitorUp className="h-5 w-5" /></Ctl>}
        <Ctl label={r.local.hand ? "Lower hand (H)" : "Raise hand (H)"} tone={r.local.hand ? "on" : "neutral"} onClick={r.toggleHand}><Hand className="h-5 w-5" /></Ctl>
        <Ctl label="Chat (C)" tone={panel === "chat" ? "on" : "neutral"} badge={unread} onClick={() => open("chat")}><MessageSquare className="h-5 w-5" /></Ctl>
        <Ctl label="People (P)" tone={panel === "people" ? "on" : "neutral"} badge={waiting} onClick={() => open("people")}><Users className="h-5 w-5" /></Ctl>
        <Ctl label="Settings" tone={panel === "settings" ? "on" : "neutral"} onClick={() => open("settings")}><Settings className="h-5 w-5" /></Ctl>
        <Ctl label="Leave" tone="leave" onClick={() => setLeaveMenu((v) => !v)}><PhoneOff className="h-5 w-5" /></Ctl>

        {leaveMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setLeaveMenu(false)} />
            <div className="absolute bottom-20 right-1/2 z-50 w-64 translate-x-1/2 space-y-1 rounded-xl bg-neutral-800 p-2 shadow-xl">
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10" onClick={r.leave}>Leave meeting<span className="block text-xs text-white/50">The others stay in</span></button>
              {r.me.isHost && (
                <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-white/10" onClick={() => window.confirm("End the meeting for everyone? The link stops working.") && r.endForAll()}>
                  End meeting for everyone<span className="block text-xs text-white/50">Everybody is removed</span>
                </button>
              )}
            </div>
          </>
        )}
      </footer>
    </div>
  );
}