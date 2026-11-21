import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MeetJoinResult, joinMeetingApi, lookupMeeting, meetError } from "@/lib/meetApi";
import { useMeetingRoom } from "@/hooks/useMeetingRoom";

function Vid({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className || "w-full rounded bg-black"} />;
}

function TestRoom({ join }: { join: MeetJoinResult }) {
  const r = useMeetingRoom(join, { audio: true, video: true });
  const [text, setText] = useState("");
  const btn = "rounded border px-3 py-1.5 text-sm";

  if (r.status === "ended" || r.status === "error") return <p className="p-6">Ended: {r.reason}</p>;
  return (
    <div className="space-y-4 p-4 text-sm">
      <p>Status: <b>{r.status}</b> · {r.online ? "online" : "RECONNECTING…"} · you are {join.name} {r.me.controller ? "(host)" : ""} {r.notice && <span className="ml-2 text-amber-600">{r.notice}</span>}</p>

      <div className="flex flex-wrap gap-2">
        <button className={btn} onClick={r.toggleAudio}>Mic: {r.local.audio ? "on" : "off"}</button>
        <button className={btn} onClick={r.toggleVideo}>Camera: {r.local.video ? "on" : "off"}</button>
        <button className={btn} onClick={r.toggleScreen}>Screen: {r.local.screen ? "stop sharing" : "share"}</button>
        <button className={btn} onClick={r.toggleHand}>Hand: {r.local.hand ? "down" : "raise"}</button>
        <button className={btn} onClick={r.leave}>Leave</button>
        {r.me.isHost && <button className={btn} onClick={r.endForAll}>End for everyone</button>}
        {r.me.controller && <button className={btn} onClick={() => r.changeSettings({ locked: !r.settings.locked })}>Lock: {r.settings.locked ? "ON" : "off"}</button>}
        {r.me.controller && <button className={btn} onClick={() => r.changeSettings({ chatEnabled: !r.settings.chatEnabled })}>Chat: {r.settings.chatEnabled ? "on" : "OFF"}</button>}
        {r.me.controller && <button className={btn} onClick={() => r.changeSettings({ shareBy: r.settings.shareBy === "host" ? "everyone" : "host" })}>Share by: {r.settings.shareBy}</button>}
      </div>

      {r.me.controller && r.waitingList.length > 0 && (
        <div className="rounded border border-amber-500 p-2">
          <p className="font-medium">Waiting room</p>
          {r.waitingList.map((w) => (
            <p key={w.pid}>{w.name}{w.guest ? " (guest)" : ""} <button className={btn} onClick={() => r.admit(w.pid)}>Admit</button> <button className={btn} onClick={() => r.deny(w.pid)}>Deny</button></p>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div><Vid stream={r.localStream} muted className="w-full -scale-x-100 rounded bg-black" /><p>You {r.local.video ? "" : "(camera off)"}</p></div>
        {r.local.screen && <div><Vid stream={r.screenPreview} muted /><p>Your screen</p></div>}
        {r.peers.map((p) => (
          <div key={p.pid}>
            <Vid stream={p.camStream} />
            {p.screen && <Vid stream={p.screenStream} />}
            <p>{p.name}{p.isHost ? " (host)" : p.controller ? " (co-host)" : ""}{p.guest ? " (guest)" : ""} · {p.conn} · mic {p.audio ? "on" : "off"} · cam {p.video ? "on" : "off"}{p.hand ? " ✋" : ""}</p>
            {r.me.controller && !p.isHost && (
              <p className="space-x-1">
                <button className={btn} onClick={() => r.mute(p.pid)}>Mute</button>
                <button className={btn} onClick={() => r.remove(p.pid)}>Remove</button>
                {r.me.isHost && !p.guest && <button className={btn} onClick={() => r.promote(p.pid, !p.controller)}>{p.controller ? "Remove co-host" : "Make co-host"}</button>}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="max-w-md space-y-1">
        {r.chat.map((m) => <p key={m.id}><b>{m.name}:</b> {m.text}</p>)}
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) { r.sendChat(text); setText(""); } }} className="flex gap-2">
          <input className="flex-1 rounded border px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Chat…" />
          <button className={btn}>Send</button>
        </form>
      </div>
    </div>
  );
}

export default function MeetTest() {
  const { code } = useParams();
  const [name, setName] = useState("Guest");
  const [passcode, setPasscode] = useState("");
  const [msg, setMsg] = useState("");
  const [join, setJoin] = useState<MeetJoinResult | null>(null);

  const go = async () => {
    try {
      const l = await lookupMeeting(code!);
      if (l.requiresLogin) return setMsg("This meeting is not open. Log in first (in this same browser), then try again.");
      setJoin(await joinMeetingApi(code!, { name, passcode: passcode || undefined }));
    } catch (e) {
      setMsg(meetError(e).message);
    }
  };

  if (join) return <TestRoom join={join} />;
  return (
    <div className="mx-auto max-w-sm space-y-3 p-6 text-sm">
      <h1 className="text-lg font-semibold">Meeting engine test ({code})</h1>
      <input className="w-full rounded border px-2 py-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (guests only)" />
      <input className="w-full rounded border px-2 py-1.5" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Passcode (if any)" />
      <button className="rounded border px-3 py-1.5" onClick={go}>Join</button>
      {msg && <p className="text-red-600">{msg}</p>}
    </div>
  );
}