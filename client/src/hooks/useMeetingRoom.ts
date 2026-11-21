import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { MeetJoinResult } from "@/lib/meetApi";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

export interface RemotePeer {
  pid: string; name: string; guest: boolean; isHost: boolean; controller: boolean;
  audio: boolean; video: boolean; screen: boolean; hand: boolean;
  camStream: MediaStream | null; screenStream: MediaStream | null;
  conn: "connecting" | "connected" | "failed";
}
export interface ChatMsg { id: string; pid: string; name: string; text: string; at: number; mine: boolean }
export interface WaitingPerson { pid: string; name: string; guest: boolean; since: number }
export interface RoomSettings { shareBy: "everyone" | "host"; chatEnabled: boolean; locked: boolean; waitingRoom: boolean; maxParticipants: number }
export type RoomStatus = "connecting" | "waiting" | "joined" | "ended" | "error";

type Meta = Omit<RemotePeer, "camStream" | "screenStream" | "conn">;
interface Rec {
  pid: string; pc: RTCPeerConnection; polite: boolean; initiator: boolean;
  makingOffer: boolean; ignoreOffer: boolean; hasRemote: boolean;
  tAudio: RTCRtpTransceiver; tCam: RTCRtpTransceiver; tScreen: RTCRtpTransceiver;
  camStream: MediaStream; screenStream: MediaStream;
  conn: "connecting" | "connected" | "failed"; chain: Promise<void>;
}

interface Options { audio: boolean; video: boolean; micId?: string; camId?: string }

export function useMeetingRoom(join: MeetJoinResult, opts: Options) {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [reason, setReason] = useState("");
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState("");
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [waitingList, setWaitingList] = useState<WaitingPerson[]>([]);
  const [settings, setSettings] = useState<RoomSettings>({ shareBy: join.meeting.shareBy, chatEnabled: join.meeting.chatEnabled, locked: false, waitingRoom: false, maxParticipants: join.meeting.maxParticipants });
  const [me, setMe] = useState({ controller: join.isHost, isHost: join.isHost });
  const [local, setLocal] = useState({ audio: false, video: false, screen: false, hand: false, hasMic: false, hasCam: false });
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }>({ mics: [], cams: [], speakers: [] });
  const [micId, setMicId] = useState(opts.micId || "");
  const [camId, setCamId] = useState(opts.camId || "");

  const socketRef = useRef<Socket | null>(null);
  const recs = useRef(new Map<string, Rec>());
  const metas = useRef(new Map<string, Meta>());
  const micTrack = useRef<MediaStreamTrack | null>(null);
  const camTrack = useRef<MediaStreamTrack | null>(null);
  const screenTrack = useRef<MediaStreamTrack | null>(null);
  const camLocal = useRef(new MediaStream()); // what the person sees of themself
  const screenLocal = useRef(new MediaStream());
  const closed = useRef(false);
  const handRef = useRef(false);
  const settingsRef = useRef(settings);
  const meRef = useRef(me);
  settingsRef.current = settings;
  meRef.current = me;
  const [localStream] = useState(() => camLocal.current);
  const [screenPreview] = useState(() => screenLocal.current);

  /* ------------------------------- helpers ------------------------------- */

  const syncLocal = () =>
    setLocal({
      audio: !!micTrack.current && micTrack.current.enabled && micTrack.current.readyState === "live",
      video: !!camTrack.current && camTrack.current.readyState === "live",
      screen: !!screenTrack.current,
      hand: handRef.current,
      hasMic: !!micTrack.current && micTrack.current.readyState === "live",
      hasCam: !!camTrack.current && camTrack.current.readyState === "live",
    });

  const emitState = () =>
    socketRef.current?.emit("state", {
      audio: !!micTrack.current && micTrack.current.enabled && micTrack.current.readyState === "live",
      video: !!camTrack.current && camTrack.current.readyState === "live",
      screen: !!screenTrack.current,
    });

  const refreshDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({ mics: all.filter((d) => d.kind === "audioinput"), cams: all.filter((d) => d.kind === "videoinput"), speakers: all.filter((d) => d.kind === "audiooutput") });
    } catch { /* ignore */ }
  };

  const publish = () => {
    const list: RemotePeer[] = [];
    metas.current.forEach((m) => {
      const rec = recs.current.get(m.pid);
      list.push({ ...m, camStream: rec?.camStream ?? null, screenStream: m.screen ? rec?.screenStream ?? null : null, conn: rec?.conn ?? "connecting" });
    });
    setPeers(list);
  };

  /** Fewer people = sharper video. In a mesh everybody uploads one copy per person, so the quality drops as the room fills. */
  const tune = () => {
    const n = Math.max(1, recs.current.size);
    const cam = n <= 1 ? 1_500_000 : n <= 3 ? 800_000 : n <= 5 ? 450_000 : 300_000;
    recs.current.forEach((r) => {
      for (const [tr, max, keepRes] of [[r.tCam, cam, false], [r.tScreen, 1_800_000, true]] as const) {
        try {
          const p = tr.sender.getParameters();
          if (!p.encodings || !p.encodings.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = max;
          if (keepRes) (p as any).degradationPreference = "maintain-resolution";
          tr.sender.setParameters(p).catch(() => undefined);
        } catch { /* not negotiated yet */ }
      }
    });
  };

  const sendSignal = (to: string, data: unknown) => socketRef.current?.emit("signal", { to, data });

  /* ------------------------------ media tracks ------------------------------ */

  const getTrack = async (kind: "audio" | "video", deviceId?: string): Promise<MediaStreamTrack | null> => {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const make = (id?: string): MediaStreamConstraints =>
      kind === "audio"
        ? { audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
        : { video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } };
    for (const id of deviceId ? [deviceId, undefined] : [undefined]) {
      try { const s = await navigator.mediaDevices.getUserMedia(make(id)); return s.getTracks()[0] ?? null; } catch { /* next */ }
    }
    return null;
  };

  const setMic = (t: MediaStreamTrack | null, enabled = true) => {
    const old = micTrack.current;
    if (old) { camLocal.current.removeTrack(old); old.onended = null; old.stop(); }
    micTrack.current = t;
    if (t) {
      t.enabled = enabled;
      camLocal.current.addTrack(t);
      t.onended = () => { if (micTrack.current === t) { micTrack.current = null; recs.current.forEach((r) => r.tAudio.sender.replaceTrack(null).catch(() => undefined)); syncLocal(); emitState(); } };
    }
    recs.current.forEach((r) => r.tAudio.sender.replaceTrack(t).catch(() => undefined));
    syncLocal();
  };

  const setCam = (t: MediaStreamTrack | null) => {
    const old = camTrack.current;
    if (old) { camLocal.current.removeTrack(old); old.onended = null; old.stop(); }
    camTrack.current = t;
    if (t) {
      camLocal.current.addTrack(t);
      t.onended = () => { if (camTrack.current === t) { setCam(null); emitState(); } };
    }
    recs.current.forEach((r) => r.tCam.sender.replaceTrack(t).catch(() => undefined));
    syncLocal();
  };

  const stopScreen = () => {
    const t = screenTrack.current;
    if (!t) return;
    screenTrack.current = null;
    t.onended = null;
    t.stop();
    screenLocal.current.removeTrack(t);
    recs.current.forEach((r) => r.tScreen.sender.replaceTrack(null).catch(() => undefined));
    syncLocal();
    emitState();
  };

  /* ---------------------------- peer connections ---------------------------- */

  const closePeer = (pid: string) => {
    const r = recs.current.get(pid);
    if (!r) return;
    r.pc.onnegotiationneeded = null;
    r.pc.onicecandidate = null;
    r.pc.onconnectionstatechange = null;
    r.pc.oniceconnectionstatechange = null;
    try { r.pc.close(); } catch { /* already closed */ }
    recs.current.delete(pid);
  };

  const makePeer = (pid: string, initiator: boolean) => {
    closePeer(pid);
    const pc = new RTCPeerConnection({ iceServers: join.iceServers, bundlePolicy: "max-bundle" });
    // Three fixed slots (audio, camera, screen). Switching a device on or off only swaps its track, nothing is renegotiated.
    const tAudio = pc.addTransceiver("audio", { direction: "sendrecv" });
    const tCam = pc.addTransceiver("video", { direction: "sendrecv" });
    const tScreen = pc.addTransceiver("video", { direction: "sendrecv" });
    const rec: Rec = {
      pid, pc, initiator, polite: join.participantId < pid, makingOffer: false, ignoreOffer: false, hasRemote: false,
      tAudio, tCam, tScreen,
      camStream: new MediaStream([tAudio.receiver.track, tCam.receiver.track]), // the receiver tracks exist from the start
      screenStream: new MediaStream([tScreen.receiver.track]),
      conn: "connecting", chain: Promise.resolve(),
    };
    recs.current.set(pid, rec);

    tAudio.sender.replaceTrack(micTrack.current).catch(() => undefined);
    tCam.sender.replaceTrack(camTrack.current).catch(() => undefined);
    tScreen.sender.replaceTrack(screenTrack.current).catch(() => undefined);

    pc.onnegotiationneeded = async () => {
      if (!rec.initiator && !rec.hasRemote) return; // the newcomer makes the first offer
      try {
        rec.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal(pid, { description: pc.localDescription });
      } catch { /* a later event retries */ } finally { rec.makingOffer = false; }
    };
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(pid, { candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      rec.conn = pc.connectionState === "connected" ? "connected" : pc.connectionState === "failed" ? "failed" : "connecting";
      if (pc.connectionState === "connected") tune();
      if (pc.connectionState === "failed") pc.restartIce();
      publish();
    };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === "failed") pc.restartIce(); };
    tune();
    return rec;
  };

  /** "Perfect negotiation": if both sides offer at once, the polite one backs off. Signals of one peer are handled one by one. */
  const onSignal = (from: string, data: any) => {
    const rec = recs.current.get(from);
    if (!rec || !data) return;
    rec.chain = rec.chain.then(async () => {
      const pc = rec.pc;
      try {
        if (data.description) {
          const d = data.description as RTCSessionDescriptionInit;
          const collision = d.type === "offer" && (rec.makingOffer || pc.signalingState !== "stable");
          rec.ignoreOffer = !rec.polite && collision;
          if (rec.ignoreOffer) return;
          await pc.setRemoteDescription(d);
          rec.hasRemote = true;
          if (d.type === "offer") {
            await pc.setLocalDescription();
            sendSignal(from, { description: pc.localDescription });
          }
        } else if (data.candidate) {
          try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!rec.ignoreOffer) throw e; }
        }
      } catch { /* a broken message must not stop the others */ }
    });
  };

  /* ------------------------------ teardown ------------------------------ */

  const teardown = () => {
    closed.current = true;
    recs.current.forEach((_, pid) => closePeer(pid));
    metas.current.clear();
    for (const r of [micTrack, camTrack, screenTrack]) { r.current?.stop(); r.current = null; }
    camLocal.current.getTracks().forEach((t) => camLocal.current.removeTrack(t));
    screenLocal.current.getTracks().forEach((t) => screenLocal.current.removeTrack(t));
    const s = socketRef.current;
    socketRef.current = null;
    s?.removeAllListeners();
    s?.disconnect();
    setPeers([]);
  };

  const finish = (st: RoomStatus, msg: string) => { teardown(); setReason(msg); setStatus(st); };

  /* -------------------------------- start -------------------------------- */

  useEffect(() => {
    let dead = false;
    closed.current = false;

    (async () => {
      // 1. camera and microphone (the person may continue without them)
      if (navigator.mediaDevices?.getUserMedia && (opts.audio || opts.video)) {
        let a: MediaStreamTrack | null = null;
        let v: MediaStreamTrack | null = null;
        try {
          const s = await navigator.mediaDevices.getUserMedia({
            audio: opts.audio ? { deviceId: opts.micId ? { exact: opts.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
            video: opts.video ? { deviceId: opts.camId ? { exact: opts.camId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } : false,
          });
          a = s.getAudioTracks()[0] ?? null;
          v = s.getVideoTracks()[0] ?? null;
        } catch {
          if (opts.audio) a = await getTrack("audio", opts.micId);
          if (opts.video) v = await getTrack("video", opts.camId);
        }
        if (dead) { a?.stop(); v?.stop(); return; }
        if (a) setMic(a);
        if (v) setCam(v);
        if (a && opts.micId === undefined) setMicId(a.getSettings().deviceId || "");
      }
      await refreshDevices();
      if (dead) return;

      // 2. the live connection (the meeting token is the key, never the login token)
      const s = io(`${SOCKET_URL}/meet`, { auth: { token: join.token }, forceNew: true, reconnectionDelayMax: 4000 });
      socketRef.current = s;

      s.on("connect", () => setOnline(true));
      s.on("disconnect", () => { if (!closed.current) setOnline(false); });
      s.on("connect_error", () => { if (!closed.current) setOnline(false); });

      s.on("waiting", () => setStatus("waiting"));
      s.on("joined", (p: { self: Meta; peers: Meta[]; settings: RoomSettings }) => {
        // first join and every reconnect: forget the old connections and build fresh ones
        recs.current.forEach((_, pid) => closePeer(pid));
        metas.current.clear();
        p.peers.forEach((m) => metas.current.set(m.pid, m));
        setMe({ controller: p.self.controller, isHost: p.self.isHost });
        setSettings(p.settings);
        setStatus("joined");
        p.peers.forEach((m) => makePeer(m.pid, true));
        publish();
        syncLocal();
        emitState();
      });
      s.on("peer:joined", ({ peer }: { peer: Meta }) => { metas.current.set(peer.pid, peer); makePeer(peer.pid, false); publish(); });
      s.on("peer:left", ({ pid }: { pid: string }) => { closePeer(pid); metas.current.delete(pid); publish(); tune(); });
      s.on("peer:update", ({ pid, patch }: { pid: string; patch: Partial<Meta> }) => { const m = metas.current.get(pid); if (m) { Object.assign(m, patch); publish(); } });
      s.on("self:update", (p: { controller: boolean }) => { setMe((x) => ({ ...x, controller: p.controller })); setNotice(p.controller ? "You are now a co-host." : "You are no longer a co-host."); });
      s.on("signal", ({ from, data }: { from: string; data: unknown }) => onSignal(from, data));
      s.on("chat", (m: Omit<ChatMsg, "mine">) => setChat((c) => [...c.slice(-199), { ...m, mine: m.pid === join.participantId }]));
      s.on("waiting:list", (l: WaitingPerson[]) => setWaitingList(l));
      s.on("settings", (st: RoomSettings) => setSettings(st));
      s.on("notice", ({ message }: { message: string }) => setNotice(message));
      s.on("share:denied", () => stopScreen());
      s.on("force-mute", () => { if (micTrack.current) { micTrack.current.enabled = false; syncLocal(); emitState(); } setNotice("The host muted you."); });

      s.on("fail", ({ message }: { message: string }) => finish("error", message));
      s.on("denied", ({ reason: r }: { reason: string }) => finish("ended", r));
      s.on("removed", ({ reason: r }: { reason: string }) => finish("ended", r));
      s.on("ended", ({ reason: r }: { reason: string }) => finish("ended", r));
    })();

    const onDeviceChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      dead = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      socketRef.current?.emit("leave");
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------- controls ------------------------------- */

  const toggleAudio = async () => {
    const t = micTrack.current;
    if (t && t.readyState === "live") { t.enabled = !t.enabled; syncLocal(); emitState(); return; }
    const n = await getTrack("audio", micId || undefined);
    if (!n) return setNotice("No microphone was found, or the browser blocked it.");
    setMic(n);
    emitState();
  };

  const toggleVideo = async () => {
    if (camTrack.current && camTrack.current.readyState === "live") { setCam(null); emitState(); return; }
    const n = await getTrack("video", camId || undefined);
    if (!n) return setNotice("No camera was found, or the browser blocked it.");
    setCam(n);
    emitState();
  };

  const toggleScreen = async () => {
    if (screenTrack.current) return stopScreen();
    if (!navigator.mediaDevices?.getDisplayMedia) return setNotice("This browser cannot share the screen. Use Chrome, Edge or Firefox on a computer.");
    if (settingsRef.current.shareBy === "host" && !meRef.current.controller) return setNotice("Only hosts can share their screen in this meeting.");
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      const t = s.getVideoTracks()[0];
      if (!t) return;
      try { (t as any).contentHint = "detail"; } catch { /* optional */ }
      t.onended = () => stopScreen();
      screenTrack.current = t;
      screenLocal.current.addTrack(t);
      recs.current.forEach((r) => r.tScreen.sender.replaceTrack(t).catch(() => undefined));
      tune();
      syncLocal();
      emitState();
    } catch { /* the person closed the picker */ }
  };

  const switchMic = async (id: string) => {
    const n = await getTrack("audio", id);
    if (!n) return setNotice("Could not switch the microphone.");
    setMic(n, micTrack.current ? micTrack.current.enabled : true);
    setMicId(id);
    emitState();
  };

  const switchCam = async (id: string) => {
    const n = await getTrack("video", id);
    if (!n) return setNotice("Could not switch the camera.");
    setCam(n);
    setCamId(id);
    emitState();
  };

  const toggleHand = () => {
    handRef.current = !handRef.current;
    socketRef.current?.emit("hand", { raised: handRef.current });
    syncLocal();
  };

  const emit = (event: string, payload?: unknown) => socketRef.current?.emit(event, payload);

  return {
    status, reason, online, notice, clearNotice: () => setNotice(""),
    peers, chat, waitingList, settings, me, local, devices, micId, camId,
    localStream, screenPreview,
    toggleAudio, toggleVideo, toggleScreen, toggleHand, switchMic, switchCam,
    sendChat: (text: string) => emit("chat", { text }),
    admit: (pid: string) => emit("host:admit", { pid }),
    admitAll: () => emit("host:admit-all"),
    deny: (pid: string) => emit("host:deny", { pid }),
    mute: (pid: string) => emit("host:mute", { pid }),
    remove: (pid: string) => emit("host:remove", { pid }),
    promote: (pid: string, on: boolean) => emit("host:promote", { pid, on }),
    changeSettings: (patch: Partial<Pick<RoomSettings, "locked" | "chatEnabled" | "waitingRoom" | "shareBy">>) => emit("host:settings", patch),
    endForAll: () => emit("host:end"),
    leave: () => { socketRef.current?.emit("leave"); finish("ended", "You left the meeting."); },
  };
}