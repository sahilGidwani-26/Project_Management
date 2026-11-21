import { Globe, Lock, Users, type LucideIcon } from "lucide-react";
import { MeetingItem } from "@/types";

export const ACCESS: Record<string, { label: string; icon: LucideIcon; desc: string; cls: string }> = {
  invited: { label: "Invited only", icon: Lock, desc: "Only you and the people you choose. Even with the link nobody else can join.", cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  workspace: { label: "Workspace members", icon: Users, desc: "Any member of this workspace who has the link.", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  open: { label: "Anyone with the link", icon: Globe, desc: "Anybody, even without an account. Guests can wait in a waiting room and need the passcode.", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

/** Accepts "abc-defg-hij", "abcdefghij" or a whole meeting link and returns "abc-defg-hij" (or "" when it is not a meeting code). */
export function parseCode(input: string) {
  const seg = input.trim().split(/[/?#]/).filter(Boolean).pop() || "";
  const letters = seg.toLowerCase().replace(/[^a-z]/g, "");
  return letters.length === 10 ? `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}` : "";
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** ISO date -> value for <input type="datetime-local"> in the browser's own timezone. */
export function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export const fmtWhen = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

export function inviteText(m: Pick<MeetingItem, "title" | "link">, passcode?: string) {
  return `Join my meeting: ${m.title}\n${m.link}${passcode ? `\nPasscode: ${passcode}` : ""}`;
}

export function genPasscode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}