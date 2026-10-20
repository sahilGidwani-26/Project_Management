import crypto from "crypto";
import { WorkspaceMember, WorkspaceRole } from "../models/WorkspaceMember";
import { ApiError } from "../utils/ApiError";

export const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"];
export const RANK: Record<WorkspaceRole, number> = { VIEWER: 1, MEMBER: 2, PROJECT_MANAGER: 3, ADMIN: 4, OWNER: 5 };
export const EMPLOYMENT = ["full_time", "part_time", "contractor", "intern", "client", "vendor"];

export const isAdminRole = (r?: string) => r === "OWNER" || r === "ADMIN";
export const isManagerRole = (r?: string) => !!r && (RANK as Record<string, number>)[r] >= RANK.PROJECT_MANAGER;

/** Owner can give any role. Admin can give up to Admin, never Owner. */
export const canAssign = (actor: WorkspaceRole, role: WorkspaceRole) => actor === "OWNER" || (actor === "ADMIN" && RANK[role] <= RANK.ADMIN);
/** Owner can manage anybody. Admin can manage everybody except an Owner. */
export const canManageTarget = (actor: WorkspaceRole, target: WorkspaceRole) => actor === "OWNER" || (actor === "ADMIN" && target !== "OWNER");

export async function assertNotLastOwner(workspaceId: string, memberId: unknown) {
  const others = await WorkspaceMember.countDocuments({ workspaceId, status: "active", role: "OWNER", _id: { $ne: memberId } });
  if (!others) throw ApiError.badRequest("This is the only Owner of the workspace. Make someone else an Owner first.");
}

/* -------------------------------- passwords -------------------------------- */

export function generatePassword(length = 12) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "@#$%&*?"]; // no look-alike characters (0/O, 1/l/I)
  const all = sets.join("");
  const chars = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
    if (!/[A-Za-z0-9]/.test(chars[0])) {
    const k = chars.findIndex((c) => /[A-Za-z0-9]/.test(c));
    [chars[0], chars[k]] = [chars[k], chars[0]];
  }
  return chars.join("");
}

export function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Password must be at least 8 characters";
  if (Buffer.byteLength(p) > 72) return "Password is too long (72 characters at most)";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Password needs at least one letter and one number";
  return null;
}

/* ------------------------- profile / personal fields ------------------------- */

const PHONE = /^[0-9+()\-.\s]{6,20}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

function phone(v: unknown, field: string) {
  const s = str(v, 20);
  if (s === undefined) return undefined;
  if (s !== "" && !PHONE.test(s)) throw ApiError.badRequest(`${field} looks invalid. Use digits, spaces, + ( ) - only`);
  return s;
}
function date(v: unknown, field: string) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return "";
  const d = new Date(String(v));
  if (isNaN(+d)) throw ApiError.badRequest(`${field} is not a valid date`);
  return d;
}

/**
 * Turns user input into a flat { "profile.designation": "...", ... } patch that only contains
 * fields the caller may change. "" clears a field, undefined (missing) leaves it alone.
 *  - Admin/Owner: everything.
 *  - The person themself: work location, skills and all personal details.
 */
export function buildPatch(input: any, who: { admin: boolean; self: boolean }) {
  const patch: Record<string, unknown> = {};
  const set = (key: string, v: unknown) => {
    if (v !== undefined) patch[key] = v === "" ? undefined : v;
  };
  const p = input?.profile || {};
  const pe = input?.personal || {};

  if (who.admin) {
    set("profile.designation", str(p.designation, 100));
    set("profile.department", str(p.department, 100));
    set("profile.employeeId", str(p.employeeId, 40));
    set("profile.company", str(p.company, 120));
    if (p.employmentType !== undefined) {
      if (p.employmentType !== "" && !EMPLOYMENT.includes(p.employmentType)) throw ApiError.badRequest("Unknown employment type");
      set("profile.employmentType", p.employmentType);
    }
    if (p.reportingManagerId !== undefined) set("profile.reportingManagerId", p.reportingManagerId || "");
    if (input?.joinedAt !== undefined && input.joinedAt !== "" && input.joinedAt !== null) {
      const d = date(input.joinedAt, "Joining date");
      if (d) patch.joinedAt = d;
    }
  }

  if (who.admin || who.self) {
    set("profile.workLocation", str(p.workLocation, 120));
    if (p.skills !== undefined) {
      const skills = Array.isArray(p.skills) ? p.skills : String(p.skills).split(",");
      patch["profile.skills"] = [...new Set(skills.map((s: unknown) => String(s).trim().slice(0, 30)).filter(Boolean))].slice(0, 20);
    }
    set("personal.phone", phone(pe.phone, "Phone"));
    set("personal.alternatePhone", phone(pe.alternatePhone, "Alternate phone"));
    set("personal.dateOfBirth", date(pe.dateOfBirth, "Date of birth"));
    const a = pe.address || {};
    set("personal.address.line1", str(a.line1, 150));
    set("personal.address.line2", str(a.line2, 150));
    set("personal.address.city", str(a.city, 80));
    set("personal.address.state", str(a.state, 80));
    set("personal.address.country", str(a.country, 80));
    set("personal.address.postalCode", str(a.postalCode, 20));
    const e = pe.emergencyContact || {};
    set("personal.emergencyContact.name", str(e.name, 100));
    set("personal.emergencyContact.phone", phone(e.phone, "Emergency contact phone"));
    set("personal.emergencyContact.relation", str(e.relation, 50));
  }
  return patch;
}

/** A person must never end up (directly or indirectly) reporting to themself. */
export async function assertNoCycle(workspaceId: string, userId: string, managerUserId: string) {
  const seen = new Set<string>();
  let cur: string | undefined = managerUserId;
  for (let i = 0; i < 50 && cur; i++) {
    if (cur === userId) throw ApiError.badRequest("That would make the reporting line a circle, someone would end up reporting to themself");
    if (seen.has(cur)) break;
    seen.add(cur);
    const m: any = await WorkspaceMember.findOne({ workspaceId, userId: cur, status: { $ne: "removed" } }).select("profile.reportingManagerId").lean();
    cur = m?.profile?.reportingManagerId ? String(m.profile.reportingManagerId) : undefined;
  }
}