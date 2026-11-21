import crypto from "crypto";
import { Server as SocketIOServer, Socket } from "socket.io";
import { Meeting, MeetingJoin } from "../models/Meeting";
import { ActivityLog } from "../models/ActivityLog";
import { MeetClaims, isExpired, verifyMeetToken } from "../services/meeting";
import { liveCounts, setRoomHooks } from "../services/meetingRooms";

const GRACE_MS = 10_000; // a dropped connection keeps its seat for this long
const WAIT_MAX_MS = 15 * 60_000; // nobody waits forever in the waiting room
const MAX_WAITING = 25;

interface Peer {
  pid: string;
  name: string;
  uid?: string;
  ip: string;
  guest: boolean;
  isHost: boolean; // the person who made the meeting
  controller: boolean; // host or co-host: may admit, mute, remove and change settings
  socket: Socket | null;
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
  waitingSince?: number;
  joinRow?: unknown;
  dropTimer?: NodeJS.Timeout;
  sigHits: number[];
  chatHits: number[];
}
interface Settings { title: string; shareBy: "everyone" | "host"; chatEnabled: boolean; locked: boolean; waitingRoom: boolean; maxParticipants: number }
interface Room { id: string; settings: Settings; peers: Map<string, Peer>; waiting: Map<string, Peer>; banned: Set<string> }

const rooms = new Map<string, Room>();

/* -------------------------------- helpers -------------------------------- */

const pubPeer = (p: Peer) => ({ pid: p.pid, name: p.name, guest: p.guest, isHost: p.isHost, controller: p.controller, audio: p.audio, video: p.video, screen: p.screen, hand: p.hand });
const settingsOf = (m: any): Settings => ({ title: m.title, shareBy: m.shareBy, chatEnabled: !!m.chatEnabled, locked: !!m.locked, waitingRoom: !!m.waitingRoom, maxParticipants: m.maxParticipants || 6 });
const settingsOut = (s: Settings) => ({ shareBy: s.shareBy, chatEnabled: s.chatEnabled, locked: s.locked, waitingRoom: s.waitingRoom, maxParticipants: s.maxParticipants });
const send = (p: Peer | undefined, event: string, payload?: unknown) => { p?.socket?.emit(event, payload); };
const everyone = (room: Room, event: string, payload?: unknown, except?: string) => {
  for (const p of room.peers.values()) if (p.pid !== except) send(p, event, payload);
};
const controllers = (room: Room) => [...room.peers.values()].filter((p) => p.controller);
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);

/** true while the caller stays under `max` events per `windowMs`. */
function allow(hits: number[], max: number, windowMs: number) {
  const now = Date.now();
  while (hits.length && hits[0] < now - windowMs) hits.shift();
  hits.push(now);
  return hits.length <= max;
}

const syncLive = (room: Room) => { if (room.peers.size) liveCounts.set(room.id, room.peers.size); else liveCounts.delete(room.id); };
const dropIfEmpty = (room: Room) => {
  if (!room.peers.size && !room.waiting.size && rooms.get(room.id) === room) { rooms.delete(room.id); liveCounts.delete(room.id); }
};
const pushWaiting = (room: Room) => {
  const list = [...room.waiting.values()].map((p) => ({ pid: p.pid, name: p.name, guest: p.guest, since: p.waitingSince }));
  for (const c of controllers(room)) send(c, "waiting:list", list);
};
const joinedPayload = (room: Room, me: Peer) => ({
  self: pubPeer(me),
  peers: [...room.peers.values()].filter((p) => p.pid !== me.pid).map(pubPeer),
  settings: settingsOut(room.settings),
});

function admit(room: Room, p: Peer) {
  room.waiting.delete(p.pid);
  p.waitingSince = undefined;
  room.peers.set(p.pid, p);
  if (!p.joinRow) {
    p.joinRow = "pending";
    MeetingJoin.create({ meetingId: room.id, userId: p.uid, name: p.name, guest: p.guest }).then((d: any) => { p.joinRow = d._id; }).catch(() => { p.joinRow = undefined; });
  }
  send(p, "joined", joinedPayload(room, p));
  everyone(room, "peer:joined", { peer: pubPeer(p) }, p.pid);
  pushWaiting(room);
  syncLive(room);
}

function admitAll(room: Room) {
  for (const p of [...room.waiting.values()]) {
    if (room.peers.size >= room.settings.maxParticipants) { for (const c of controllers(room)) send(c, "notice", { message: "The meeting is full, so some people are still waiting." }); break; }
    admit(room, p);
  }
}

function removePeer(room: Room, pid: string) {
  const p = room.peers.get(pid) || room.waiting.get(pid);
  if (!p) return;
  if (p.dropTimer) clearTimeout(p.dropTimer);
  const wasIn = room.peers.delete(pid);
  room.waiting.delete(pid);
  if (p.joinRow && p.joinRow !== "pending") MeetingJoin.updateOne({ _id: p.joinRow }, { leftAt: new Date() }).catch(() => undefined);
  if (wasIn) everyone(room, "peer:left", { pid });
  pushWaiting(room);
  syncLive(room);
  dropIfEmpty(room);
}

/** Removes the person and closes their connection shortly after (so the last message still arrives). */
function kick(room: Room, p: Peer) {
  const s = p.socket;
  p.socket = null;
  removePeer(room, p.pid);
  setTimeout(() => s?.disconnect(true), 150);
}

function revokeShares(room: Room) {
  for (const p of room.peers.values()) {
    if (p.screen && !p.controller) {
      p.screen = false;
      send(p, "share:denied");
      everyone(room, "peer:update", { pid: p.pid, patch: { screen: false } }, p.pid);
    }
  }
}

function applySettings(room: Room, next: Partial<Settings>) {
  const before = { ...room.settings };
  Object.assign(room.settings, next);
  everyone(room, "settings", settingsOut(room.settings));
  if (before.waitingRoom && !room.settings.waitingRoom) admitAll(room);
  if (before.shareBy !== "host" && room.settings.shareBy === "host") revokeShares(room);
}

function endRoom(id: string, reason: string) {
  const room = rooms.get(id);
  if (!room) return;
  rooms.delete(id);
  liveCounts.delete(id);
  for (const p of [...room.peers.values(), ...room.waiting.values()]) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
    if (p.joinRow && p.joinRow !== "pending") MeetingJoin.updateOne({ _id: p.joinRow }, { leftAt: new Date() }).catch(() => undefined);
    const s = p.socket;
    p.socket = null;
    s?.emit("ended", { reason });
    setTimeout(() => s?.disconnect(true), 200);
  }
}

const fail = (socket: Socket, code: string, message: string) => {
  socket.emit("fail", { code, message });
  setTimeout(() => socket.disconnect(true), 100);
};

/** Only whitelisted fields of an SDP or ICE message are passed on. */
function cleanSignal(d: any) {
  if (!d || typeof d !== "object") return null;
  if (d.description) {
    const t = d.description.type;
    const sdp = d.description.sdp;
    if (!["offer", "answer", "rollback"].includes(t)) return null;
    if (t !== "rollback" && (typeof sdp !== "string" || sdp.length > 60000)) return null;
    return { description: { type: t, sdp: typeof sdp === "string" ? sdp : "" } };
  }
  const c = d.candidate;
  if (c && typeof c.candidate === "string" && c.candidate.length <= 2000) {
    return {
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === "string" ? c.sdpMid.slice(0, 50) : null,
        sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? c.sdpMLineIndex : null,
        usernameFragment: typeof c.usernameFragment === "string" ? c.usernameFragment.slice(0, 100) : undefined,
      },
    };
  }
  return null;
}

/* ------------------------------- connection ------------------------------- */

async function handle(socket: Socket) {
  const claims: MeetClaims = socket.data.claims;
  const ip = String(socket.handshake.headers["x-forwarded-for"] || socket.handshake.address || "").split(",")[0].trim();

  let m: any;
  try {
    m = await Meeting.findById(claims.mid).lean();
  } catch {
    return fail(socket, "error", "Could not open the meeting. Please try again.");
  }
  if (!m || m.status !== "active") return fail(socket, "ended", "This meeting has ended");

  // from here to the end of the function nothing awaits, so two people connecting at once cannot corrupt the room
  let room = rooms.get(claims.mid);
  const existing = room?.peers.get(claims.pid) || room?.waiting.get(claims.pid);
  if (!existing && isExpired(m)) return fail(socket, "ended", "This meeting link has expired");
  if (!room) {
    room = { id: claims.mid, settings: settingsOf(m), peers: new Map(), waiting: new Map(), banned: new Set() };
    rooms.set(claims.mid, room);
  }
  const R = room;

  if ((claims.uid && R.banned.has(`u:${claims.uid}`)) || (ip && R.banned.has(`i:${ip}`))) {
    dropIfEmpty(R);
    return fail(socket, "removed", "You were removed from this meeting");
  }

  let peer: Peer;
  if (existing) {
    // the same person came back (network blip or reconnect): keep their seat, take over with the new connection
    peer = existing;
    if (peer.dropTimer) { clearTimeout(peer.dropTimer); peer.dropTimer = undefined; }
    const old = peer.socket;
    peer.socket = socket;
    if (old && old.id !== socket.id) { old.emit("fail", { code: "replaced", message: "You joined this meeting from another tab" }); old.disconnect(true); }
    if (R.peers.get(peer.pid) === peer) {
      send(peer, "joined", joinedPayload(R, peer));
      everyone(R, "peer:joined", { peer: pubPeer(peer) }, peer.pid); // the others rebuild their connection to this person
      pushWaiting(R);
    } else {
      send(peer, "waiting", { title: R.settings.title });
    }
  } else {
    if (R.settings.locked && !claims.host) { dropIfEmpty(R); return fail(socket, "locked", "The host has locked this meeting"); }
    const toWaiting = claims.wait && R.settings.waitingRoom;
    if (toWaiting ? R.waiting.size >= MAX_WAITING : R.peers.size >= R.settings.maxParticipants) {
      dropIfEmpty(R);
      return fail(socket, "full", toWaiting ? "Too many people are waiting. Try again in a little while." : "This meeting is full");
    }
    peer = {
      pid: claims.pid, name: claims.name, uid: claims.uid, ip, guest: !claims.uid, isHost: !!claims.host, controller: !!claims.host, socket,
      audio: false, video: false, screen: false, hand: false, sigHits: [], chatHits: [],
    };
    if (toWaiting) {
      peer.waitingSince = Date.now();
      R.waiting.set(peer.pid, peer);
      send(peer, "waiting", { title: R.settings.title });
      pushWaiting(R);
    } else {
      admit(R, peer);
    }
  }
  bind(socket, R, peer);
}

function bind(socket: Socket, room: Room, peer: Peer) {
  const live = () => rooms.get(room.id) === room;
  const inRoom = () => live() && room.peers.get(peer.pid) === peer;
  const ctl = () => inRoom() && peer.controller;
  const notice = (message: string) => socket.emit("notice", { message });

  /* ---- media state, hand, chat ---- */
  socket.on("state", (s: any) => {
    if (!inRoom()) return;
    peer.audio = !!s?.audio;
    peer.video = !!s?.video;
    const wantsShare = !!s?.screen;
    const may = room.settings.shareBy === "everyone" || peer.controller;
    peer.screen = wantsShare && may;
    if (wantsShare && !may) { send(peer, "share:denied"); notice("Only hosts can share their screen in this meeting."); }
    everyone(room, "peer:update", { pid: peer.pid, patch: { audio: peer.audio, video: peer.video, screen: peer.screen } }, peer.pid);
  });

  socket.on("hand", (s: any) => {
    if (!inRoom()) return;
    peer.hand = !!s?.raised;
    everyone(room, "peer:update", { pid: peer.pid, patch: { hand: peer.hand } }, peer.pid);
  });

  socket.on("chat", (s: any) => {
    if (!inRoom()) return;
    if (!room.settings.chatEnabled && !peer.controller) return notice("The host turned chat off.");
    if (!allow(peer.chatHits, 20, 30_000)) return notice("You are sending messages too fast.");
    const text = clean(s?.text, 1000);
    if (!text) return;
    everyone(room, "chat", { id: crypto.randomUUID(), pid: peer.pid, name: peer.name, text, at: Date.now() });
  });

  /* ---- WebRTC signaling ---- */
  socket.on("signal", (msg: any) => {
    if (!inRoom() || !allow(peer.sigHits, 800, 10_000)) return;
    const to = room.peers.get(String(msg?.to));
    if (!to || to.pid === peer.pid) return;
    const data = cleanSignal(msg?.data);
    if (data) send(to, "signal", { from: peer.pid, data });
  });

  /* ---- host controls ---- */
  const target = (msg: any) => room.peers.get(String(msg?.pid));

  socket.on("host:admit", (msg: any) => {
    if (!ctl()) return;
    const p = room.waiting.get(String(msg?.pid));
    if (!p) return;
    if (room.peers.size >= room.settings.maxParticipants) return notice("The meeting is full.");
    admit(room, p);
  });
  socket.on("host:admit-all", () => { if (ctl()) admitAll(room); });
  socket.on("host:deny", (msg: any) => {
    if (!ctl()) return;
    const p = room.waiting.get(String(msg?.pid));
    if (!p) return;
    send(p, "denied", { reason: "The host did not let you in." });
    kick(room, p);
  });
  socket.on("host:mute", (msg: any) => {
    if (!ctl()) return;
    const p = target(msg);
    if (!p || p.isHost || p.pid === peer.pid) return;
    send(p, "force-mute");
  });
  socket.on("host:remove", (msg: any) => {
    if (!ctl()) return;
    const p = target(msg) || room.waiting.get(String(msg?.pid));
    if (!p || p.pid === peer.pid) return;
    if (p.isHost) return notice("The host cannot be removed.");
    if (p.controller && !peer.isHost) return notice("Only the host can remove a co-host.");
    if (p.uid) room.banned.add(`u:${p.uid}`); // the account cannot come back into this meeting
    else if (p.ip) room.banned.add(`i:${p.ip}`); // guests are blocked by network address (best effort)
    send(p, "removed", { reason: "You were removed from the meeting." });
    kick(room, p);
  });
  socket.on("host:promote", (msg: any) => {
    if (!inRoom() || !peer.isHost) return;
    const p = target(msg);
    if (!p || p.isHost || !p.uid) return notice("Only people with an account can be made co-host.");
    p.controller = !!msg?.on;
    send(p, "self:update", { controller: p.controller });
    everyone(room, "peer:update", { pid: p.pid, patch: { controller: p.controller } }, p.pid);
    if (!p.controller && p.screen && room.settings.shareBy === "host") revokeShares(room);
    pushWaiting(room);
  });
  socket.on("host:settings", async (s: any) => {
    if (!ctl()) return;
    const set: Partial<Settings> = {};
    if (typeof s?.locked === "boolean") set.locked = s.locked;
    if (typeof s?.chatEnabled === "boolean") set.chatEnabled = s.chatEnabled;
    if (typeof s?.waitingRoom === "boolean") set.waitingRoom = s.waitingRoom;
    if (s?.shareBy === "everyone" || s?.shareBy === "host") set.shareBy = s.shareBy;
    if (!Object.keys(set).length) return;
    await Meeting.updateOne({ _id: room.id }, { $set: set }).catch(() => undefined);
    if (live()) applySettings(room, set);
  });
  socket.on("host:end", async () => {
    if (!inRoom() || !peer.isHost) return;
    await Meeting.updateOne({ _id: room.id }, { $set: { status: "ended", endedAt: new Date(), endedBy: peer.uid } }).catch(() => undefined);
    ActivityLog.create({ actorId: peer.uid, action: "meeting_ended", resourceType: "Meeting", resourceId: room.id, metadata: { title: room.settings.title } }).catch(() => undefined);
    endRoom(room.id, "The host ended the meeting for everyone.");
  });

  /* ---- leaving ---- */
  socket.on("leave", () => {
    if (peer.socket === socket) peer.socket = null;
    removePeer(room, peer.pid);
    socket.disconnect(true);
  });
  socket.on("disconnect", () => {
    if (peer.socket !== socket) return; // an older connection of the same person
    peer.socket = null;
    if (!live()) return;
    if (room.waiting.get(peer.pid) === peer) return removePeer(room, peer.pid);
    if (room.peers.get(peer.pid) === peer) {
      peer.dropTimer = setTimeout(() => { if (peer.socket === null) removePeer(room, peer.pid); }, GRACE_MS);
    }
  });
}

/* --------------------------------- setup --------------------------------- */

export function initMeetNamespace(io: SocketIOServer) {
  const nsp = io.of("/meet");

  // The meeting token (not the login token) is the only key to this namespace.
  nsp.use((socket, next) => {
    try {
      const t = socket.handshake.auth?.token;
      if (typeof t !== "string" || t.length > 2000) return next(new Error("Authentication required"));
      socket.data.claims = verifyMeetToken(t);
      next();
    } catch {
      next(new Error("Invalid or expired meeting token"));
    }
  });
  nsp.on("connection", (socket) => { void handle(socket); });

  setRoomHooks({
    end: (id, reason) => endRoom(id, reason),
    changed: async (id) => {
      const room = rooms.get(id);
      if (!room) return;
      const m: any = await Meeting.findById(id).lean().catch(() => null);
      if (m && rooms.get(id) === room) applySettings(room, settingsOf(m));
    },
  });

  // people who wait too long are sent away
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const p of [...room.waiting.values()]) {
        if (p.waitingSince && now - p.waitingSince > WAIT_MAX_MS) {
          send(p, "denied", { reason: "Nobody let you in. Please try again." });
          kick(room, p);
        }
      }
    }
  }, 30_000).unref();
}