import { WorkspaceMember } from "../models/WorkspaceMember";
import { AccessRole } from "../models/AccessRole";
import { ALL_PERMS, DEFAULT_PERMS, ensureSystemRoles, normalize } from "./permissions";

async function roleMaps(workspaceId: string) {
  await ensureSystemRoles(workspaceId);
  const roles: any[] = await AccessRole.find({ workspaceId }).lean();
  return { byId: new Map(roles.map((r) => [String(r._id), r])), bySys: new Map(roles.filter((r) => r.systemKey).map((r) => [r.systemKey, r])) };
}

const permsOf = (m: any, maps: Awaited<ReturnType<typeof roleMaps>>) => {
  if (m.role === "OWNER" && !m.roleId) return new Set(ALL_PERMS);
  const r = (m.roleId && maps.byId.get(String(m.roleId))) || maps.bySys.get(m.role);
  return new Set(normalize(r?.permissions ?? (DEFAULT_PERMS as any)[m.role] ?? []));
};

export interface Person {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  profileImage?: string;
  designation?: string;
  joinedAt?: Date;
  roleName: string;
  canMark: boolean;
  exempt: boolean;
  tracked: boolean;
  perms: Set<string>;
}

/** Every active member with whether attendance is tracked for them. */
export async function listPeople(workspaceId: string): Promise<Person[]> {
  const [members, maps]: [any[], any] = await Promise.all([
    WorkspaceMember.find({ workspaceId, status: "active" }).populate("userId", "name email profileImage jobTitle").lean() as any,
    roleMaps(workspaceId),
  ]);
  return members
    .filter((m) => m.userId)
    .map((m) => {
      const perms = permsOf(m, maps);
      const role = (m.roleId && maps.byId.get(String(m.roleId))) || maps.bySys.get(m.role);
      const canMark = perms.has("attendance.mark");
      return {
        memberId: String(m._id), userId: String(m.userId._id), name: m.userId.name, email: m.userId.email, profileImage: m.userId.profileImage,
        designation: m.profile?.designation || m.userId.jobTitle, joinedAt: m.joinedAt, roleName: role?.name || m.role,
        canMark, exempt: !!m.attendanceExempt, tracked: canMark && !m.attendanceExempt, perms,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const trackedPeople = async (workspaceId: string) => (await listPeople(workspaceId)).filter((p) => p.tracked);

/** User ids of everybody whose role has the permission (used to find the people who approve leave). */
export async function usersWithPerm(workspaceId: string, perm: string): Promise<string[]> {
  return (await listPeople(workspaceId)).filter((p) => p.perms.has(perm)).map((p) => p.userId);
}