import { env } from "../config/env";
import { esc, wrap } from "./emailTemplates";

const label = (role: string) => role.toLowerCase().replace(/_/g, " ");
const b = (s: string) => `<strong>${esc(s)}</strong>`;
const box = (html: string) => `<div style="margin-top:12px;padding:12px;background:#f3f4f6;border-radius:6px;color:#374151;">${html}</div>`;
const table = (rows: [string, string][]) =>
  `<table style="margin-top:12px;font-size:14px;border-collapse:collapse;">${rows
    .map(([l, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top;">${l}</td><td style="padding:4px 0;">${v}</td></tr>`)
    .join("")}</table>`;

export const loginUrl = () => `${env.CLIENT_URL}/login`;

export const workspaceInviteEmail = (p: { workspaceName: string; inviterName: string; role: string; url: string; expiresOn: Date }) => ({
  subject: `${p.inviterName} invited you to ${p.workspaceName}`,
  html: wrap(
    "You're invited to a workspace",
    `<p>${b(p.inviterName)} invited you to join ${b(p.workspaceName)} on Flowbase as <b>${esc(label(p.role))}</b>.</p>
     <p style="margin-top:8px;">Log in (or sign up) with <b>this email address</b>, then accept the invitation. The link expires on ${esc(p.expiresOn.toDateString())}.</p>`,
    p.url,
    "Accept invitation"
  ),
});

export const accountCreatedEmail = (p: { workspaceName: string; creatorName: string; email: string; role: string; password?: string; resent?: boolean }) => ({
  subject: p.resent ? `Your new login details for ${p.workspaceName}` : `Your account on ${p.workspaceName} is ready`,
  html: wrap(
    p.resent ? "Your new login details" : "Your account is ready",
    `<p>${b(p.creatorName)} ${p.resent ? "reset your temporary login for" : "created an account for you in"} ${b(p.workspaceName)} as <b>${esc(label(p.role))}</b>.</p>
     ${table([["Login email", esc(p.email)], ...(p.password ? ([["Temporary password", `<code style="font-size:15px;">${esc(p.password)}</code>`]] as [string, string][]) : [])])}
     ${box("For your security you will be asked to choose a new password the first time you log in. Please do not share this email.")}`,
    loginUrl(),
    "Log in"
  ),
});

export const addedToWorkspaceEmail = (p: { workspaceName: string; byName: string; role: string; url: string }) => ({
  subject: `You were added to ${p.workspaceName}`,
  html: wrap(
    "You were added to a workspace",
    `<p>${b(p.byName)} added you to ${b(p.workspaceName)} as <b>${esc(label(p.role))}</b>. Log in with your existing account to start.</p>`,
    p.url,
    "Open workspace"
  ),
});

export const inviteAcceptedEmail = (p: { memberName: string; workspaceName: string; role: string; url: string }) => ({
  subject: `${p.memberName} joined ${p.workspaceName}`,
  html: wrap("Invitation accepted", `<p>${b(p.memberName)} accepted your invitation and joined ${b(p.workspaceName)} as <b>${esc(label(p.role))}</b>.</p>`, p.url, "View team"),
});

export const memberRoleChangedEmail = (p: { workspaceName: string; byName: string; from: string; to: string; url: string }) => ({
  subject: `Your role in ${p.workspaceName} changed`,
  html: wrap(
    "Your role changed",
    `<p>${b(p.byName)} changed your role in ${b(p.workspaceName)}:</p>${table([["Role", `${esc(label(p.from))} → <b>${esc(label(p.to))}</b>`]])}`,
    p.url,
    "Open workspace"
  ),
});

export const memberDeactivatedEmail = (p: { workspaceName: string; byName: string }) => ({
  subject: `Your access to ${p.workspaceName} was paused`,
  html: wrap(
    "Your access was paused",
    `<p>${b(p.byName)} deactivated your account in ${b(p.workspaceName)}. You cannot open this workspace right now. Your work and history are kept.</p>
     <p style="margin-top:8px;">If you think this is a mistake, please contact a workspace admin.</p>`
  ),
});

export const memberReactivatedEmail = (p: { workspaceName: string; byName: string; url: string }) => ({
  subject: `Your access to ${p.workspaceName} is back`,
  html: wrap("Welcome back", `<p>${b(p.byName)} reactivated your account in ${b(p.workspaceName)}. You can log in again.</p>`, p.url, "Open workspace"),
});

export const memberRemovedEmail = (p: { workspaceName: string; byName: string }) => ({
  subject: `You were removed from ${p.workspaceName}`,
  html: wrap("You were removed from a workspace", `<p>${b(p.byName)} removed you from ${b(p.workspaceName)}. You no longer have access to it.</p>`),
});

export const bulkImportSummaryEmail = (p: { workspaceName: string; mode: "create" | "invite"; created: number; added: number; invited: number; failed: number; failures: string[]; url: string }) => {
  const rows: [string, string][] = [];
  if (p.created) rows.push(["Accounts created", String(p.created)]);
  if (p.added) rows.push(["Existing users added", String(p.added)]);
  if (p.invited) rows.push(["Invitations sent", String(p.invited)]);
  rows.push(["Failed", String(p.failed)]);
  const failures = p.failures.length
    ? box(`<b>Rows that did not go through:</b><br>${p.failures.map((f) => esc(f)).join("<br>")}${p.failed > p.failures.length ? `<br>…and ${p.failed - p.failures.length} more` : ""}`)
    : "";
  return {
    subject: `Bulk import finished for ${p.workspaceName}`,
    html: wrap(
      "Bulk import finished",
      `<p>Your ${p.mode === "invite" ? "invitation" : "account"} import into ${b(p.workspaceName)} is done.</p>${table(rows)}${failures}<p style="margin-top:12px;font-size:12px;color:#6b7280;">Passwords are never included in this email. Each new person received their own login email.</p>`,
      p.url,
      "View team"
    ),
  };
};