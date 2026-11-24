import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { Workspace } from "../models/Workspace";
import { WorkspaceMember } from "../models/WorkspaceMember";
import { WorkspaceEmail } from "../models/WorkspaceEmail";
import { Media } from "../models/Media";
import { User } from "../models/User";
import { ActivityLog } from "../models/ActivityLog";
import { esc, wrap } from "../utils/emailTemplates";
import { SMTP_PORTS, SmtpCfg, explainMailError, forgetMailCache, resolvePublic, sendWithConfig } from "../utils/mailer";
import { encrypt, decrypt } from "../services/secrets";
import { limit } from "../services/meeting";
import { EMAIL, PHONE, mediaUrl, parseImage, site, text } from "../services/profileUtils";
import { env } from "../config/env";

const bad = (m: string) => ApiError.badRequest(m);
const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];
const log = (workspaceId: string, actorId: string, action: string, metadata: Record<string, unknown> = {}) =>
  ActivityLog.create({ workspaceId, actorId, action, resourceType: "Workspace", resourceId: workspaceId, metadata }).catch(() => undefined);

/* ================================== company ================================== */

function cleanCompany(c: any) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined) return;
    if (v === "" || v === null) unset[`company.${k}`] = "";
    else set[`company.${k}`] = v;
  };
  put("legalName", text(c.legalName, 120));
  put("industry", text(c.industry, 60));
  if (c.size !== undefined) {
    if (c.size !== "" && !SIZES.includes(c.size)) throw bad("Choose a team size from the list");
    put("size", c.size);
  }
  if (c.website !== undefined) put("website", site(c.website));
  if (c.phone !== undefined) {
    const p = text(c.phone, 25) || "";
    if (p && !PHONE.test(p)) throw bad("The company phone number looks wrong");
    put("phone", p);
  }
  if (c.email !== undefined) {
    const e = (text(c.email, 200) || "").toLowerCase();
    if (e && !EMAIL.test(e)) throw bad("The company email looks wrong");
    put("email", e);
  }
  put("taxId", text(c.taxId, 30));
  if (c.foundedYear !== undefined) {
    if (c.foundedYear === "" || c.foundedYear === null) put("foundedYear", "");
    else {
      const y = Number(c.foundedYear);
      if (!Number.isInteger(y) || y < 1800 || y > new Date().getFullYear()) throw bad("The founding year looks wrong");
      put("foundedYear", y);
    }
  }
  const a = c.address && typeof c.address === "object" ? c.address : {};
  for (const k of ["line1", "line2", "city", "state", "country", "postalCode"]) put(`address.${k}`, text(a[k], k === "postalCode" ? 20 : 120));
  return { set, unset };
}

async function companyView(req: Request, workspaceId: string) {
  const ws: any = await Workspace.findById(workspaceId).lean();
  if (!ws) throw ApiError.notFound("Workspace not found");
  const admin = req.access!.perms.has("workspace.edit");
  const [owner, members]: [any, number] = await Promise.all([
    User.findById(ws.ownerId).select("name email profileImage jobTitle phone").lean(),
    WorkspaceMember.countDocuments({ workspaceId, status: "active" }),
  ]);
  const c = ws.company || {};
  return {
    workspace: { _id: ws._id, name: ws.name, slug: ws.slug, description: ws.description || "", logo: ws.logo || null, createdAt: ws.createdAt },
    owner: owner ? { _id: owner._id, name: owner.name, profileImage: owner.profileImage || null, jobTitle: owner.jobTitle || "", ...(admin ? { email: owner.email, phone: owner.phone || "" } : {}) } : null,
    // phone, email, address and tax id are for people who may edit the workspace
    company: admin ? c : { industry: c.industry, size: c.size, website: c.website, foundedYear: c.foundedYear },
    memberCount: members,
    canEdit: admin,
  };
}

export const getCompany = catchAsync(async (req: Request, res: Response) => sendSuccess(res, 200, await companyView(req, req.params.workspaceId), "Company"));

/** body { name?, description?, company?: { legalName, industry, size, website, phone, email, taxId, foundedYear, address: {...} } } */
export const updateCompany = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const b = req.body || {};
  const set: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};

  if (b.name !== undefined) {
    const n = text(b.name, 80);
    if (!n || n.length < 2) throw bad("The company name must be 2 to 80 characters");
    set.name = n;
  }
  if (b.description !== undefined) {
    const d = text(b.description, 300, true) || "";
    if (d) set.description = d;
    else unset.description = "";
  }
  if (b.company && typeof b.company === "object") {
    const c = cleanCompany(b.company);
    Object.assign(set, c.set);
    Object.assign(unset, c.unset);
  }

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  if (Object.keys(update).length) {
    await Workspace.updateOne({ _id: workspaceId }, update);
    await log(workspaceId, req.user!.id, "workspace_updated", { title: String(set.name || "Company details") });
  }
  return sendSuccess(res, 200, await companyView(req, workspaceId), "Saved");
});

export const uploadLogo = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { mime, buf } = parseImage(req.body?.image);
  await Media.findOneAndUpdate({ kind: "workspace", ownerId: workspaceId }, { $set: { mime, data: buf, size: buf.length } }, { upsert: true });
  await Workspace.updateOne({ _id: workspaceId }, { $set: { logo: mediaUrl(req, "workspace", workspaceId) } });
  await log(workspaceId, req.user!.id, "workspace_logo_changed", { title: "Logo" });
  return sendSuccess(res, 200, await companyView(req, workspaceId), "Logo saved");
});

export const removeLogo = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  await Media.deleteOne({ kind: "workspace", ownerId: workspaceId });
  await Workspace.updateOne({ _id: workspaceId }, { $unset: { logo: "" } });
  return sendSuccess(res, 200, await companyView(req, workspaceId), "Logo removed");
});

/* ================================ workspace email ================================ */

const emailView = (d: any) => ({
  enabled: !!d?.enabled, preset: d?.preset || "custom", host: d?.host || "", port: d?.port || 587, secure: !!d?.secure, username: d?.username || "",
  hasPassword: !!d?.passwordEnc, fromName: d?.fromName || "", fromEmail: d?.fromEmail || "", replyTo: d?.replyTo || "",
  lastStatus: d?.lastStatus || null,
  platformAvailable: !!env.SMTP_HOST, // true = the platform can still send emails when this is off
});

export const getEmail = catchAsync(async (req: Request, res: Response) => {
  const d = await WorkspaceEmail.findOne({ workspaceId: req.params.workspaceId }).select("+passwordEnc").lean();
  return sendSuccess(res, 200, emailView(d), "Email settings");
});

/** body { enabled, preset, host, port, secure, username, password?, fromName, fromEmail, replyTo }. An empty password keeps the saved one. */
export const saveEmail = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const b = req.body || {};
  const cur: any = await WorkspaceEmail.findOne({ workspaceId }).select("+passwordEnc");
  const enabled = !!b.enabled;

  const host = String(b.host || "").trim().toLowerCase().replace(/^smtps?:\/\//, "").replace(/\/.*$/, "");
  if (host && !/^[a-z0-9]([a-z0-9.-]{0,198}[a-z0-9])?$/.test(host)) throw bad("The mail server name looks wrong. Example: smtp.gmail.com");
  const port = Math.round(Number(b.port) || 587);
  if (!SMTP_PORTS.includes(port)) throw bad(`Use one of these ports: ${SMTP_PORTS.join(", ")}`);
  const username = (text(b.username, 200) || "").trim();
  const fromEmail = (text(b.fromEmail, 200) || username).toLowerCase();
  if (fromEmail && !EMAIL.test(fromEmail)) throw bad("The “from” email address looks wrong");
  const replyTo = (text(b.replyTo, 200) || "").toLowerCase();
  if (replyTo && !EMAIL.test(replyTo)) throw bad("The reply-to email address looks wrong");
  const fromName = (text(b.fromName, 60) || "").replace(/["<>]/g, "");
  const preset = ["gmail", "outlook", "yahoo", "zoho", "custom"].includes(b.preset) ? b.preset : "custom";

  let passwordEnc: string | undefined;
  if (typeof b.password === "string" && b.password !== "") {
    passwordEnc = encrypt(preset === "gmail" ? b.password.replace(/\s+/g, "") : b.password); // Gmail shows app passwords with spaces
  }
  if (enabled) {
    if (!host || !username || !fromEmail) throw bad("Fill in the mail server, the email address and the password before turning this on");
    if (!passwordEnc && !cur?.passwordEnc) throw bad("Enter the email password (an App Password for Gmail)");
    try { await resolvePublic(host); } catch (e) { throw bad(explainMailError(e, host)); }
  }

  const secure = !!b.secure;
  const changed = !cur || cur.host !== host || cur.port !== port || cur.secure !== secure || cur.username !== username || !!passwordEnc;
  const set: Record<string, unknown> = { enabled, preset, host, port, secure, username, fromName, fromEmail, replyTo, updatedBy: req.user!.id };
  if (passwordEnc) set.passwordEnc = passwordEnc;
  const update: Record<string, unknown> = { $set: set, $setOnInsert: { workspaceId } };
  if (changed) update.$unset = { lastStatus: "" };

  const doc = await WorkspaceEmail.findOneAndUpdate({ workspaceId }, update, { upsert: true, new: true }).select("+passwordEnc").lean();
  forgetMailCache(workspaceId);
  await log(workspaceId, req.user!.id, enabled ? "workspace_email_enabled" : "workspace_email_saved", { title: host || "Email settings" });
  return sendSuccess(res, 200, emailView(doc), enabled ? "Saved. This workspace now sends email from your account." : "Saved");
});

/** Sends a test email to the person who clicked the button (never to anybody else). Uses the SAVED settings. */
export const testEmail = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  if (!limit(`mailtest:${workspaceId}`, 6, 10 * 60e3)) throw ApiError.conflict("You tested a few times already. Wait a few minutes.");
  const d: any = await WorkspaceEmail.findOne({ workspaceId }).select("+passwordEnc");
  if (!d?.host || !d.username || !d.passwordEnc || !d.fromEmail) throw bad("Save your mail server, email and password first, then send the test.");
  const me: any = await User.findById(req.user!.id).select("email name");

  let pass: string;
  try { pass = decrypt(d.passwordEnc); } catch { throw bad("The saved password cannot be read. Enter it again and save."); }
  const cfg: SmtpCfg = { host: d.host, port: d.port, secure: !!d.secure, user: d.username, pass, fromEmail: d.fromEmail, fromName: d.fromName, replyTo: d.replyTo };

  try {
    await sendWithConfig(cfg, me.email, "Flowbase test email", wrap("Your email works", `<p>Hi ${esc(me.name.split(" ")[0])}, this test was sent from <b>${esc(d.fromEmail)}</b> using the settings you saved in Flowbase.</p><p>From now on, emails from this workspace go out from this address.</p>`));
  } catch (e) {
    const message = explainMailError(e, d.host);
    await WorkspaceEmail.updateOne({ workspaceId }, { $set: { lastStatus: { ok: false, message, at: new Date() } } });
    throw bad(message);
  }
  await WorkspaceEmail.updateOne({ workspaceId }, { $set: { lastStatus: { ok: true, message: `Test email sent to ${me.email}`, at: new Date() } } });
  return sendSuccess(res, 200, { to: me.email }, `Test email sent to ${me.email}. Check your inbox (and the spam folder).`);
});

export const removeEmail = catchAsync(async (req: Request, res: Response) => {
  await WorkspaceEmail.deleteOne({ workspaceId: req.params.workspaceId });
  forgetMailCache(req.params.workspaceId);
  await log(req.params.workspaceId, req.user!.id, "workspace_email_removed", { title: "Email settings" });
  return sendSuccess(res, 200, null, "Removed. The platform email account is used again.");
});