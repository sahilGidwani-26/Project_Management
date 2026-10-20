import bcrypt from "bcryptjs";
import crypto from "crypto";
import { User } from "../models/User";
import { WorkspaceMember, WorkspaceRole } from "../models/WorkspaceMember";
import { Invitation } from "../models/Invitation";
import { Channel } from "../models/Channel";
import { ActivityLog } from "../models/ActivityLog";
import { sendMail } from "../utils/mailer";
import { env } from "../config/env";
import { accountCreatedEmail, addedToWorkspaceEmail, workspaceInviteEmail } from "../utils/peopleEmailTemplates";
import { EMPLOYMENT, ROLES, buildPatch, canAssign, generatePassword } from "./people";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLE_ALIASES: Record<string, WorkspaceRole> = { pm: "PROJECT_MANAGER", "project mgr": "PROJECT_MANAGER", "project manager": "PROJECT_MANAGER" };
const str = (v: unknown, max = 200) => (v == null ? "" : String(v).trim().slice(0, max));
const send = (to: string, mail: { subject: string; html: string }) => {
  sendMail(to, mail.subject, mail.html).catch(() => {});
};

export function normRole(v: string): WorkspaceRole | null {
  if (!v) return "MEMBER";
  const k = v.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return ROLES.find((r) => r.toLowerCase().replace(/_/g, " ") === k) || ROLE_ALIASES[k] || null;
}

export function normEmployment(v: string): string | null {
  if (!v) return "";
  const k = v.toLowerCase().replace(/[\s-]+/g, "_").replace(/^(full|part)time$/, "$1_time");
  return EMPLOYMENT.includes(k) ? k : null;
}

export interface NormRow {
  email: string;
  name: string;
  role: WorkspaceRole;
  profile: { designation: string; department: string; company: string; employmentType: string };
  personal: { phone: string };
}

export interface CheckCtx {
  actorRole: WorkspaceRole;
  mode: "create" | "invite";
  seen: Set<string>;
  users: Map<string, any>;
  memberStatus: Map<string, string>;
}

export interface CheckResult {
  ok: boolean;
  email: string;
  name: string;
  role?: WorkspaceRole;
  error?: string;
  note?: string;
  norm?: NormRow;
}

/** Validates one CSV row without touching the database (everything it needs is passed in `ctx`). */
export function checkRow(raw: Record<string, unknown>, ctx: CheckCtx): CheckResult {
  const email = str(raw.email).toLowerCase();
  const name = str(raw.name, 100);
  const bad = (error: string): CheckResult => ({ ok: false, email, name, error });

  if (!email) return bad("Email is missing");
  if (email.length > 200 || !EMAIL_RE.test(email)) return bad("Email looks invalid");
  if (ctx.seen.has(email)) return bad("This email appears twice in the file");
  ctx.seen.add(email);

  const role = normRole(str(raw.role));
  if (!role) return bad(`Unknown role "${str(raw.role)}". Use Owner, Admin, Project Manager, Member or Viewer`);
  if (!canAssign(ctx.actorRole, role)) return bad(`You are not allowed to give the ${role.toLowerCase().replace(/_/g, " ")} role`);

  const employmentType = normEmployment(str(raw.employmentType ?? raw.employment_type));
  if (employmentType === null) return bad("Unknown employment type. Use full-time, part-time, contractor, intern, client or vendor");

  const user = ctx.users.get(email);
  if (user?.accountStatus === "suspended") return bad("This account is suspended on the platform");
  if (user && ctx.memberStatus.get(String(user._id)) === "active") return bad("Already a member of this workspace");
  if (!user && ctx.mode === "create" && name.length < 2) return bad("Name is required for a new account");

  const norm: NormRow = {
    email, name, role,
    profile: { designation: str(raw.designation, 100), department: str(raw.department, 100), company: str(raw.company, 120), employmentType },
    personal: { phone: str(raw.phone, 20) },
  };

  try {
    buildPatch({ profile: norm.profile, personal: norm.personal }, { admin: true, self: false }); // catches a bad phone number
  } catch (e) {
    return bad((e as Error).message);
  }

  const note = user
    ? ctx.mode === "create" ? "Existing account, will be added (password untouched)" : "Existing account, will get an invitation"
    : ctx.mode === "create" ? "New account" : "New invitation";
  return { ok: true, email, name: name || user?.name || "", role, note, norm };
}

export interface ProvisionCtx {
  workspaceId: string;
  actorId: string;
  byName: string;
  workspaceName: string;
  mode: "create" | "invite";
  send: boolean;
}

export type ProvisionOutcome = { status: "created" | "added" | "invited" | "refreshed"; message: string; temporaryPassword?: string };

async function inviteRow(n: NormRow, c: ProvisionCtx): Promise<ProvisionOutcome> {
  const expiresAt = new Date(Date.now() + 7 * 864e5);
  let inv: any = await Invitation.findOne({ workspaceId: c.workspaceId, email: n.email, status: "pending", expiresAt: { $gt: new Date() } });
  let refreshed = false;
  if (inv) {
    inv.role = n.role;
    inv.expiresAt = expiresAt;
    inv.invitedBy = c.actorId;
    await inv.save();
    refreshed = true;
  } else {
    inv = await Invitation.create({ workspaceId: c.workspaceId, email: n.email, role: n.role, token: crypto.randomBytes(24).toString("hex"), invitedBy: c.actorId, expiresAt });
  }
  send(n.email, workspaceInviteEmail({ workspaceName: c.workspaceName, inviterName: c.byName, role: n.role, url: `${env.CLIENT_URL}/invitations/${inv.token}`, expiresOn: expiresAt }));
  await ActivityLog.create({ workspaceId: c.workspaceId, actorId: c.actorId, action: "member_invited", resourceType: "Invitation", resourceId: inv._id, metadata: { title: n.email, role: n.role, bulk: true } }).catch(() => undefined);
  return { status: refreshed ? "refreshed" : "invited", message: refreshed ? "Pending invitation refreshed" : "Invitation sent" };
}

/** Creates the account (or adds the existing one) / the invitation for one checked row. Throws a readable Error on failure. */
export async function provisionRow(n: NormRow, c: ProvisionCtx): Promise<ProvisionOutcome> {
  if (c.mode === "invite") return inviteRow(n, c);

  const patch = buildPatch({ profile: n.profile, personal: n.personal }, { admin: true, self: false });
  let user: any = await User.findOne({ email: n.email }).select("_id name email accountStatus");
  const creating = !user;
  let plain: string | undefined;

  if (!user) {
    plain = generatePassword();
    try {
      user = await User.create({
        name: n.name, email: n.email, passwordHash: await bcrypt.hash(plain, 12), emailVerified: false,
        mustChangePassword: true, createdByWorkspaceId: c.workspaceId, jobTitle: n.profile.designation || undefined,
      });
    } catch (e: any) {
      if (e?.code === 11000) throw new Error("An account with this email was created a moment ago. Run the import again");
      throw e;
    }
  } else if (user.accountStatus === "suspended") {
    throw new Error("This account is suspended on the platform");
  }

  let member: any = await WorkspaceMember.findOne({ workspaceId: c.workspaceId, userId: user._id });
  if (member?.status === "active") throw new Error("Already a member of this workspace");
  if (member) {
    member.status = "active";
    member.role = n.role;
    member.deactivatedAt = undefined;
    member.deactivatedBy = undefined;
  } else {
    member = new WorkspaceMember({ workspaceId: c.workspaceId, userId: user._id, role: n.role });
  }
  member.addedBy = c.actorId;
  member.addedVia = "manual";
  member.set(patch);
  await member.save();
  await Channel.updateOne({ workspaceId: c.workspaceId, name: "general" }, { $addToSet: { members: user._id } });

  if (creating) {
    if (c.send) send(n.email, accountCreatedEmail({ workspaceName: c.workspaceName, creatorName: c.byName, email: n.email, role: n.role, password: plain }));
  } else {
    send(n.email, addedToWorkspaceEmail({ workspaceName: c.workspaceName, byName: c.byName, role: n.role, url: `${env.CLIENT_URL}/app/${c.workspaceId}/dashboard` }));
  }
  await ActivityLog.create({ workspaceId: c.workspaceId, actorId: c.actorId, action: creating ? "member_account_created" : "member_added", resourceType: "WorkspaceMember", resourceId: member._id, metadata: { title: user.name, role: n.role, bulk: true } }).catch(() => undefined);

  return creating
    ? { status: "created", message: "Account created", temporaryPassword: plain }
    : { status: "added", message: "Existing account added to the workspace" };
}