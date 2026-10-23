export interface AccessRule { perm?: string; any?: string[] }
export interface NavAccess extends AccessRule { to: string; label: string }

/** Workspace level pages (first URL part after /app/<workspaceId>/). */
export const NAV_ACCESS: NavAccess[] = [
  { to: "dashboard", label: "Dashboard", perm: "dashboard.view" },
  { to: "projects", label: "Projects", perm: "projects.view" },
  { to: "tasks", label: "Tasks", perm: "tasks.view" },
  { to: "my-tasks", label: "My Tasks", perm: "tasks.view" },
  { to: "standup", label: "Standup", perm: "standup.view" },
  { to: "calendar", label: "Calendar", perm: "calendar.view" },
  { to: "chat", label: "Team Chat", perm: "chat.view" },
  { to: "team", label: "Team", perm: "people.view" },
  { to: "analytics", label: "Analytics", perm: "analytics.view" },
  { to: "forecast", label: "Forecast", perm: "forecast.view" },
  { to: "roles", label: "Roles", perm: "roles.view" },
];

/** Tabs inside a project. */
export const PROJECT_TAB_ACCESS: NavAccess[] = [
  { to: "overview", label: "Overview", perm: "projects.view" },
  { to: "board", label: "Board", perm: "tasks.view" },
  { to: "list", label: "List", perm: "tasks.view" },
  { to: "bugs", label: "Bugs", perm: "bugs.view" },
  { to: "releases", label: "Releases", perm: "releases.view" },
  { to: "github", label: "GitHub", perm: "github.view" },
  { to: "timeline", label: "Timeline", perm: "timeline.view" },
  { to: "calendar", label: "Calendar", perm: "tasks.view" },
  { to: "sprints", label: "Sprints", perm: "sprints.view" },
  { to: "sprint-reports", label: "Sprint reports", perm: "sprint_reports.view" },
  { to: "forecast", label: "Forecast", perm: "forecast.view" },
  { to: "standup", label: "Standup", perm: "standup.team" },
  { to: "poker", label: "Poker", perm: "poker.view" },
  { to: "files", label: "Files", perm: "files.view" },
  { to: "discussion", label: "Discussion", perm: "discussion.view" },
  { to: "members", label: "Members", perm: "projects.view" },
  { to: "reports", label: "Reports", perm: "reports.view" },
  { to: "time", label: "Time", perm: "time.view" },
  { to: "risks", label: "Risks", perm: "risks.view" },
  { to: "automation", label: "Automation", perm: "automation.view" },
  { to: "settings", label: "Settings", any: ["projects.edit", "projects.archive", "projects.delete", "projects.templates", "projects.export"] },
];

export const ROUTE_ACCESS: Record<string, NavAccess> = Object.fromEntries(NAV_ACCESS.map((n) => [n.to, n]));

export const ruleAllowed = (r: AccessRule, can: (p: string) => boolean) => (r.perm ? can(r.perm) : r.any ? r.any.some(can) : true);

/** The first page this person may open (used after login and on "no access" pages). */
export function firstAllowed(can: (p: string) => boolean): NavAccess | null {
  return NAV_ACCESS.filter((n) => n.to !== "roles").find((n) => ruleAllowed(n, can)) || null;
}

/** Mirrors the server: can the logged-in person give this role to somebody? */
export function canGiveRole(
  r: { systemKey: string | null; permissions: string[]; scope: string },
  me: { perms: Set<string>; isOwner: boolean; scope: string }
) {
  if (me.isOwner) return true;
  if (r.systemKey === "OWNER") return false;
  if (me.scope === "member" && r.scope === "all") return false;
  return r.permissions.every((p) => me.perms.has(p));
}

/** Ticking a permission also ticks what it needs. Unticking one also unticks what depends on it. */
export function setPerm(cur: Set<string>, perm: string, on: boolean, requires: Map<string, string[]>) {
  const next = new Set(cur);
  if (on) {
    const stack = [perm];
    while (stack.length) {
      const p = stack.pop()!;
      if (next.has(p)) continue;
      next.add(p);
      (requires.get(p) || []).forEach((r) => stack.push(r));
    }
  } else {
    next.delete(perm);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of [...next]) {
        if ((requires.get(p) || []).some((r) => !next.has(r))) {
          next.delete(p);
          changed = true;
        }
      }
    }
  }
  return next;
}