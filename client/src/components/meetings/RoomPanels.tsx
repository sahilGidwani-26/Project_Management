import { useEffect, useRef, useState } from "react";
import { Hand, Link2, Mic, MicOff, Send, Video, VideoOff, X } from "lucide-react";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/people";
import { colorOf, initialOf } from "./VideoTile";

export type Room = ReturnType<typeof useMeetingRoom>;

const URL_RX = /(https?:\/\/[^\s<>"']+)/g;
/** Text with web links turned into clickable links (only http and https). */
const Linked = ({ text }: { text: string }) => (
  <>{text.split(URL_RX).map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="break-all underline">{p}</a> : <span key={i}>{p}</span>))}</>
);
const sel = "h-9 w-full rounded-md border border-white/15 bg-neutral-800 px-2 text-sm text-white";
const dot = (name: string) => <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: colorOf(name) }}>{initialOf(name)}</span>;

/* ---------------------------------- chat ---------------------------------- */

export function ChatPanel({ room: r }: { room: Room }) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [r.chat.length]);
  const canWrite = r.settings.chatEnabled || r.me.controller;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {!r.chat.length && <p className="pt-6 text-center text-xs text-white/50">Messages are seen only by people in this meeting and disappear when it ends.</p>}
        {r.chat.map((m) => (
          <div key={m.id} className={m.mine ? "text-right" : ""}>
            <p className="text-[11px] text-white/50">{m.mine ? "You" : m.name} · {new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
            <p className={`inline-block max-w-[90%] rounded-lg px-3 py-1.5 text-left text-sm ${m.mine ? "bg-blue-600" : "bg-white/10"}`}><Linked text={m.text} /></p>
          </div>
        ))}
        <div ref={end} />
      </div>
      {!r.settings.chatEnabled && <p className="px-3 pb-1 text-xs text-amber-400">{r.me.controller ? "Chat is off for everyone else." : "The host turned chat off."}</p>}
      {canWrite && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { r.sendChat(text); setText(""); } }} className="flex gap-2 border-t border-white/10 p-3">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Send a message" className="h-10 flex-1 rounded-full border border-white/15 bg-neutral-800 px-4 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/40" />
          <button type="submit" aria-label="Send" disabled={!text.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
      )}
    </div>
  );
}

/* --------------------------------- people --------------------------------- */

export function PeoplePanel({ room: r, selfName }: { room: Room; selfName: string }) {
  const small = "h-7 rounded-md border border-white/20 px-2 text-xs hover:bg-white/10";
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-2">
      {r.me.controller && r.waitingList.length > 0 && (
        <section className="space-y-1 rounded-lg border border-amber-500/60 bg-amber-500/10 p-2">
          <div className="flex items-center justify-between"><p className="text-sm font-medium">Waiting to join ({r.waitingList.length})</p>{r.waitingList.length > 1 && <button className={small} onClick={r.admitAll}>Admit all</button>}</div>
          {r.waitingList.map((w) => (
            <div key={w.pid} className="flex items-center gap-2 py-1">
              {dot(w.name)}
              <span className="min-w-0 flex-1 truncate text-sm">{w.name}{w.guest && <span className="text-white/50"> · guest</span>}</span>
              <button className="h-7 rounded-md bg-emerald-600 px-2 text-xs hover:bg-emerald-500" onClick={() => r.admit(w.pid)}>Admit</button>
              <button className={small} onClick={() => r.deny(w.pid)}>Deny</button>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">In this meeting ({r.peers.length + 1})</p>
        <div className="flex items-center gap-2 py-1">
          {dot(selfName)}
          <span className="min-w-0 flex-1 truncate text-sm">{selfName} <span className="text-white/50">(you){r.me.isHost ? " · host" : r.me.controller ? " · co-host" : ""}</span></span>
          {r.local.hand && <Hand className="h-4 w-4 text-amber-400" />}
          {r.local.audio ? <Mic className="h-4 w-4 text-white/70" /> : <MicOff className="h-4 w-4 text-red-400" />}
          {r.local.video ? <Video className="h-4 w-4 text-white/70" /> : <VideoOff className="h-4 w-4 text-white/40" />}
        </div>

        {r.peers.map((p) => (
          <div key={p.pid} className="space-y-1 py-1">
            <div className="flex items-center gap-2">
              {dot(p.name)}
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}<span className="text-white/50">{p.isHost ? " · host" : p.controller ? " · co-host" : ""}{p.guest ? " · guest" : ""}</span></span>
              {p.hand && <Hand className="h-4 w-4 text-amber-400" />}
              {p.audio ? <Mic className="h-4 w-4 text-white/70" /> : <MicOff className="h-4 w-4 text-red-400" />}
              {p.video ? <Video className="h-4 w-4 text-white/70" /> : <VideoOff className="h-4 w-4 text-white/40" />}
            </div>
            {r.me.controller && !p.isHost && (
              <div className="flex flex-wrap gap-1 pl-10">
                {p.audio && <button className={small} onClick={() => r.mute(p.pid)}>Mute</button>}
                {r.me.isHost && !p.guest && <button className={small} onClick={() => r.promote(p.pid, !p.controller)}>{p.controller ? "Remove co-host" : "Make co-host"}</button>}
                {(r.me.isHost || !p.controller) && <button className={`${small} text-red-400`} onClick={() => window.confirm(`Remove ${p.name} from the meeting?`) && r.remove(p.pid)}><X className="mr-1 inline h-3 w-3" />Remove</button>}
              </div>
            )}
          </div>
        ))}
        {!r.peers.length && <p className="py-2 text-xs text-white/50">Nobody else is here yet.</p>}
      </section>
    </div>
  );
}

/* -------------------------------- settings -------------------------------- */

export function SettingsPanel({ room: r, sinkId, setSinkId, canSink }: { room: Room; sinkId: string; setSinkId: (v: string) => void; canSink: boolean }) {
  const row = "flex items-center justify-between gap-3";
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-2">
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">Devices</p>
        <label className="block space-y-1"><span className="text-xs text-white/70">Microphone</span>
          <select className={sel} value={r.micId} onChange={(e) => r.switchMic(e.target.value)}>
            {!r.micId && <option value="">Default</option>}
            {r.devices.mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
          </select>
        </label>
        <label className="block space-y-1"><span className="text-xs text-white/70">Camera</span>
          <select className={sel} value={r.camId} onChange={(e) => r.switchCam(e.target.value)}>
            {!r.camId && <option value="">Default</option>}
            {r.devices.cams.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select>
        </label>
        {canSink && (
          <label className="block space-y-1"><span className="text-xs text-white/70">Speaker</span>
            <select className={sel} value={sinkId} onChange={(e) => setSinkId(e.target.value)}>
              <option value="">Default</option>
              {r.devices.speakers.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Speaker ${i + 1}`}</option>)}
            </select>
          </label>
        )}
        <p className="text-xs text-white/50">Use headphones to avoid echo.</p>
      </section>

      {r.me.controller && (
        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-white/50">Host controls</p>
          <div className={row}><div><p className="text-sm">Lock meeting</p><p className="text-xs text-white/50">Nobody new can join</p></div><Switch checked={r.settings.locked} onCheckedChange={(v) => r.changeSettings({ locked: v })} /></div>
          <div className={row}><div><p className="text-sm">Waiting room</p><p className="text-xs text-white/50">Guests wait until you admit them</p></div><Switch checked={r.settings.waitingRoom} onCheckedChange={(v) => r.changeSettings({ waitingRoom: v })} /></div>
          <div className={row}><div><p className="text-sm">Chat</p><p className="text-xs text-white/50">Let participants send messages</p></div><Switch checked={r.settings.chatEnabled} onCheckedChange={(v) => r.changeSettings({ chatEnabled: v })} /></div>
          <div className={row}><div><p className="text-sm">Only hosts can share screen</p><p className="text-xs text-white/50">Stops other people's sharing</p></div><Switch checked={r.settings.shareBy === "host"} onCheckedChange={(v) => r.changeSettings({ shareBy: v ? "host" : "everyone" })} /></div>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-white/50">Invite</p>
        <Button type="button" variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={() => copyText(`${window.location.origin}${window.location.pathname}`, "Meeting link copied")}><Link2 className="h-4 w-4" /> Copy meeting link</Button>
        <p className="text-xs text-white/50">Up to {r.settings.maxParticipants} people. Only people allowed by the host can join with this link.</p>
      </section>

      <section className="space-y-1 text-xs text-white/50">
        <p className="font-medium uppercase tracking-wide">Shortcuts</p>
        <p><b className="text-white/80">M</b> mic · <b className="text-white/80">V</b> camera · <b className="text-white/80">H</b> raise hand · <b className="text-white/80">C</b> chat · <b className="text-white/80">P</b> people</p>
      </section>
    </div>
  );
}