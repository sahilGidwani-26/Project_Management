import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { Meeting } from "../models/Meeting";
import { getAccess } from "./permissions";

/* ------------------------------- meeting code ------------------------------- */

const LETTERS = "abcdefghjkmnpqrstuvwxyz"; // no look-alikes (i, l, o)
const part = (n: number) => Array.from({ length: n }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join("");

export async function newCode() {
  for (let i = 0; i < 8; i++) {
    const c = `${part(3)}-${part(4)}-${part(3)}`;
    if (!(await Meeting.exists({ code: c }))) return c;
  }
  throw new Error("Could not create a meeting code");
}

/** "ABC defg-hij" -> "abc-defg-hij". Anything that is not exactly 10 letters gives "". */
export function normCode(input: unknown) {
  const s = String(input || "").toLowerCase().replace(/[^a-z]/g, "");
  return s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}` : "";
}

export const cleanName = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
export const meetingLink = (code: string) => `${env.CLIENT_URL}/meet/${code}`;
export const isExpired = (m: any) => !!m.expiresAt && +new Date(m.expiresAt) < Date.now();

/* ------------------------------- rate limiting ------------------------------- */

const hits = new Map<string, { n: number; reset: number }>();
/** true while the caller is still allowed (max calls per window). In memory, per server process. */
export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  h.n++;
  return h.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 10 * 60 * 1000).unref();

/* ------------------------------- join tokens ------------------------------- */

// A different key than the login token: a meeting token can never be used to call the normal API.
const KEY = () => `${env.JWT_SECRET}|meet`;

export interface MeetClaims { mid: string; pid: string; name: string; uid?: string; wait: boolean; host: boolean }

export const signMeetToken = (c: MeetClaims) => jwt.sign({ ...c }, KEY(), { expiresIn: "12h", audience: "meet" } as jwt.SignOptions);
export const verifyMeetToken = (t: string) => jwt.verify(t, KEY(), { audience: "meet" }) as unknown as MeetClaims;

/* ------------------------------- TURN / STUN ------------------------------- */

/**
 * STUN is free (Google). For people behind strict firewalls add a TURN server in .env:
 *   TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
 *   TURN_SECRET=<coturn static-auth-secret>      (recommended: short-lived passwords)
 *   or TURN_USERNAME + TURN_CREDENTIAL            (fixed password)
 */
export function iceServers(who: string) {
  const servers: Record<string, unknown>[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const urls = (process.env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (urls.length) {
    if (process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${who}`;
      servers.push({ urls, username, credential: crypto.createHmac("sha1", process.env.TURN_SECRET).update(username).digest("base64") });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      servers.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
  }
  return servers;
}

/* ------------------------------- who may enter ------------------------------- */

/**
 *  allowed  = may open this meeting at all
 *  trusted  = skips the waiting room and the passcode (host, invited people, and team members of workspace / open meetings)
 *  Workspace admins may manage a meeting but do NOT get into a private (invited only) meeting by that.
 */
export async function entryFor(m: any, userId?: string) {
  const isHost = !!userId && String(m.hostId) === userId;
  const access = userId ? await getAccess(m.workspaceId, userId) : null;
  const member = !!access && access.perms.has("meetings.view");
  const invited = !!userId && (m.invitedUserIds || []).some((i: unknown) => String(i) === userId);
  const allowed = isHost || invited || (m.access === "workspace" && member) || m.access === "open";
  const trusted = isHost || invited || (member && m.access !== "invited");
  return { allowed, trusted, isHost, member, invited };
}