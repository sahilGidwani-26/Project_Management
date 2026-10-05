import { env } from "../config/env";

export const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const wrap = (title: string, bodyHtml: string, ctaUrl?: string, ctaLabel?: string) => `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
    <div style="padding: 24px 0 8px;">
      <span style="font-size: 18px; font-weight: 700; color: #0f766e;">Flowbase</span>
    </div>
    <h2 style="font-size: 18px; margin: 16px 0 8px;">${title}</h2>
    <div style="font-size: 14px; line-height: 1.6; color: #374151;">${bodyHtml}</div>
    ${
      ctaUrl
        ? `<a href="${ctaUrl}" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${ctaLabel}</a>`
        : ""
    }
    <p style="margin-top:32px;font-size:12px;color:#9ca3af;">You're receiving this because you're a member of a workspace on Flowbase.</p>
  </div>
`;

/* ---------------------------- Task emails ---------------------------- */

export function taskAssignedEmail(params: {
  taskTitle: string;
  projectName: string;
  assignedByName: string;
  dueDate?: Date;
  taskUrl: string;
}) {
  const dueLine = params.dueDate
    ? `<p style="margin-top:12px;"><strong>Due:</strong> ${params.dueDate.toDateString()}</p>`
    : "";
  return {
    subject: `You were assigned: "${params.taskTitle}"`,
    html: wrap(
      "You've been assigned a task",
      `<p><strong>${esc(params.assignedByName)}</strong> assigned you a task in <strong>${esc(params.projectName)}</strong>:</p>
       <p style="font-size:15px;font-weight:600;margin-top:8px;">${esc(params.taskTitle)}</p>
       ${dueLine}`,
      params.taskUrl,
      "View task"
    ),
  };
}

export function taskMentionEmail(params: {
  taskTitle: string;
  mentionedByName: string;
  commentSnippet: string;
  taskUrl: string;
}) {
  return {
    subject: `${params.mentionedByName} mentioned you on "${params.taskTitle}"`,
    html: wrap(
      "You were mentioned",
      `<p><strong>${esc(params.mentionedByName)}</strong> mentioned you in a comment on:</p>
       <p style="font-size:15px;font-weight:600;margin-top:8px;">${esc(params.taskTitle)}</p>
       <p style="margin-top:12px;padding:12px;background:#f3f4f6;border-radius:6px;color:#4b5563;">"${esc(params.commentSnippet)}"</p>`,
      params.taskUrl,
      "Reply"
    ),
  };
}

export function taskDueSoonEmail(params: { taskTitle: string; projectName: string; dueDate: Date; taskUrl: string }) {
  return {
    subject: `Reminder: "${params.taskTitle}" is due soon`,
    html: wrap(
      "A task you're on is due soon",
      `<p>This task in <strong>${esc(params.projectName)}</strong> is due soon:</p>
       <p style="font-size:15px;font-weight:600;margin-top:8px;">${esc(params.taskTitle)}</p>
       <p style="margin-top:12px;"><strong>Due:</strong> ${params.dueDate.toDateString()}</p>`,
      params.taskUrl,
      "View task"
    ),
  };
}

export function buildTaskUrl(workspaceId: string, projectId: string | undefined, taskId: string) {
  if (projectId) return `${env.CLIENT_URL}/app/${workspaceId}/projects/${projectId}/board?task=${taskId}`;
  return `${env.CLIENT_URL}/app/${workspaceId}/tasks?task=${taskId}`;
}

/* --------------------------- Calendar emails --------------------------- */

function safeTimezone(tz?: string): string {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    // fall through to UTC
  }
  return "UTC";
}

/** e.g. "Tuesday, 30 September 2026, 3:00 pm – 4:00 pm (Asia/Kolkata)" */
export function formatWhen(start: Date, end: Date, tz?: string): string {
  const timeZone = safeTimezone(tz);
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(start);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone });
  return `${day}, ${time.format(start)} – ${time.format(end)} (${timeZone})`;
}

export function buildEventUrl(workspaceId: string, eventId: string) {
  return `${env.CLIENT_URL}/app/${workspaceId}/calendar?event=${eventId}`;
}

function detailsTable(rows: [string, string][]) {
  return `<table style="margin-top:12px;font-size:14px;border-collapse:collapse;">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top;">${label}</td><td style="padding:4px 0;">${value}</td></tr>`
    )
    .join("")}</table>`;
}

export function meetingInviteEmail(p: {
  kind: "invite" | "updated";
  type: "meeting" | "event";
  title: string;
  organizerName: string;
  when: string;
  description?: string;
  location?: string;
  joinUrl?: string;
  eventUrl: string;
}) {
  const noun = p.type === "meeting" ? "meeting" : "event";
  const isNew = p.kind === "invite";
  const heading = isNew ? `You're invited to a ${noun}` : `This ${noun} was updated`;

  const rows: [string, string][] = [["When", esc(p.when)]];
  if (p.joinUrl) rows.push(["Join", `<a href="${esc(p.joinUrl)}" style="color:#0f766e;">${esc(p.joinUrl)}</a>`]);
  if (p.location) rows.push(["Where", esc(p.location)]);

  const descriptionHtml = p.description
    ? `<p style="margin-top:12px;padding:12px;background:#f3f4f6;border-radius:6px;color:#4b5563;">${esc(p.description).replace(/\n/g, "<br>")}</p>`
    : "";

  const body = `
    <p><strong>${esc(p.organizerName)}</strong> ${isNew ? "invited you to" : "updated"} a ${noun}:</p>
    <p style="font-size:16px;font-weight:600;margin-top:8px;">${esc(p.title)}</p>
    ${detailsTable(rows)}
    ${descriptionHtml}
    <p style="margin-top:16px;font-size:13px;color:#6b7280;">A calendar invite (.ics) is attached — accept it to add this to Google, Outlook or Apple Calendar.
    You can also <a href="${p.eventUrl}" style="color:#0f766e;">open it in Flowbase</a> to see details and meeting notes.</p>
  `;

  return {
    subject: `${isNew ? "Invitation" : "Updated"}: ${p.title} — ${p.when.split(",").slice(0, 2).join(",")}`,
    html: wrap(heading, body, p.joinUrl || p.eventUrl, p.joinUrl ? "Join meeting" : "View event"),
  };
}

export function meetingCancelledEmail(p: {
  type: "meeting" | "event";
  title: string;
  organizerName: string;
  when: string;
}) {
  const noun = p.type === "meeting" ? "meeting" : "event";
  return {
    subject: `Cancelled: ${p.title}`,
    html: wrap(
      `This ${noun} was cancelled`,
      `<p><strong>${esc(p.organizerName)}</strong> cancelled:</p>
       <p style="font-size:16px;font-weight:600;margin-top:8px;">${esc(p.title)}</p>
       ${detailsTable([["Was scheduled", esc(p.when)]])}`
    ),
  };
}


