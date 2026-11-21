import axios from "axios";

/** Meeting calls never redirect to /login by themselves: a guest has no account. The login token is sent when there is one. */
const pub = axios.create({ baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api", withCredentials: true });
pub.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("pm_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export interface MeetLookup {
  requiresLogin?: boolean;
  title?: string;
  hostName?: string;
  access?: "invited" | "workspace" | "open";
  requiresPasscode?: boolean;
  waiting?: boolean;
  locked?: boolean;
  guest?: boolean;
  displayName?: string;
  live?: number;
  maxParticipants?: number;
  scheduledAt?: string | null;
}

export interface MeetJoinResult {
  token: string;
  participantId: string;
  waiting: boolean;
  isHost: boolean;
  guest: boolean;
  name: string;
  iceServers: RTCIceServer[];
  meeting: { _id: string; title: string; shareBy: "everyone" | "host"; chatEnabled: boolean; maxParticipants: number };
}

export async function lookupMeeting(code: string): Promise<MeetLookup> {
  return (await pub.get(`/meetings/public/lookup/${encodeURIComponent(code)}`)).data.data;
}

export async function joinMeetingApi(code: string, body: { name?: string; passcode?: string }): Promise<MeetJoinResult> {
  return (await pub.post(`/meetings/public/join/${encodeURIComponent(code)}`, body)).data.data;
}

export function meetError(err: unknown): { status?: number; message: string } {
  const e = err as { response?: { status?: number; data?: { message?: string } } };
  return { status: e?.response?.status, message: e?.response?.data?.message || "Could not reach the server. Check your connection and try again." };
}