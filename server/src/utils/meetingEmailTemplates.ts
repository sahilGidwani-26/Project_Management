import { esc, wrap } from "./emailTemplates";

const b = (s: string) => `<strong>${esc(s)}</strong>`;
const table = (rows: [string, string][]) =>
  `<table style="margin-top:12px;font-size:14px;border-collapse:collapse;">${rows
    .map(([l, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top;">${l}</td><td style="padding:4px 0;">${esc(v)}</td></tr>`)
    .join("")}</table>`;
const when = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "Open now, join any time";

export const meetingInviteEmail = (p: { title: string; host: string; workspaceName: string; scheduledAt?: Date | null; link: string; passcode: boolean }) => ({
  subject: `${p.host} invited you to a meeting: ${p.title}`,
  html: wrap(
    "You are invited to a meeting",
    `<p>${b(p.host)} invited you to ${b(p.title)} in ${b(p.workspaceName)}.</p>${table([["When", when(p.scheduledAt)], ["Link", p.link], ...(p.passcode ? ([["Passcode", "Ask the host"]] as [string, string][]) : [])])}<p style="margin-top:12px;font-size:12px;color:#6b7280;">Log in to Flowbase with this email address to join. Use Chrome, Edge or Firefox with camera and microphone allowed.</p>`,
    p.link,
    "Join meeting"
  ),
});

export const meetingGuestInviteEmail = (p: { title: string; host: string; scheduledAt?: Date | null; link: string; passcode: boolean }) => ({
  subject: `${p.host} invited you to a video meeting: ${p.title}`,
  html: wrap(
    "You are invited to a video meeting",
    `<p>${b(p.host)} invited you to ${b(p.title)}.</p>${table([["When", when(p.scheduledAt)], ["Link", p.link], ...(p.passcode ? ([["Passcode", "Ask the host"]] as [string, string][]) : [])])}<p style="margin-top:12px;font-size:12px;color:#6b7280;">No account is needed. You may wait a moment until the host lets you in. Use Chrome, Edge or Firefox.</p>`,
    p.link,
    "Join meeting"
  ),
});