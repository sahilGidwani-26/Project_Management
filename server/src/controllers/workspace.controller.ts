import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { Workspace } from "../models/Workspace";
import { WorkspaceMember, WorkspaceRole } from "../models/WorkspaceMember";
import { Invitation } from "../models/Invitation";
import { Channel } from "../models/Channel";
import { User } from "../models/User";
import { Task } from "../models/Task";
import { Project } from "../models/Project";
import { ActivityLog } from "../models/ActivityLog";
import { TaskStatusEvent } from "../models/TaskStatusEvent";
import { TimeEntry } from "../models/ProjectExtras";
import { GithubTaskLink } from "../models/GithubIntegration";
import { sendMail } from "../utils/mailer";
import { env } from "../config/env";
import {
  accountCreatedEmail, addedToWorkspaceEmail, inviteAcceptedEmail, memberDeactivatedEmail, memberReactivatedEmail,
  memberRemovedEmail, memberRoleChangedEmail, workspaceInviteEmail,
} from "../utils/peopleEmailTemplates";
import {
  EMPLOYMENT, ROLES, assertNoCycle, assertNotLastOwner, buildPatch, canAssign, canManageTarget, generatePassword, isAdminRole, isManagerRole, passwordProblem,
} from "../services/people";
import { cycleStats } from "../services/sprintMetrics";

const ID = /^[a-f\d]{24}$/i;
const DAY = 864e5;
const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const roleOf = (req: Request) => req.workspaceRole as WorkspaceRole;
const send = (to: string | undefined, mail: { subject: string; html: string }) => {
  if (to) sendMail(to, mail.subject, mail.html).catch(() => {});
};
const wsUrl = (workspaceId: string, path = "dashboard") => `${env.CLIENT_URL}/app/${workspaceId}/${path}`;
const nameOf = async (id: string) => ((await User.findById(id).select("name")) as any)?.name || "Someone";
const wsName = async (id: string) => ((await Workspace.findById(id).select("name")) as any)?.name || "your workspace";
const assertId = (v: string, what: string) => {
  if (!ID.test(v)) throw ApiError.notFound(`${what} not found`);
};
const logPeople = (workspaceId: string, actorId: string, action: string, member: any, metadata: Record<string, unknown> = {}) =>
  ActivityLog.create({ workspaceId, actorId, action, resourceType: "WorkspaceMember", resourceId: member._id, metadata }).catch(() => undefined);

async function joinGeneral(workspaceId: string, userId: unknown) {
  await Channel.updateOne({ workspaceId, name: "general" }, { $addToSet: { members: userId } });
}

/** Moves a person's unfinished tasks to somebody else (two updates: Mongo cannot $addToSet and $pull the same field at once). */
async function reassignOpenTasks(workspaceId: string, fromUserId: unknown, toUserId: unknown) {
  const filter = { workspaceId, assigneeIds: fromUserId, status: { $ne: "Done" } };
  const count = await Task.countDocuments(filter);
  if (!count) return 0;
  await Task.updateMany(filter, { $addToSet: { assigneeIds: toUserId } });
  await Task.updateMany(filter, { $pull: { assigneeIds: fromUserId } });
  return count;
}

async function loadReassignTarget(workspaceId: string, targetMemberId: unknown, fromMember: any) {
  if (!targetMemberId) return null;
  assertId(String(targetMemberId), "Member to reassign to");
  const target: any = await WorkspaceMember.findOne({ _id: targetMemberId, workspaceId, status: "active" });
  if (!target) throw ApiError.badRequest("Choose an active member to hand the open tasks to");
  if (String(target._id) === String(fromMember._id)) throw ApiError.badRequest("Choose a different person to hand the tasks to");
  if (target.role === "VIEWER") throw ApiError.badRequest("A Viewer cannot own tasks. Choose another person");
  return target;
}

/* ================================ workspaces ================================ */

export const createWorkspace = catchAsync(async (req: Request, res: Response) => {
  const { name, description, slug, logo } = req.body;
  const userId = req.user!.id;

  const slugTaken = await Workspace.findOne({ slug });
  if (slugTaken) throw ApiError.conflict("This workspace slug is already taken");

  const workspace = await Workspace.create({ name, description, slug, logo, ownerId: userId });
  await WorkspaceMember.create({ workspaceId: workspace._id, userId, role: "OWNER", addedVia: "owner" });

  // Every workspace gets a default #general chat channel, like Slack.
  await Channel.create({
    workspaceId: workspace._id,
    type: "channel",
    name: "general",
    description: "Workspace-wide announcements and chat",
    members: [userId],
    createdBy: userId,
  });

  return sendSuccess(res, 201, workspace, "Workspace created");
});

export const listMyWorkspaces = catchAsync(async (req: Request, res: Response) => {
  const memberships = await WorkspaceMember.find({ userId: req.user!.id, status: "active" }).populate("workspaceId");
  const workspaces = memberships.map((m) => {
    const ws = m.workspaceId as unknown as { toObject?: () => Record<string, unknown> };
    return { ...(ws.toObject ? ws.toObject() : ws), myRole: m.role };
  });
  return sendSuccess(res, 200, workspaces, "Workspaces");
});

export const getWorkspace = catchAsync(async (req: Request, res: Response) => {
  const workspace = await Workspace.findById(req.params.workspaceId);
  if (!workspace) throw ApiError.notFound("Workspace not found");
  return sendSuccess(res, 200, workspace, "Workspace");
});

export const updateWorkspace = catchAsync(async (req: Request, res: Response) => {
  const workspace = await Workspace.findByIdAndUpdate(req.params.workspaceId, req.body, { new: true });
  if (!workspace) throw ApiError.notFound("Workspace not found");
  return sendSuccess(res, 200, workspace, "Workspace updated");
});

export const deleteWorkspace = catchAsync(async (req: Request, res: Response) => {
  await Workspace.findByIdAndDelete(req.params.workspaceId);
  return sendSuccess(res, 200, null, "Workspace deleted");
});

/* ================================== members ================================== */

/**
 * GET /workspaces/:id/members  (same response shape as before, so existing pickers keep working)
 * Optional: ?status=all|deactivated (admins only), ?role=, ?department=, ?employmentType=, ?q=search
 * Phone, address and other personal details are never included here.
 */
export const listMembers = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const admin = isAdminRole(roleOf(req));
  const q = req.query as Record<string, string>;

  const filter: Record<string, unknown> = { workspaceId };
  if (admin && q.status === "all") filter.status = { $in: ["active", "deactivated"] };
  else if (admin && q.status === "deactivated") filter.status = "deactivated";
  else filter.status = "active";
  if (q.role && ROLES.includes(q.role as WorkspaceRole)) filter.role = q.role;
  if (q.department) filter["profile.department"] = q.department;
  if (q.employmentType && EMPLOYMENT.includes(q.employmentType)) filter["profile.employmentType"] = q.employmentType;
  if (q.q) {
    const rx = new RegExp(escRx(q.q.slice(0, 80)), "i");
    const userIds = await User.find({ $or: [{ name: rx }, { email: rx }] }).distinct("_id");
    filter.$or = [{ userId: { $in: userIds } }, { "profile.designation": rx }, { "profile.company": rx }, { "profile.department": rx }];
  }

  const members = await WorkspaceMember.find(filter)
    .sort({ joinedAt: 1 })
    .select(admin ? "-personal" : "-personal -profile.employeeId")
    .populate("userId", admin ? "name email profileImage jobTitle lastLoginAt mustChangePassword" : "name email profileImage jobTitle")
    .lean();
  return sendSuccess(res, 200, members, "Members");
});

/** GET /workspaces/:id/members/:memberId: one person's full profile (personal data only for admins and themself). */
export const getMember = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  assertId(memberId, "Member");
  const actor = roleOf(req);
  const admin = isAdminRole(actor);

  const m: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, ...(admin ? {} : { status: "active" }) })
    .populate("userId", "name email profileImage jobTitle lastLoginAt createdAt mustChangePassword createdByWorkspaceId")
    .populate("profile.reportingManagerId", "name profileImage")
    .lean();
  if (!m || m.status === "removed") throw ApiError.notFound("Member not found");

  const self = String(m.userId._id) === req.user!.id;
  const openTasks = await Task.countDocuments({ workspaceId, assigneeIds: m.userId._id, status: { $ne: "Done" } });
  const canAdminister = admin && !self && canManageTarget(actor, m.role);

  const { personal, profile, ...rest } = m;
  const user = { ...m.userId };
  if (!admin && !self) delete user.lastLoginAt;
  if (!admin) delete user.mustChangePassword;
  delete user.createdByWorkspaceId;

  return sendSuccess(
    res, 200,
    {
      member: { ...rest, userId: user, profile: { ...profile, reportingManagerId: undefined, employeeId: admin || self ? profile?.employeeId : undefined } },
      reportingManager: profile?.reportingManagerId || null,
      personal: admin || self ? personal || {} : null,
      awaitingFirstLogin: admin && !!m.userId.mustChangePassword && String(m.userId.createdByWorkspaceId) === workspaceId,
      openTasks,
      permissions: {
        isSelf: self,
        canEdit: self || (admin && canManageTarget(actor, m.role)),
        canEditAllFields: admin && canManageTarget(actor, m.role),
        canChangeRole: canAdminister,
        canDeactivate: canAdminister && m.status === "active",
        canReactivate: canAdminister && m.status === "deactivated",
        canRemove: canAdminister,
        canResendCredentials: canAdminister && !!m.userId.mustChangePassword && String(m.userId.createdByWorkspaceId) === workspaceId,
        canViewProgress: self || isManagerRole(actor),
      },
    },
    "Member"
  );
});

/**
 * POST /workspaces/:id/members: admin creates an account (or adds an existing one) without an invitation.
 *  - New email  -> account is created with a temporary password the person MUST change at first login.
 *  - Known email-> that person is simply added; their password and account are never touched.
 */
export const createMember = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const actor = roleOf(req);
  const actorId = req.user!.id;
  const b = req.body;

  const email = String(b.email).trim().toLowerCase();
  const role: WorkspaceRole = b.role || "MEMBER";
  if (!canAssign(actor, role)) throw ApiError.forbidden("You cannot give this role");

  const patch = buildPatch(b, { admin: true, self: false });
  if (patch["profile.reportingManagerId"]) {
    const mgr = await WorkspaceMember.exists({ workspaceId, userId: patch["profile.reportingManagerId"], status: "active" });
    if (!mgr) throw ApiError.badRequest("The reporting manager must be an active member of this workspace");
  }

  let user: any = await User.findOne({ email }).select("+passwordHash");
  const creating = !user;
  let plain: string | undefined;
  let generated = false;

  if (!user) {
    const name = String(b.name || "").trim();
    if (name.length < 2) throw ApiError.badRequest("Name is required for a new account");
    if (typeof b.password === "string" && b.password.length > 0) {
      const problem = passwordProblem(b.password);
      if (problem) throw ApiError.badRequest(problem);
      plain = b.password;
    } else {
      plain = generatePassword();
      generated = true;
    }
    try {
      user = await User.create({
        name, email, passwordHash: await bcrypt.hash(plain as string, 12), emailVerified: false,
        mustChangePassword: true, createdByWorkspaceId: workspaceId, jobTitle: patch["profile.designation"] as string | undefined,
      });
    } catch (e: any) {
      if (e?.code === 11000) throw ApiError.conflict("An account with this email was created a moment ago. Try again");
      throw e;
    }
  } else if (user.accountStatus === "suspended") {
    throw ApiError.badRequest("This account is suspended on the platform and cannot be added");
  }

  let member: any = await WorkspaceMember.findOne({ workspaceId, userId: user._id });
  if (member && member.status === "active") throw ApiError.conflict("This person is already a member of the workspace");

  if (member) {
    member.status = "active"; // reactivating somebody who was removed or deactivated earlier
    member.role = role;
    member.deactivatedAt = undefined;
    member.deactivatedBy = undefined;
  } else {
    member = new WorkspaceMember({ workspaceId, userId: user._id, role });
  }
  member.addedBy = actorId;
  member.addedVia = "manual";
  member.set(patch);
  await member.save();
  await joinGeneral(workspaceId, user._id);

  const [byName, workspaceName] = await Promise.all([nameOf(actorId), wsName(workspaceId)]);
  const sendDetails = b.sendLoginDetails !== false;
  if (creating) {
    if (sendDetails) send(email, accountCreatedEmail({ workspaceName, creatorName: byName, email, role, password: plain }));
  } else {
    send(email, addedToWorkspaceEmail({ workspaceName, byName, role, url: wsUrl(workspaceId) }));
  }
  await logPeople(workspaceId, actorId, creating ? "member_account_created" : "member_added", member, { title: user.name, role });

  return sendSuccess(
    res, 201,
    {
      member: { _id: member._id, role: member.role, status: member.status },
      user: { _id: user._id, name: user.name, email: user.email },
      createdAccount: creating,
      existingAccount: !creating,
      temporaryPassword: generated ? plain : undefined, // shown once, only when the server made it
      emailQueued: sendDetails && !!env.SMTP_HOST,
    },
    creating ? "Account created" : "Existing user added to the workspace"
  );
});

/**
 * PATCH /workspaces/:id/members/:memberId: change role (admins) and/or profile fields.
 * Admins may change everything. A person may change only their own work location, skills and personal details.
 */
export const updateMember = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  assertId(memberId, "Member");
  const actor = roleOf(req);
  const actorId = req.user!.id;
  const admin = isAdminRole(actor);

  const member: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: { $ne: "removed" } });
  if (!member) throw ApiError.notFound("Member not found");
  const self = String(member.userId) === actorId;
  if (!self && !admin) throw ApiError.forbidden("You can only edit your own profile");
  if (!self && !canManageTarget(actor, member.role)) throw ApiError.forbidden("You cannot change an Owner's details");

  const { role } = req.body as { role?: WorkspaceRole };
  let roleChange: { from: WorkspaceRole; to: WorkspaceRole } | null = null;

  if (role !== undefined && role !== member.role) {
    if (self) throw ApiError.forbidden("You cannot change your own role");
    if (!ROLES.includes(role)) throw ApiError.badRequest("Unknown role");
    if (!canAssign(actor, role)) throw ApiError.forbidden("You cannot give this role");
    if (member.status !== "active") throw ApiError.badRequest("Reactivate this person before changing the role");
    if (member.role === "OWNER") await assertNotLastOwner(workspaceId, member._id);
    roleChange = { from: member.role, to: role };
    member.role = role;
  }

  const patch = buildPatch(req.body, { admin: admin && (!self || actor === "OWNER" || actor === "ADMIN"), self });
  if (patch["profile.reportingManagerId"]) {
    if (String(patch["profile.reportingManagerId"]) === String(member.userId)) throw ApiError.badRequest("Someone cannot report to themself");
    const mgr = await WorkspaceMember.exists({ workspaceId, userId: patch["profile.reportingManagerId"], status: "active" });
    if (!mgr) throw ApiError.badRequest("The reporting manager must be an active member of this workspace");
    await assertNoCycle(workspaceId, String(member.userId), String(patch["profile.reportingManagerId"]));
  }
  member.set(patch);
  await member.save();

  if (patch["profile.designation"] !== undefined) await User.updateOne({ _id: member.userId }, { $set: { jobTitle: (patch["profile.designation"] as string) || undefined } });

  if (roleChange) {
    const target: any = await User.findById(member.userId).select("email");
    const [byName, workspaceName] = await Promise.all([nameOf(actorId), wsName(workspaceId)]);
    send(target?.email, memberRoleChangedEmail({ workspaceName, byName, from: roleChange.from, to: roleChange.to, url: wsUrl(workspaceId) }));
    await logPeople(workspaceId, actorId, "member_role_changed", member, { from: roleChange.from, to: roleChange.to });
  } else if (Object.keys(patch).length) {
    await logPeople(workspaceId, actorId, "member_profile_updated", member, { self });
  }

  return sendSuccess(res, 200, { _id: member._id, role: member.role, status: member.status }, roleChange ? "Role updated" : "Profile saved");
});

/** POST /members/:memberId/deactivate  body: { reassignTo?: memberId }: pauses the account, keeps all data. */
export const deactivateMember = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  assertId(memberId, "Member");
  const actor = roleOf(req);
  const actorId = req.user!.id;

  const member: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: "active" });
  if (!member) throw ApiError.notFound("Active member not found");
  if (String(member.userId) === actorId) throw ApiError.badRequest("You cannot deactivate yourself");
  if (!canManageTarget(actor, member.role)) throw ApiError.forbidden("You cannot deactivate an Owner");
  if (member.role === "OWNER") await assertNotLastOwner(workspaceId, member._id);

  const target = await loadReassignTarget(workspaceId, req.body?.reassignTo, member);
  const moved = target ? await reassignOpenTasks(workspaceId, member.userId, target.userId) : 0;

  member.status = "deactivated";
  member.deactivatedAt = new Date();
  member.deactivatedBy = actorId;
  await member.save();

  const [user, byName, workspaceName]: [any, string, string] = await Promise.all([User.findById(member.userId).select("email name"), nameOf(actorId), wsName(workspaceId)]);
  send(user?.email, memberDeactivatedEmail({ workspaceName, byName }));
  await logPeople(workspaceId, actorId, "member_deactivated", member, { title: user?.name, tasksReassigned: moved });
  return sendSuccess(res, 200, { tasksReassigned: moved }, "Member deactivated");
});

export const reactivateMember = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  assertId(memberId, "Member");
  const actorId = req.user!.id;

  const member: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: "deactivated" });
  if (!member) throw ApiError.notFound("Deactivated member not found");
  if (!canManageTarget(roleOf(req), member.role)) throw ApiError.forbidden("You cannot change an Owner");

  member.status = "active";
  member.deactivatedAt = undefined;
  member.deactivatedBy = undefined;
  await member.save();

  const [user, byName, workspaceName]: [any, string, string] = await Promise.all([User.findById(member.userId).select("email name"), nameOf(actorId), wsName(workspaceId)]);
  send(user?.email, memberReactivatedEmail({ workspaceName, byName, url: wsUrl(workspaceId) }));
  await logPeople(workspaceId, actorId, "member_reactivated", member, { title: user?.name });
  return sendSuccess(res, 200, null, "Member reactivated");
});

/** DELETE /members/:memberId?reassignTo=<memberId>: removes the person from the workspace, its projects and chat channels. */
export const removeMember = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  assertId(memberId, "Member");
  const actor = roleOf(req);
  const actorId = req.user!.id;

  const member: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: { $ne: "removed" } });
  if (!member) throw ApiError.notFound("Member not found");
  if (String(member.userId) === actorId) throw ApiError.badRequest("You cannot remove yourself");
  if (!canManageTarget(actor, member.role)) throw ApiError.forbidden("You cannot remove an Owner");
  if (member.role === "OWNER" && member.status === "active") await assertNotLastOwner(workspaceId, member._id);

  const target = await loadReassignTarget(workspaceId, req.query.reassignTo, member);
  const moved = target ? await reassignOpenTasks(workspaceId, member.userId, target.userId) : 0;
  const stillOpen = await Task.countDocuments({ workspaceId, assigneeIds: member.userId, status: { $ne: "Done" } });
  const managed = await Project.countDocuments({ workspaceId, managerId: member.userId });

  member.status = "removed";
  await member.save();
  await Promise.all([
    Project.updateMany({ workspaceId }, { $pull: { members: member.userId, memberRoles: { userId: member.userId } } }),
    Channel.updateMany({ workspaceId }, { $pull: { members: member.userId } }),
  ]);

  const [user, byName, workspaceName]: [any, string, string] = await Promise.all([User.findById(member.userId).select("email name"), nameOf(actorId), wsName(workspaceId)]);
  send(user?.email, memberRemovedEmail({ workspaceName, byName }));
  await logPeople(workspaceId, actorId, "member_removed", member, { title: user?.name, tasksReassigned: moved });
  return sendSuccess(res, 200, { tasksReassigned: moved, openTasksLeft: stillOpen, projectsStillManaged: managed }, "Member removed");
});

/** POST /members/:memberId/resend-credentials: only while the person has not replaced the temporary password yet. */
export const resendCredentials = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  assertId(memberId, "Member");
  const actorId = req.user!.id;

  const member: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: "active" });
  if (!member) throw ApiError.notFound("Member not found");
  if (!canManageTarget(roleOf(req), member.role)) throw ApiError.forbidden("Not allowed");

  const user: any = await User.findById(member.userId).select("+passwordHash email name mustChangePassword createdByWorkspaceId");
  if (!user?.mustChangePassword || String(user.createdByWorkspaceId) !== workspaceId) {
    throw ApiError.badRequest("This person already set their own password. They can use “Forgot password” on the login page.");
  }

  const plain = generatePassword();
  user.passwordHash = await bcrypt.hash(plain, 12);
  await user.save();

  const [byName, workspaceName] = await Promise.all([nameOf(actorId), wsName(workspaceId)]);
  send(user.email, accountCreatedEmail({ workspaceName, creatorName: byName, email: user.email, role: member.role, password: plain, resent: true }));
  await logPeople(workspaceId, actorId, "member_credentials_resent", member, { title: user.name });
  return sendSuccess(res, 200, { temporaryPassword: plain, emailQueued: !!env.SMTP_HOST }, "New temporary password created");
});

/* ================================ invitations ================================ */

const maskEmail = (e: string) => {
  const [n, d] = e.split("@");
  return `${n.slice(0, 1)}***@${d}`;
};

export const listInvitations = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  await Invitation.updateMany({ workspaceId, status: "pending", expiresAt: { $lt: new Date() } }, { status: "expired" });
  const items = await Invitation.find({ workspaceId, status: "pending" }).sort({ createdAt: -1 }).populate("invitedBy", "name").lean();
  return sendSuccess(res, 200, items, "Invitations");
});

export const inviteMember = catchAsync(async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const email = String(req.body.email).trim().toLowerCase();
  const role: WorkspaceRole = req.body.role || "MEMBER";
  const actorId = req.user!.id;

  if (!ROLES.includes(role)) throw ApiError.badRequest("Unknown role");
  if (!canAssign(roleOf(req), role)) throw ApiError.forbidden("You cannot give this role");

  const existingUser: any = await User.findOne({ email }).select("_id");
  if (existingUser && (await WorkspaceMember.exists({ workspaceId, userId: existingUser._id, status: "active" }))) {
    throw ApiError.conflict("This person is already a member of the workspace");
  }

  const expiresAt = new Date(Date.now() + 7 * DAY);
  let invitation: any = await Invitation.findOne({ workspaceId, email, status: "pending", expiresAt: { $gt: new Date() } });
  if (invitation) {
    invitation.role = role; // inviting the same person again just refreshes the pending invitation
    invitation.expiresAt = expiresAt;
    invitation.invitedBy = actorId;
    await invitation.save();
  } else {
    invitation = await Invitation.create({ workspaceId, email, role, token: crypto.randomBytes(24).toString("hex"), invitedBy: actorId, expiresAt });
  }

  const inviteUrl = `${env.CLIENT_URL}/invitations/${invitation.token}`;
  const [inviterName, workspaceName] = await Promise.all([nameOf(actorId), wsName(workspaceId)]);
  send(email, workspaceInviteEmail({ workspaceName, inviterName, role, url: inviteUrl, expiresOn: expiresAt }));
  await ActivityLog.create({ workspaceId, actorId, action: "member_invited", resourceType: "Invitation", resourceId: invitation._id, metadata: { title: email, role } }).catch(() => undefined);

  return sendSuccess(res, 201, { ...invitation.toObject(), inviteUrl }, "Invitation sent");
});

export const resendInvitation = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, invitationId } = req.params;
  assertId(invitationId, "Invitation");
  const inv: any = await Invitation.findOne({ _id: invitationId, workspaceId, status: { $in: ["pending", "expired"] } });
  if (!inv) throw ApiError.notFound("Invitation not found");

  inv.status = "pending";
  inv.expiresAt = new Date(Date.now() + 7 * DAY);
  await inv.save();

  const inviteUrl = `${env.CLIENT_URL}/invitations/${inv.token}`;
  const [inviterName, workspaceName] = await Promise.all([nameOf(req.user!.id), wsName(workspaceId)]);
  send(inv.email, workspaceInviteEmail({ workspaceName, inviterName, role: inv.role, url: inviteUrl, expiresOn: inv.expiresAt }));
  return sendSuccess(res, 200, { ...inv.toObject(), inviteUrl }, "Invitation sent again");
});

export const cancelInvitation = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, invitationId } = req.params;
  assertId(invitationId, "Invitation");
  const inv = await Invitation.findOneAndUpdate({ _id: invitationId, workspaceId, status: "pending" }, { status: "cancelled" });
  if (!inv) throw ApiError.notFound("Invitation not found");
  return sendSuccess(res, 200, null, "Invitation cancelled");
});

export const acceptInvitation = catchAsync(async (req: Request, res: Response) => {
  const { token } = req.params;
  const invitation = await Invitation.findOne({ token, status: "pending" });
  if (!invitation) throw ApiError.notFound("Invitation not found or already used");
  if (invitation.expiresAt < new Date()) {
    invitation.status = "expired";
    await invitation.save();
    throw ApiError.badRequest("This invitation has expired");
  }

  // The link only works for the account that owns the invited email address.
  if (req.user!.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw ApiError.forbidden(`This invitation was sent to ${maskEmail(invitation.email)}. Log in with that email address to accept it.`);
  }

  const workspaceId = String(invitation.workspaceId);
  let member: any = await WorkspaceMember.findOne({ workspaceId, userId: req.user!.id });
  if (!member) {
    member = await WorkspaceMember.create({ workspaceId, userId: req.user!.id, role: invitation.role, addedBy: invitation.invitedBy, addedVia: "invite" });
  } else if (member.status !== "active") {
    member.status = "active"; // invited again after leaving / being deactivated
    member.role = invitation.role as WorkspaceRole;
    member.deactivatedAt = undefined;
    member.deactivatedBy = undefined;
    member.addedBy = invitation.invitedBy;
    member.addedVia = "invite";
    await member.save();
  }
  await joinGeneral(workspaceId, req.user!.id);

  invitation.status = "accepted";
  await invitation.save();

  const [user, inviter, workspaceName]: [any, any, string] = await Promise.all([User.findById(req.user!.id).select("name"), User.findById(invitation.invitedBy).select("email"), wsName(workspaceId)]);
  send(inviter?.email, inviteAcceptedEmail({ memberName: user?.name || invitation.email, workspaceName, role: invitation.role, url: wsUrl(workspaceId, "team") }));
  await logPeople(workspaceId, req.user!.id, "member_joined", member, { title: user?.name, role: invitation.role });

  return sendSuccess(res, 200, { workspaceId: invitation.workspaceId }, "Invitation accepted");
});

/* ================================== progress ================================== */

/**
 * GET /members/:memberId/progress: what this person has been doing across the workspace.
 * Visible to Owner, Admin, Project Manager and the person themself. Tasks count for the people they are assigned to.
 */
export const memberProgress = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, memberId } = req.params;
  assertId(memberId, "Member");

  const member: any = await WorkspaceMember.findOne({ _id: memberId, workspaceId, status: { $ne: "removed" } }).select("userId");
  if (!member) throw ApiError.notFound("Member not found");
  const self = String(member.userId) === req.user!.id;
  if (!self && !isManagerRole(roleOf(req))) throw ApiError.forbidden("Only managers and the person themself can see progress");

  const uid = member.userId;
  const u = new Types.ObjectId(String(uid));
  const now = Date.now();
  const base = { workspaceId, assigneeIds: uid, parentTaskId: { $exists: false } };

  const [openTasks, doneTasks, totalAssigned, doneTotal]: [any[], any[], number, number] = await Promise.all([
    Task.find({ ...base, status: { $ne: "Done" } }).select("title taskNumber status priority dueDate estimatedMinutes projectId type").limit(300).lean() as any,
    Task.find({ ...base, status: "Done" }).sort({ updatedAt: -1 }).limit(500).select("title taskNumber type dueDate createdAt updatedAt estimatedMinutes projectId").lean() as any,
    Task.countDocuments(base),
    Task.countDocuments({ ...base, status: "Done" }),
  ]);

  // when each finished task became Done (task status history, falling back to its last update)
  const doneIds = doneTasks.map((t) => t._id);
  const events: any[] = doneIds.length ? await TaskStatusEvent.find({ taskId: { $in: doneIds } }).sort({ at: 1 }).select("taskId from to at").lean() : [];
  const evMap = new Map<string, { from: string | null; to: string; at: number }[]>();
  const doneAtMap = new Map<string, number>();
  for (const e of events) {
    const k = String(e.taskId);
    (evMap.get(k) || evMap.set(k, []).get(k)!).push({ from: e.from ?? null, to: e.to, at: +new Date(e.at) });
    if (e.to === "Done") doneAtMap.set(k, +new Date(e.at));
  }
  const doneAt = (t: any) => doneAtMap.get(String(t._id)) ?? +new Date(t.updatedAt);

  // on-time rate (only tasks that had a due date)
  const withDue = doneTasks.filter((t) => t.dueDate);
  const onTime = withDue.filter((t) => doneAt(t) <= new Date(t.dueDate).setHours(23, 59, 59, 999)).length;

  // last 8 weeks, oldest first
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const to = now - (7 - i - 1) * 7 * DAY;
    const from = to - 7 * DAY;
    return { weekStart: new Date(from).toISOString().slice(0, 10), done: doneTasks.filter((t) => doneAt(t) > from && doneAt(t) <= to).length };
  });

  // cycle time (In Progress -> Done)
  const taskMap = new Map<string, any>(doneTasks.map((t) => [String(t._id), { ...t, status: "Done" }]));
  const cycle = cycleStats([...taskMap.keys()], taskMap, evMap as any).cycle;

  // time logged
  const tAgg: any[] = await TimeEntry.aggregate([
    { $match: { workspaceId: new Types.ObjectId(workspaceId), userId: u, date: { $gte: new Date(now - 30 * DAY) } } },
    { $group: { _id: null, month: { $sum: "$minutes" }, week: { $sum: { $cond: [{ $gte: ["$date", new Date(now - 7 * DAY)] }, "$minutes", 0] } } } },
  ]);

  // per project
  const projects: any[] = await Project.find({ workspaceId, $or: [{ members: uid }, { managerId: uid }, { createdBy: uid }] })
    .select("name color icon status managerId memberRoles")
    .limit(60)
    .lean();
  const perProject: any[] = await Task.aggregate([
    { $match: { workspaceId: new Types.ObjectId(workspaceId), assigneeIds: u, parentTaskId: { $exists: false }, projectId: { $exists: true } } },
    { $group: { _id: "$projectId", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "Done"] }, 1, 0] } } } },
  ]);
  const pp = new Map(perProject.map((x) => [String(x._id), x]));
  const projectNames = new Map(projects.map((p) => [String(p._id), p.name]));

  // development (GitHub)
  const allTaskIds = [...openTasks, ...doneTasks].map((t) => t._id);
  const since = new Date(now - 30 * DAY);
  const [mergedPrs, commits] = allTaskIds.length
    ? await Promise.all([
        GithubTaskLink.countDocuments({ taskId: { $in: allTaskIds }, type: "pr", state: "merged", updatedAtExt: { $gte: since } }),
        GithubTaskLink.countDocuments({ taskId: { $in: allTaskIds }, type: "commit", updatedAtExt: { $gte: since } }),
      ])
    : [0, 0];

  const recent: any[] = await ActivityLog.find({ workspaceId, actorId: uid }).sort({ createdAt: -1 }).limit(15).select("action resourceType metadata createdAt").lean();

  const overdue = openTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now);
  const byStatus: Record<string, number> = {};
  openTasks.forEach((t) => (byStatus[t.status] = (byStatus[t.status] || 0) + 1));
  const upcoming = [...openTasks].sort((a, b) => (a.dueDate ? +new Date(a.dueDate) : Infinity) - (b.dueDate ? +new Date(b.dueDate) : Infinity)).slice(0, 8);

  return sendSuccess(
    res, 200,
    {
      summary: {
        assigned: totalAssigned,
        open: openTasks.length,
        completed: doneTotal,
        overdue: overdue.length,
        completionRate: totalAssigned ? Math.round((doneTotal / totalAssigned) * 100) : 0,
        onTimeRate: withDue.length ? Math.round((onTime / withDue.length) * 100) : null,
        onTimeSample: withDue.length,
        avgCycleDays: cycle.avg,
        medianCycleDays: cycle.median,
        cycleSample: cycle.count,
        completedLast30Days: doneTasks.filter((t) => doneAt(t) >= now - 30 * DAY).length,
      },
      workload: {
        openTasks: openTasks.length,
        estimatedMinutes: openTasks.reduce((a, t) => a + (t.estimatedMinutes || 0), 0),
        byStatus,
        dueThisWeek: openTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() >= now && new Date(t.dueDate).getTime() <= now + 7 * DAY).length,
      },
      weekly,
      time: { weekMinutes: tAgg[0]?.week || 0, monthMinutes: tAgg[0]?.month || 0 },
      development: { mergedPrs, commits, days: 30 },
      projects: projects.map((p) => {
        const x = pp.get(String(p._id));
        const explicit = (p.memberRoles || []).find((r: any) => String(r.userId) === String(uid));
        return {
          _id: p._id, name: p.name, color: p.color, icon: p.icon, status: p.status,
          role: String(p.managerId) === String(uid) ? "Manager" : explicit ? explicit.role : "Member",
          assigned: x?.total || 0, done: x?.done || 0,
        };
      }),
      upcoming: upcoming.map((t) => ({
        _id: t._id, taskNumber: t.taskNumber, title: t.title, status: t.status, priority: t.priority, type: t.type || "Task",
        dueDate: t.dueDate || null, projectId: t.projectId || null, projectName: t.projectId ? projectNames.get(String(t.projectId)) || null : null,
      })),
      recent,
    },
    "Member progress"
  );
});