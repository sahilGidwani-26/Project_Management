/** Who is inside which meeting right now. The live signaling server (Part 2) fills this in. */
export const liveCounts = new Map<string, number>();
export const liveCount = (meetingId: string) => liveCounts.get(meetingId) || 0;

type EndHook = (meetingId: string, reason: string) => void;
type ChangedHook = (meetingId: string) => void;
let endHook: EndHook | null = null;
let changedHook: ChangedHook | null = null;

export const setRoomHooks = (h: { end: EndHook; changed: ChangedHook }) => { endHook = h.end; changedHook = h.changed; };
/** Kicks everybody out of a live meeting (the host ended it). */
export const forceEnd = (meetingId: string, reason = "ended") => endHook?.(meetingId, reason);
/** Tells a live meeting that its settings (lock, chat, share rule...) changed in the database. */
export const notifyChanged = (meetingId: string) => changedHook?.(meetingId);