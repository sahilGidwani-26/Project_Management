import { Request, Response } from "express";
import { Types } from "mongoose";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { AccessRole } from "../models/AccessRole";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { Workspace } from "../models/Workspace";
import { User } from "../models/User";
import { ActivityLog } from "../models/ActivityLog";
import { sendMail } from "../utils/mailer";
import { env } from "../config/env";
import { memberRoleChangedEmail } from "../utils/peopleEmailTemplates";
import { assertNotLastOwner } from "../services/people";
import {
  ALL_PERMS, AccessCtx, CATALOG, DEFAULT_PERMS, PERM_LABELS, PERM_SET, SYSTEM_ORDER,
  compatRole, ensureSystemRoles, getAccess, normalize,
} from "../services/permissions";

const ID = /^[a-f\d]{24}$/i;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const assertId = (v: string, what: string) => {
  if (!ID.test(v)) throw ApiError.notFound(`${what} not found`);
};
const subset = (list: string[], of: Set<string>) => list.every((p) => of.has(p));
const labelOf = (p: string) => PERM_LABELS.get(p) || p;

/* -------------------------------- helpers -------------------------------- */

const cleanName = (v: unknown) => {
  const n = String(v ?? "").trim().replace(/\s+/g, " ");
  if (n.length < 2 || n.length > 40) throw ApiError.badRequest("Role name must be 2 to 40 characters");
  return n;
};
const cleanScope = (v: unknown): "all" | "member" => {
  if (v === "all" || v === "member") return v;
  throw ApiError.badRequest("Scope must be “all” or “member”");
};
const cleanPerms = (v: unknown) => {
  if (!Array.isArray(v)) throw ApiError.badRequest("permissions must be a list");
  const unknown = v.find((p) => !PERM_SET.has(p));
  if (unknown !== undefined) throw ApiError.badRequest(`Unknown permission: ${String(unknown)}`);
  return normalize(v);
};

/** Nobody can hand out access they do not have themself, and a limited role cannot create an unlimited one. */
function assertGrant(actor: AccessCtx, perms: string[], newScope?: string) {
  if (actor.isOwner) return;
  const missing = perms.filter((p) => !actor.perms.has(p));
  if (missing.length) {
    throw ApiError.forbidden(
      `You cannot give permissions you do not have: ${missing.slice(0, 5).map(labelOf).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}`
    );
  }
  if (actor.scope === "member" && newScope === "all") {
    throw ApiError.forbidden("Your own access is limited to the projects you are in, so you cannot give access to all projects");
  }
}

/** Owner role is locked. Everyone else can only change a role whose permissions they fully hold themself. */
const canEditRole = (actor: AccessCtx, role: any) =>
  role.systemKey !== "OWNER" && (actor.isOwner || subset(normalize(role.permissions), actor.perms));

const roleView = (r: any, extra: Record<string, unknown> = {}) => ({
  _id: r._id, name: r.name, description: r.description || "", color: r.color, scope: r.scope,
  systemKey: r.systemKey || null, isSystem: !!r.systemKey,
  permissions: r.systemKey === "OWNER" ? ALL_PERMS : normalize(r.permissions),
  ...extra,
});

const log = (workspaceId: string, actorId: string, action: string, role: any, metadata: Record<string, unknown> = {}) =>
  ActivityLog.create({ workspaceId, actorId, action, resourceType: "AccessRole", resourceId: role._id, metadata: { title: role.name, ...metadata } }).catch(() => undefined);

/** Custom roles keep a built-in base role in sync (see compatRole). Called after any permission change. */
async function syncMembers(role: any) {
  if (role.systemKey) return;
  await WorkspaceMember.updateMany({ workspaceId: role.workspaceId, roleId: role._id }, { $set: { role: compatRole(new Set(normalize(role.permissions))) } });
}

/* ------------------------------ read endpoints ------------------------------ */

export const getCatalog = catchAsync(async (_req: Request, res: Response) =>
  sendSuccess(res, 200, { modules: CATALOG, total: ALL_PERMS.length }, "Permission catalog")
);

/** GET /workspaces/:id/permissions/me: what the logged-in person can do here (the UI hides everything else). */
export const myPermissions = catchAsync(async (req: Request, res: Response) => {
  const a = req.access!;
  return sendSuccess(
    res, 200,
    {
      role: { id: a.roleId, key: a.roleKey, name: a.roleName, color: a.roleColor, isOwner: a.isOwner },
      scope: a.scope,
      legacyRole: a.legacyRole,
      permissions: [...a.perms],
    },
    "Permissions"
  );
});

export const listRoles = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const actor = req.access!;
  await ensureSystemRoles(workspaceId);

  const [roles, counts]: [any[], any[]] = await Promise.all([
    AccessRole.find({ workspaceId }).lean() as any,
    WorkspaceMember.aggregate([
      { $match: { workspaceId: new Types.ObjectId(workspaceId), status: "active" } },
      { $group: { _id: { roleId: "$roleId", role: "$role" }, n: { $sum: 1 } } },
    ]),
  ]);

  const countFor = (r: any) =>
    counts
      .filter((c) => (r.systemKey ? !c._id.roleId && c._id.role === r.systemKey : String(c._id.roleId) === String(r._id)))
      .reduce((a, c) => a + c.n, 0);

  roles.sort((a, b) => {
    const ia = a.systemKey ? SYSTEM_ORDER.indexOf(a.systemKey) : 99;
    const ib = b.systemKey ? SYSTEM_ORDER.indexOf(b.systemKey) : 99;
    return ia - ib || a.nameLower.localeCompare(b.nameLower);
  });

  return sendSuccess(
    res, 200,
    roles.map((r) =>
      roleView(r, {
        memberCount: countFor(r),
        locked: r.systemKey === "OWNER",
        editable: canEditRole(actor, r),
        isMine: String(r._id) === actor.roleId,
        defaultPermissions: r.systemKey ? DEFAULT_PERMS[r.systemKey as keyof typeof DEFAULT_PERMS] : undefined,
      })
    ),
    "Roles"
  );
});

/* ------------------------------- write endpoints ------------------------------- */

export const createRole = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const actor = req.access!;
  const b = req.body || {};
  await ensureSystemRoles(workspaceId);

  const name = cleanName(b.name);
  let scope: "all" | "member" = b.scope !== undefined ? cleanScope(b.scope) : "all";
  let perms: string[] = b.permissions !== undefined ? cleanPerms(b.permissions) : [];

  if (b.cloneFrom) {
    assertId(String(b.cloneFrom), "Role to copy");
    const src: any = await AccessRole.findOne({ _id: b.cloneFrom, workspaceId }).lean();
    if (!src) throw ApiError.notFound("Role to copy was not found");
    if (b.permissions === undefined) perms = src.systemKey === "OWNER" ? ALL_PERMS : normalize(src.permissions);
    if (b.scope === undefined) scope = src.scope;
  }

  const color = b.color !== undefined ? (COLOR.test(String(b.color)) ? String(b.color) : (() => { throw ApiError.badRequest("Color must look like #1A2B3C"); })()) : "#64748B";
  assertGrant(actor, perms, scope);

  let role: any;
  try {
    role = await AccessRole.create({
      workspaceId, name, nameLower: name.toLowerCase(), description: String(b.description || "").trim().slice(0, 200), color, scope, permissions: perms, createdBy: actor.userId,
    });
  } catch (e: any) {
    if (e?.code === 11000) throw ApiError.conflict("A role with this name already exists");
    throw e;
  }
  await log(workspaceId, actor.userId, "role_created", role, { permissions: perms.length, scope });
  return sendSuccess(res, 201, roleView(role.toObject(), { memberCount: 0, editable: true }), "Role created");
});

export const updateRole = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, roleId } = req.params;
  const actor = req.access!;
  assertId(roleId, "Role");
  await ensureSystemRoles(workspaceId);

  const role: any = await AccessRole.findOne({ _id: roleId, workspaceId });
  if (!role) throw ApiError.notFound("Role not found");
  if (role.systemKey === "OWNER") throw ApiError.forbidden("The Owner role always has every permission and cannot be changed");

  const oldPerms = normalize(role.permissions);
  if (!actor.isOwner && !subset(oldPerms, actor.perms)) throw ApiError.forbidden("This role has permissions you do not have, so you cannot change it");

  const b = req.body || {};
  if (b.name !== undefined && String(b.name).trim() !== role.name) {
    if (role.systemKey) throw ApiError.badRequest("Built-in roles cannot be renamed");
    role.name = cleanName(b.name);
    role.nameLower = role.name.toLowerCase();
  }
  if (b.description !== undefined) role.description = String(b.description).trim().slice(0, 200);
  if (b.color !== undefined) {
    if (!COLOR.test(String(b.color))) throw ApiError.badRequest("Color must look like #1A2B3C");
    role.color = String(b.color);
  }
  const scope = b.scope !== undefined ? cleanScope(b.scope) : role.scope;
  const perms = b.permissions !== undefined ? cleanPerms(b.permissions) : oldPerms;

  assertGrant(actor, perms.filter((p) => !oldPerms.includes(p)), scope !== role.scope ? scope : undefined);
  if (!actor.isOwner && String(role._id) === actor.roleId && oldPerms.includes("roles.manage") && !perms.includes("roles.manage")) {
    throw ApiError.forbidden("You cannot remove your own access to manage roles");
  }

  role.permissions = perms;
  role.scope = scope;
  try {
    await role.save();
  } catch (e: any) {
    if (e?.code === 11000) throw ApiError.conflict("A role with this name already exists");
    throw e;
  }
  await syncMembers(role);
  await log(workspaceId, actor.userId, "role_updated", role, { permissions: perms.length, added: perms.filter((p) => !oldPerms.includes(p)).length, removed: oldPerms.filter((p) => !perms.includes(p)).length, scope });
  return sendSuccess(res, 200, roleView(role.toObject(), { editable: true }), "Role saved");
});

/** Puts a built-in role (not Owner) back to its default permissions. */
export const resetRole = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, roleId } = req.params;
  const actor = req.access!;
  assertId(roleId, "Role");
  await ensureSystemRoles(workspaceId);

  const role: any = await AccessRole.findOne({ _id: roleId, workspaceId });
  if (!role) throw ApiError.notFound("Role not found");
  if (!role.systemKey || role.systemKey === "OWNER") throw ApiError.badRequest("Only the Admin, Project Manager, Member and Viewer roles can be reset");
  if (!canEditRole(actor, role)) throw ApiError.forbidden("This role has permissions you do not have, so you cannot change it");

  const defaults = normalize(DEFAULT_PERMS[role.systemKey as keyof typeof DEFAULT_PERMS]);
  assertGrant(actor, defaults.filter((p) => !normalize(role.permissions).includes(p)), "all");
  role.permissions = defaults;
  role.scope = "all";
  await role.save();
  await log(workspaceId, actor.userId, "role_reset", role);
  return sendSuccess(res, 200, roleView(role.toObject(), { editable: true }), "Role reset to its defaults");
});

export const deleteRole = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, roleId } = req.params;
  const actor = req.access!;
  assertId(roleId, "Role");

  const role: any = await AccessRole.findOne({ _id: roleId, workspaceId });
  if (!role) throw ApiError.notFound("Role not found");
  if (role.systemKey) throw ApiError.badRequest("Built-in roles cannot be deleted. You can edit them or reset them instead.");
  if (!canEditRole(actor, role)) throw ApiError.forbidden("This role has permissions you do not have, so you cannot delete it");

  const users = await WorkspaceMember.countDocuments({ workspaceId, roleId: role._id, status: { $ne: "removed" } });
  if (users) throw ApiError.conflict(`${users} ${users === 1 ? "person has" : "people have"} this role. Give them another role first.`);

  await role.deleteOne();
  await log(workspaceId, actor.userId, "role_deleted", role);
  return sendSuccess(res, 200, null, "Role deleted");
});

/**
 * PUT /workspaces/:id/members/:memberId/role  body { roleId }: gives a person a built-in or custom role.
 * Built-in roles keep `role` + no roleId. Custom roles store roleId and a safe base role (see compatRole).
 */
export const assignRole = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  const actor = req.access!;
  assertId(memberId, "Member");
  const roleId = String(req.body?.roleId || "");
  assertId(roleId, "Role");
  await ensureSystemRoles(workspaceId);

  const member: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: "active" });
  if (!member) throw ApiError.notFound("Active member not found");
  if (String(member.userId) === actor.userId) throw ApiError.forbidden("You cannot change your own role");

  const target: any = await AccessRole.findOne({ _id: roleId, workspaceId }).lean();
  if (!target) throw ApiError.notFound("Role not found");
  const targetPerms = target.systemKey === "OWNER" ? ALL_PERMS : normalize(target.permissions);

  const before = await getAccess(workspaceId, String(member.userId));
  if (!actor.isOwner) {
    if (member.role === "OWNER") throw ApiError.forbidden("Only an Owner can change an Owner's role");
    if (target.systemKey === "OWNER") throw ApiError.forbidden("Only an Owner can make someone an Owner");
    if (before && !subset([...before.perms], actor.perms)) throw ApiError.forbidden("This person has more access than you, so you cannot change their role");
    assertGrant(actor, targetPerms, target.scope);
  }
  if (member.role === "OWNER" && !member.roleId && target.systemKey !== "OWNER") await assertNotLastOwner(workspaceId, member._id);

  if (target.systemKey) {
    member.role = target.systemKey;
    member.roleId = undefined;
  } else {
    member.role = compatRole(new Set(targetPerms));
    member.roleId = target._id;
  }
  await member.save();

  const [user, byUser, ws]: [any, any, any] = await Promise.all([
    User.findById(member.userId).select("email name"),
    User.findById(actor.userId).select("name"),
    Workspace.findById(workspaceId).select("name"),
  ]);
  if (user?.email && before?.roleName !== target.name) {
    const mail = memberRoleChangedEmail({ workspaceName: ws?.name || "your workspace", byName: byUser?.name || "Someone", from: before?.roleName || "member", to: target.name, url: `${env.CLIENT_URL}/app/${workspaceId}/dashboard` });
    sendMail(user.email, mail.subject, mail.html).catch(() => {});
  }
  await ActivityLog.create({
    workspaceId, actorId: actor.userId, action: "member_role_changed", resourceType: "WorkspaceMember", resourceId: member._id,
    metadata: { title: user?.name, from: before?.roleName, to: target.name },
  }).catch(() => undefined);

  return sendSuccess(res, 200, { memberId: member._id, roleId: target._id, roleName: target.name }, "Role updated");
});