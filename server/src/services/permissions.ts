import { WorkspaceMember, WorkspaceRole } from "../models/WorkspaceMember";
import { AccessRole } from "../models/AccessRole";

/* ------------------------------ the catalog ------------------------------ */

export interface PermAction { key: string; perm: string; label: string; requires: string[] }
export interface PermModule { key: string; label: string; description: string; actions: PermAction[] }

// Extra "needs" on top of "every action needs the module's view". Names and photos (people.view) are needed to pick people.
const EXTRA_REQUIRES: Record<string, string[]> = {
  "tasks.assign": ["people.view"],
  "projects.members": ["people.view"],
  "calendar.create": ["people.view"],
  "chat.view": ["people.view"],
  "roles.manage": ["people.view"],
  "roles.assign": ["people.view"],
};

function mod(key: string, label: string, description: string, actions: [string, string][]): PermModule {
  const hasView = actions.some(([k]) => k === "view");
  return {
    key, label, description,
    actions: actions.map(([k, l]) => {
      const perm = `${key}.${k}`;
      return { key: k, perm, label: l, requires: [...(k !== "view" && hasView ? [`${key}.view`] : []), ...(EXTRA_REQUIRES[perm] || [])] };
    }),
  };
}

export const CATALOG: PermModule[] = [
  mod("dashboard", "Dashboard", "The workspace home page", [["view", "See the dashboard"]]),
  mod("projects", "Projects", "The projects list and every project's overview", [
    ["view", "View projects"], ["create", "Create projects"], ["edit", "Edit project details"], ["archive", "Archive and restore projects"],
    ["delete", "Delete projects"], ["members", "Manage project members and roles"], ["templates", "Duplicate and save as template"], ["export", "Export project data"],
  ]),
  mod("milestones", "Milestones", "Checkpoints inside a project", [["view", "View milestones"], ["edit", "Create and edit milestones"], ["delete", "Delete milestones"]]),
  mod("tasks", "Tasks", "Tasks, subtasks and My Tasks", [
    ["view", "View tasks"], ["create", "Create tasks"], ["edit", "Edit tasks"], ["assign", "Assign tasks to other people"], ["delete", "Delete tasks"], ["comment", "Comment on tasks"],
  ]),
  mod("bugs", "Bugs", "The Bugs tab", [["view", "View bugs"], ["create", "Report bugs"], ["edit", "Edit bugs"], ["delete", "Delete bugs"]]),
  mod("releases", "Releases", "Releases and changelogs", [["view", "View releases"], ["edit", "Create and edit releases"], ["publish", "Publish releases"], ["delete", "Delete releases"]]),
  mod("github", "GitHub", "The GitHub integration of a project", [["view", "View pull requests and commits"], ["configure", "Connect and configure GitHub"]]),
  mod("sprints", "Sprints", "Sprint planning", [["view", "View sprints"], ["edit", "Create and edit sprints"], ["run", "Start and complete sprints"], ["delete", "Delete sprints"]]),
  mod("sprint_reports", "Sprint reports", "Burndown, velocity and flow", [["view", "View sprint reports"]]),
  mod("forecast", "Delivery forecast", "Forecast of finish dates", [["view", "View forecasts"]]),
  mod("standup", "Standup", "Daily standup", [["view", "View own standup"], ["team", "View the team's standup"]]),
  mod("poker", "Planning poker", "Estimation sessions", [["view", "View sessions"], ["vote", "Vote in sessions"], ["facilitate", "Start and run sessions"]]),
  mod("files", "Files", "Project files", [["view", "View and download files"], ["upload", "Upload files"], ["delete", "Delete files"]]),
  mod("discussion", "Discussion", "Project discussion", [["view", "Read the discussion"], ["post", "Post messages"], ["moderate", "Pin or delete other people's messages"]]),
  mod("timeline", "Timeline and dependencies", "Gantt chart and task dependencies", [["view", "View the timeline"], ["edit", "Manage task dependencies"]]),
  mod("risks", "Risks and issues", "Risk register", [["view", "View risks"], ["edit", "Create and edit risks"], ["delete", "Delete risks"]]),
  mod("time", "Time tracking", "Logged hours", [["view", "View time entries"], ["log", "Log own time"], ["delete", "Delete other people's time entries"]]),
  mod("automation", "Automation", "Rules and recurring tasks", [["view", "View automation"], ["edit", "Create and edit automation"]]),
  mod("reports", "Project reports", "The Reports tab", [["view", "View project reports"], ["export", "Export reports"]]),
  mod("analytics", "Workspace analytics", "The Analytics page", [["view", "View analytics"]]),
  mod("calendar", "Calendar", "Meetings and events", [["view", "View the calendar"], ["create", "Create events and meetings"]]),
  mod("chat", "Team chat", "Channels and direct messages", [["view", "Use team chat"], ["send", "Send messages"], ["channels", "Create channels"]]),
  mod("people", "People", "The team directory and profiles", [
    ["view", "See names, photos and roles"], ["progress", "See a person's progress"], ["private", "See private details (phone, address)"],
    ["invite", "Add and invite people"], ["edit", "Edit other people's profiles"], ["deactivate", "Deactivate and remove people"], ["bulk", "Import and export people"],
  ]),
  mod("roles", "Roles and permissions", "This role system itself", [["view", "View roles"], ["manage", "Create, edit and delete roles"], ["assign", "Give roles to people"]]),
  mod("workspace", "Workspace", "Workspace-wide settings", [["edit", "Edit workspace settings"], ["delete", "Delete the workspace"]]),
];

export const ALL_PERMS: string[] = CATALOG.flatMap((m) => m.actions.map((a) => a.perm));
export const PERM_SET = new Set(ALL_PERMS);
const REQUIRES = new Map(CATALOG.flatMap((m) => m.actions.map((a) => [a.perm, a.requires] as const)));
export const PERM_LABELS = new Map(CATALOG.flatMap((m) => m.actions.map((a) => [a.perm, `${m.label}: ${a.label}`] as const)));

/** Drops unknown permissions and adds the ones every chosen permission depends on. Result is in catalog order. */
export function normalize(list: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const p of list) if (PERM_SET.has(p)) set.add(p);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...set]) for (const r of REQUIRES.get(p) || []) if (!set.has(r)) { set.add(r); changed = true; }
  }
  return ALL_PERMS.filter((p) => set.has(p));
}

/* ----------------------------- built-in roles ----------------------------- */

const views = ALL_PERMS.filter((p) => p.endsWith(".view") && p !== "roles.view");
const memberExtra = [
  "tasks.create", "tasks.edit", "tasks.assign", "tasks.comment", "bugs.create", "bugs.edit", "milestones.edit", "releases.edit", "sprints.edit", "sprints.run",
  "timeline.edit", "risks.edit", "time.log", "files.upload", "discussion.post", "poker.vote", "poker.facilitate", "calendar.create", "chat.send",
];
const managerExtra = [
  "projects.create", "projects.edit", "projects.archive", "projects.members", "projects.templates", "projects.export", "milestones.delete", "tasks.delete", "bugs.delete",
  "releases.publish", "releases.delete", "github.configure", "sprints.delete", "standup.team", "files.delete", "discussion.moderate", "risks.delete", "time.delete",
  "automation.edit", "reports.export", "chat.channels", "people.progress",
];

export const DEFAULT_PERMS: Record<WorkspaceRole, string[]> = {
  OWNER: ALL_PERMS,
  ADMIN: ALL_PERMS.filter((p) => p !== "workspace.delete"),
  PROJECT_MANAGER: normalize([...views, ...memberExtra, ...managerExtra]),
  MEMBER: normalize([...views, ...memberExtra]),
  VIEWER: normalize(views),
};

export const SYSTEM_META: { key: WorkspaceRole; name: string; color: string; description: string }[] = [
  { key: "OWNER", name: "Owner", color: "#7C3AED", description: "Full control. Always has every permission." },
  { key: "ADMIN", name: "Admin", color: "#2563EB", description: "Manages people, projects and settings." },
  { key: "PROJECT_MANAGER", name: "Project Manager", color: "#0F766E", description: "Creates and runs projects, sees team progress." },
  { key: "MEMBER", name: "Member", color: "#475569", description: "Works on tasks in the projects they are in." },
  { key: "VIEWER", name: "Viewer", color: "#D97706", description: "Read-only access." },
];
export const SYSTEM_ORDER = SYSTEM_META.map((m) => m.key);

/**
 * The old hard-coded checks still look at `member.role`. For a custom role we store the strongest built-in role
 * whose permissions the custom role fully contains, so those old checks can never give MORE than the custom role allows.
 */
export function compatRole(perms: Set<string>): WorkspaceRole {
  for (const r of ["ADMIN", "PROJECT_MANAGER", "MEMBER"] as WorkspaceRole[]) if (DEFAULT_PERMS[r].every((p) => perms.has(p))) return r;
  return "VIEWER";
}

/* -------------------------------- seeding -------------------------------- */

const seeded = new Set<string>();

/** Creates the 5 built-in roles of a workspace the first time anything needs them. */
export async function ensureSystemRoles(workspaceId: string) {
  if (seeded.has(workspaceId)) return;
  const have: string[] = await AccessRole.find({ workspaceId, systemKey: { $in: SYSTEM_ORDER } }).distinct("systemKey");
  const missing = SYSTEM_META.filter((m) => !have.includes(m.key));
  if (missing.length) {
    try {
      await AccessRole.insertMany(
        missing.map((m) => ({ workspaceId, name: m.name, nameLower: m.name.toLowerCase(), description: m.description, color: m.color, systemKey: m.key, scope: "all", permissions: DEFAULT_PERMS[m.key] })),
        { ordered: false }
      );
    } catch (e: any) {
      if (e?.code !== 11000 && !e?.writeErrors) throw e; // another request seeded at the same moment
    }
  }
  seeded.add(workspaceId);
}

/* -------------------------------- resolving -------------------------------- */

export interface AccessCtx {
  userId: string;
  memberId: string;
  legacyRole: WorkspaceRole;
  roleId: string | null;
  roleKey: WorkspaceRole | null;
  roleName: string;
  roleColor: string | null;
  isOwner: boolean;
  scope: "all" | "member";
  perms: Set<string>;
}

/** Everything a person can do in a workspace (null = not an active member). */
export async function getAccess(workspaceId: unknown, userId: string): Promise<AccessCtx | null> {
  const wid = String(workspaceId);
  const member: any = await WorkspaceMember.findOne({ workspaceId: wid, userId, status: "active" }).select("role roleId").lean();
  if (!member) return null;
  await ensureSystemRoles(wid);

  let role: any = member.roleId ? await AccessRole.findOne({ _id: member.roleId, workspaceId: wid }).lean() : null;
  // A custom role is only trusted while the member's stored base role still matches it (guards against stale data).
  if (role && !role.systemKey && compatRole(new Set(normalize(role.permissions))) !== member.role) role = null;
  if (!role) role = await AccessRole.findOne({ workspaceId: wid, systemKey: member.role }).lean();

  const isOwner = member.role === "OWNER" && (!role || role.systemKey === "OWNER");
  const perms = new Set(isOwner ? ALL_PERMS : normalize(role?.permissions ?? DEFAULT_PERMS[member.role as WorkspaceRole] ?? []));
  return {
    userId, memberId: String(member._id), legacyRole: member.role,
    roleId: role ? String(role._id) : null, roleKey: role?.systemKey ?? null,
    roleName: role?.name ?? member.role, roleColor: role?.color ?? null,
    isOwner, scope: isOwner ? "all" : role?.scope === "member" ? "member" : "all", perms,
  };
}

/** Adds roleName / roleColor / roleRefId to member objects, so lists can show custom role names. */
export async function attachRoleInfo(workspaceId: string, members: any[]) {
  await ensureSystemRoles(workspaceId);
  const roles: any[] = await AccessRole.find({ workspaceId }).select("name color systemKey").lean();
  const byId = new Map(roles.map((r) => [String(r._id), r]));
  const bySystem = new Map(roles.filter((r) => r.systemKey).map((r) => [r.systemKey, r]));
  return members.map((m) => {
    const r = (m.roleId && byId.get(String(m.roleId))) || bySystem.get(m.role);
    return { ...m, roleRefId: r ? String(r._id) : null, roleName: r?.name || m.role, roleColor: r?.color || null };
  });
}