import { env } from "../config/env";
import { esc, wrap } from "./emailTemplates";

const d = (v?: Date | string | null) => (v ? new Date(v).toDateString() : "—");
const b = (s: string) => `<strong>${esc(s)}</strong>`;

export const buildProjectUrl = (workspaceId: unknown, projectId: unknown, tab = "overview") =>
  `${env.CLIENT_URL}/app/${workspaceId}/projects/${projectId}/${tab}`;

const heading = (t: string) => `<p style="font-size:16px;font-weight:600;margin-top:8px;">${esc(t)}</p>`;
const box = (t: string) =>
  `<p style="margin-top:12px;padding:12px;background:#f3f4f6;border-radius:6px;color:#4b5563;">${esc(t).replace(/\n/g, "<br>")}</p>`;
const table = (rows: [string, string][]) =>
  rows.length
    ? `<table style="margin-top:12px;font-size:14px;border-collapse:collapse;">${rows
        .map(([l, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top;">${l}</td><td style="padding:4px 0;">${esc(v)}</td></tr>`)
        .join("")}</table>`
    : "";

const mail = (subject: string, title: string, intro: string, name: string, rows: [string, string][], extra: string, url?: string, cta?: string) => ({
  subject,
  html: wrap(title, `<p>${intro}</p>${heading(name)}${table(rows)}${extra}`, url, cta),
});

/* Membership */
export const projectMemberAddedEmail = (p: { projectName: string; byName: string; role: string; url: string }) =>
  mail(`You were added to "${p.projectName}"`, "You've been added to a project", `${b(p.byName)} added you to a project:`, p.projectName, [["Your role", p.role]], "", p.url, "Open project");

export const projectMemberRemovedEmail = (p: { projectName: string; byName: string }) =>
  mail(`You were removed from "${p.projectName}"`, "Removed from a project", `${b(p.byName)} removed you from a project:`, p.projectName, [], box("You no longer have access to this project's tasks and files."));

export const projectRoleChangedEmail = (p: { projectName: string; byName: string; role: string; url: string }) =>
  mail(`Your role changed in "${p.projectName}"`, "Your project role changed", `${b(p.byName)} changed your role in:`, p.projectName, [["New role", p.role]], "", p.url, "Open project");

/* Lifecycle */
export const projectStatusChangedEmail = (p: { projectName: string; from: string; to: string; byName: string; url: string }) =>
  mail(`"${p.projectName}" is now ${p.to}`, "Project status changed", `${b(p.byName)} changed the status of a project you're part of:`, p.projectName, [["Status", `${p.from} → ${p.to}`]], "", p.url, "View project");

export const projectUpdatedEmail = (p: { projectName: string; byName: string; changes: string[]; url: string }) =>
  mail(`"${p.projectName}" was updated`, "Project updated", `${b(p.byName)} updated a project you're part of:`, p.projectName, [], box(p.changes.join("\n")), p.url, "View project");

export const projectArchivedEmail = (p: { projectName: string; byName: string; archived: boolean; url: string }) =>
  mail(
    `${p.archived ? "Archived" : "Restored"}: "${p.projectName}"`,
    p.archived ? "Project archived" : "Project restored",
    `${b(p.byName)} ${p.archived ? "archived" : "restored"} this project:`,
    p.projectName,
    [],
    p.archived ? box("It is now read-only history and hidden from the active projects list.") : "",
    p.url,
    "View project"
  );

export const projectDeletedEmail = (p: { projectName: string; byName: string }) =>
  mail(`Deleted: "${p.projectName}"`, "Project deleted", `${b(p.byName)} deleted a project you were part of:`, p.projectName, [], box("All of its tasks, files and history were removed."));

export const projectDeadlineEmail = (p: { projectName: string; endDate: Date; overdue: boolean; url: string }) =>
  mail(
    p.overdue ? `Overdue: "${p.projectName}"` : `Due soon: "${p.projectName}"`,
    p.overdue ? "A project is overdue" : "A project is due soon",
    p.overdue ? "This project passed its end date:" : "This project ends soon:",
    p.projectName,
    [["End date", d(p.endDate)]],
    "",
    p.url,
    "View project"
  );

/* Milestones / sprints */
export const milestoneEmail = (p: { kind: "created" | "completed" | "dueSoon" | "overdue"; projectName: string; title: string; dueDate?: Date | string | null; byName?: string; url: string }) => {
  const map = {
    created: [`New milestone: "${p.title}"`, "New milestone", `${p.byName ? b(p.byName) + " added" : "Added"} a milestone in ${b(p.projectName)}:`],
    completed: [`Milestone reached: "${p.title}"`, "Milestone completed", `A milestone in ${b(p.projectName)} was completed:`],
    dueSoon: [`Milestone due soon: "${p.title}"`, "Milestone due soon", `A milestone in ${b(p.projectName)} is due soon:`],
    overdue: [`Milestone overdue: "${p.title}"`, "Milestone overdue", `A milestone in ${b(p.projectName)} is overdue:`],
  }[p.kind];
  return mail(map[0], map[1], map[2], p.title, [["Due", d(p.dueDate)]], "", p.url, "View milestones");
};

export const sprintEmail = (p: { kind: "started" | "completed"; projectName: string; name: string; goal?: string; endDate?: Date | string | null; done?: number; total?: number; byName: string; url: string }) =>
  mail(
    `Sprint ${p.kind}: "${p.name}"`,
    p.kind === "started" ? "Sprint started" : "Sprint completed",
    `${b(p.byName)} ${p.kind} a sprint in ${b(p.projectName)}:`,
    p.name,
    p.kind === "started" ? [["Ends", d(p.endDate)]] : [["Completed tasks", `${p.done ?? 0} of ${p.total ?? 0}`]],
    p.goal ? box(`Goal: ${p.goal}`) : "",
    p.url,
    "Open sprints"
  );

/* Collaboration */
export const projectMentionEmail = (p: { projectName: string; byName: string; snippet: string; url: string }) =>
  mail(`${p.byName} mentioned you in "${p.projectName}"`, "You were mentioned", `${b(p.byName)} mentioned you in the discussion of ${b(p.projectName)}:`, "", [], box(p.snippet), p.url, "Reply");

export const projectFileEmail = (p: { projectName: string; fileNames: string[]; byName: string; url: string }) =>
  mail(`New file${p.fileNames.length > 1 ? "s" : ""} in "${p.projectName}"`, "New project file", `${b(p.byName)} uploaded to ${b(p.projectName)}:`, p.fileNames.slice(0, 5).join(", ") + (p.fileNames.length > 5 ? ` +${p.fileNames.length - 5} more` : ""), [], "", p.url, "View files");

export const riskEmail = (p: { kind: "raised" | "assigned" | "resolved"; type: string; title: string; severity: string; projectName: string; byName: string; url: string }) =>
  mail(
    p.kind === "resolved" ? `${p.type} resolved: "${p.title}"` : `${p.severity} ${p.type.toLowerCase()}: "${p.title}"`,
    p.kind === "assigned" ? `You own a ${p.type.toLowerCase()}` : p.kind === "resolved" ? `${p.type} resolved` : `${p.type} raised`,
    `${b(p.byName)} ${p.kind === "assigned" ? "assigned you" : p.kind === "resolved" ? "resolved" : "raised"} a ${p.type.toLowerCase()} in ${b(p.projectName)}:`,
    p.title,
    [["Severity", p.severity]],
    "",
    p.url,
    "View risks"
  );

export const automationEmail = (p: { ruleName: string; projectName: string; taskTitle: string; message: string; url: string }) =>
  mail(`${p.projectName}: ${p.taskTitle}`, "Automation notification", `An automation rule (${b(p.ruleName)}) fired in ${b(p.projectName)}:`, p.taskTitle, [], box(p.message), p.url, "View task");


export const bugReportedEmail = (p: { title: string; severity: string; projectName: string; byName: string; environment?: string; steps?: string; url: string }) => {
  const rows: [string, string][] = [["Severity", p.severity]];
  if (p.environment) rows.push(["Environment", p.environment]);
  return mail(
    `${p.severity} bug: "${p.title}"`,
    "Critical bug reported",
    `${b(p.byName)} reported a ${p.severity.toLowerCase()} bug in ${b(p.projectName)}:`,
    p.title,
    rows,
    p.steps ? box(`Steps to reproduce:\n${p.steps}`) : "",
    p.url,
    "View bug"
  );
};


export const releaseEmail = (p: { kind: "planned" | "published" | "dueSoon" | "overdue"; projectName: string; name: string; plannedDate?: Date | string | null; byName?: string; summary?: string; url: string }) => {
  const map = {
    planned: [`New release planned: ${p.name}`, "Release planned", `${p.byName ? b(p.byName) + " planned" : "Planned"} a release in ${b(p.projectName)}:`],
    published: [`Released: ${p.name} (${p.projectName})`, "Release published", `${p.byName ? b(p.byName) + " published" : "Published"} a release in ${b(p.projectName)}:`],
    dueSoon: [`Release due soon: ${p.name}`, "Release due soon", `A release in ${b(p.projectName)} is planned for soon:`],
    overdue: [`Release overdue: ${p.name}`, "Release overdue", `A planned release in ${b(p.projectName)} has passed its date:`],
  }[p.kind];
  const rows: [string, string][] = p.kind === "published" ? [] : [["Planned date", d(p.plannedDate)]];
  return mail(map[0], map[1], map[2], p.name, rows, p.summary ? box(p.summary) : "", p.url, "View release");
};