import { env } from "../config/env";
import { esc, wrap } from "./emailTemplates";

const b = (s: string) => `<strong>${esc(s)}</strong>`;
const box = (t: string) => `<p style="margin-top:12px;padding:12px;background:#f3f4f6;border-radius:6px;color:#4b5563;">${esc(t).replace(/\n/g, "<br>")}</p>`;
const table = (rows: [string, string][]) =>
  `<table style="margin-top:12px;font-size:14px;border-collapse:collapse;">${rows
    .map(([l, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top;">${l}</td><td style="padding:4px 0;">${esc(v)}</td></tr>`)
    .join("")}</table>`;
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const range = (f: string, t: string) => (f === t ? nice(f) : `${nice(f)} to ${nice(t)}`);

export const attendanceUrl = (workspaceId: unknown, tab = "") => `${env.CLIENT_URL}/app/${workspaceId}/attendance${tab ? `/${tab}` : ""}`;

export const checkInReminderEmail = (p: { name: string; workspaceName: string; shiftStart: string; url: string }) => ({
  subject: `Time to check in · ${p.workspaceName}`,
  html: wrap("Good morning, don't forget to check in", `<p>Hi ${esc(p.name.split(" ")[0] || p.name)}, your workday at ${b(p.workspaceName)} starts at <b>${esc(p.shiftStart)}</b> and you have not checked in yet.</p>`, p.url, "Check in now"),
});

export const checkOutReminderEmail = (p: { name: string; workspaceName: string; since: string; url: string }) => ({
  subject: `Don't forget to check out · ${p.workspaceName}`,
  html: wrap("You are still checked in", `<p>Hi ${esc(p.name.split(" ")[0] || p.name)}, you checked in at <b>${esc(p.since)}</b> and have not checked out yet. Please check out so your hours are counted correctly.</p>`, p.url, "Check out"),
});

export const leaveRequestedEmail = (p: { employee: string; workspaceName: string; type: string; from: string; to: string; days: number; reason: string; url: string }) => ({
  subject: `${p.employee} requested leave (${range(p.from, p.to)})`,
  html: wrap("New leave request", `<p>${b(p.employee)} requested leave in ${b(p.workspaceName)}:</p>${table([["Type", p.type], ["Dates", range(p.from, p.to)], ["Days", String(p.days)]])}${box(p.reason)}`, p.url, "Review request"),
});

export const leaveDecisionEmail = (p: { approved: boolean; workspaceName: string; type: string; from: string; to: string; days: number; by: string; note?: string; url: string }) => ({
  subject: `Your leave was ${p.approved ? "approved" : "declined"} (${range(p.from, p.to)})`,
  html: wrap(
    p.approved ? "Leave approved" : "Leave declined",
    `<p>${b(p.by)} ${p.approved ? "approved" : "declined"} your leave in ${b(p.workspaceName)}:</p>${table([["Type", p.type], ["Dates", range(p.from, p.to)], ["Days", String(p.days)]])}${p.note ? box(p.note) : ""}`,
    p.url,
    "View my leave"
  ),
});

export const leaveCancelledEmail = (p: { by: string; employee: string; workspaceName: string; type: string; from: string; to: string; revoked: boolean; url: string }) => ({
  subject: p.revoked ? `Your approved leave was cancelled (${range(p.from, p.to)})` : `${p.employee} cancelled a leave request`,
  html: wrap(
    p.revoked ? "Your leave was cancelled" : "Leave request cancelled",
    `<p>${b(p.by)} cancelled ${p.revoked ? "your" : `${esc(p.employee)}'s`} ${esc(p.type)} in ${b(p.workspaceName)}:</p>${table([["Dates", range(p.from, p.to)]])}`,
    p.url,
    "Open leave"
  ),
});

export const attendanceEditedEmail = (p: { workspaceName: string; date: string; by: string; note: string; summary: string; url: string }) => ({
  subject: `Your attendance for ${nice(p.date)} was updated`,
  html: wrap("Your attendance was updated", `<p>${b(p.by)} corrected your attendance in ${b(p.workspaceName)}:</p>${table([["Date", nice(p.date)], ["Now", p.summary]])}${box(`Reason: ${p.note}`)}`, p.url, "View my attendance"),
});