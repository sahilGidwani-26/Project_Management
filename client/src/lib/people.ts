import { toast } from "sonner";
import { EmploymentType, WorkspaceRole } from "@/types";

export const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"];

export const roleLabel = (r: string) =>
  r.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export const ROLE_INFO: Record<WorkspaceRole, string> = {
  OWNER: "Full control: workspace, members, projects and settings",
  ADMIN: "Manage projects, members and tasks (cannot touch an Owner)",
  PROJECT_MANAGER: "Create projects, manage projects and tasks, see team progress",
  MEMBER: "Work on permitted projects: create and update tasks, comment",
  VIEWER: "Read-only: cannot change anything",
};

export const roleCls: Record<WorkspaceRole, string> = {
  OWNER: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  ADMIN: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  PROJECT_MANAGER: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  MEMBER: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  VIEWER: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export const EMPLOYMENT: [EmploymentType, string][] = [
  ["full_time", "Full-time"],
  ["part_time", "Part-time"],
  ["contractor", "Contractor"],
  ["intern", "Intern"],
  ["client", "Client"],
  ["vendor", "Vendor"],
];
export const employmentLabel = (v?: string) => EMPLOYMENT.find(([k]) => k === v)?.[1] || "";

/** Mirrors the server: an Owner can give any role, an Admin up to Admin. */
export const assignableRoles = (mine?: WorkspaceRole): WorkspaceRole[] =>
  mine === "OWNER" ? ROLES : mine === "ADMIN" ? ROLES.filter((r) => r !== "OWNER") : [];
export const isAdminRole = (r?: string) => r === "OWNER" || r === "ADMIN";
export const isManagerRole = (r?: string) => r === "OWNER" || r === "ADMIN" || r === "PROJECT_MANAGER";

const ALL = ROLES;
export const PERMISSIONS: [string, WorkspaceRole[]][] = [
  ["View projects and tasks", ALL],
  ["Create and edit tasks, comment", ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER"]],
  ["Create projects, delete tasks", ["OWNER", "ADMIN", "PROJECT_MANAGER"]],
  ["See a person's progress", ["OWNER", "ADMIN", "PROJECT_MANAGER"]],
  ["Delete projects", ["OWNER", "ADMIN"]],
  ["Add, edit, deactivate and remove members", ["OWNER", "ADMIN"]],
  ["See phone, address and other private details", ["OWNER", "ADMIN"]],
  ["Give the Admin role", ["OWNER", "ADMIN"]],
  ["Give the Owner role, delete the workspace", ["OWNER"]],
];

/* ------------------------------- passwords ------------------------------- */

const rnd = (n: number) => {
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n; // avoids modulo bias
  let x = 0;
  do {
    crypto.getRandomValues(a);
    x = a[0];
  } while (x >= limit);
  return x % n;
};

/** Strong temporary password without look-alike characters (0/O, 1/l/I). */
export function genPassword(length = 12) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%&*?"];
  const all = sets.join("");
  const chars = sets.map((s) => s[rnd(s.length)]);
  while (chars.length < length) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function passwordIssue(p: string): string | null {
  if (p.length < 8) return "Password must be at least 8 characters";
  if (p.length > 72) return "Password is too long (72 characters at most)";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Password needs at least one letter and one number";
  return null;
}

export const copyText = (text: string, what = "Copied") =>
  navigator.clipboard.writeText(text).then(() => toast.success(what)).catch(() => toast.error("Could not copy"));