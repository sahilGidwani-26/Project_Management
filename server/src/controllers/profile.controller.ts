import { Request, Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/ApiResponse";
import { User } from "../models/User";
import { Media } from "../models/Media";
import { generateRawToken, hashToken } from "../utils/crypto";
import { esc, wrap } from "../utils/emailTemplates";
import { sendMail } from "../utils/mailer";
import { validTz } from "../services/attendanceCalc";
import { limit } from "../services/meeting";
import { PHONE, mediaUrl, parseImage, site, social, text } from "../services/profileUtils";
import { env } from "../config/env";

const bad = (m: string) => ApiError.badRequest(m);

const view = (u: any) => ({
  _id: u._id, name: u.name, email: u.email, emailVerified: !!u.emailVerified, profileImage: u.profileImage || null, jobTitle: u.jobTitle || "", bio: u.bio || "",
  phone: u.phone || "", city: u.city || "", country: u.country || "", website: u.website || "", social: u.social || {}, timezone: u.timezone || "UTC",
  accountType: u.accountType || null, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, hasPassword: !!u.passwordHash, googleLinked: !!u.googleId,
});
const load = (id: string) => User.findById(id).select("+passwordHash googleId").lean();

export const getProfile = catchAsync(async (req: Request, res: Response) => {
  const u = await load(req.user!.id);
  if (!u) throw ApiError.notFound("User not found");
  return sendSuccess(res, 200, view(u), "Profile");
});

export const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const uid = req.user!.id;
  const b = req.body || {};
  const set: Record<string, unknown> = {};
  const unset: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined) return;
    if (v === "" || v === null) unset[k] = "";
    else set[k] = v;
  };

  if (b.name !== undefined) {
    const n = text(b.name, 80);
    if (!n || n.length < 2) throw bad("Your name must be at least 2 characters");
    set.name = n;
  }
  put("jobTitle", text(b.jobTitle, 100));
  put("bio", text(b.bio, 500, true));
  put("city", text(b.city, 80));
  put("country", text(b.country, 80));
  if (b.phone !== undefined) {
    const p = text(b.phone, 25) || "";
    if (p && !PHONE.test(p)) throw bad("The phone number looks wrong. Use digits, spaces and + ( ) - only");
    put("phone", p);
  }
  if (b.website !== undefined) put("website", site(b.website));
  if (b.social && typeof b.social === "object") {
    for (const k of ["linkedin", "github", "twitter", "instagram"] as const) if (b.social[k] !== undefined) put(`social.${k}`, social(k, b.social[k]));
  }
  if (b.timezone !== undefined) {
    if (!validTz(String(b.timezone))) throw bad("Unknown timezone");
    set.timezone = String(b.timezone);
  }
  if (b.accountType === "owner" || b.accountType === "member") {
    const cur: any = await User.findById(uid).select("accountType").lean();
    if (!cur?.accountType) set.accountType = b.accountType; // chosen once at signup
  }

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  if (Object.keys(update).length) await User.updateOne({ _id: uid }, update);
  return sendSuccess(res, 200, view((await load(uid))!), "Profile saved");
});

/** body { image: "data:image/jpeg;base64,..." }: the browser has already cropped and resized it. */
export const uploadPhoto = catchAsync(async (req: Request, res: Response) => {
  const uid = req.user!.id;
  const { mime, buf } = parseImage(req.body?.image);
  await Media.findOneAndUpdate({ kind: "user", ownerId: uid }, { $set: { mime, data: buf, size: buf.length } }, { upsert: true });
  await User.updateOne({ _id: uid }, { $set: { profileImage: mediaUrl(req, "user", uid) } });
  return sendSuccess(res, 200, view((await load(uid))!), "Photo saved");
});

export const deletePhoto = catchAsync(async (req: Request, res: Response) => {
  const uid = req.user!.id;
  await Media.deleteOne({ kind: "user", ownerId: uid });
  await User.updateOne({ _id: uid }, { $unset: { profileImage: "" } });
  return sendSuccess(res, 200, view((await load(uid))!), "Photo removed");
});

export const resendVerification = catchAsync(async (req: Request, res: Response) => {
  if (!limit(`verify:${req.user!.id}`, 3, 3600e3)) throw ApiError.conflict("You asked for this a few times already. Try again in an hour.");
  const u: any = await User.findById(req.user!.id).select("+emailVerificationTokenHash email name emailVerified");
  if (!u) throw ApiError.notFound("User not found");
  if (u.emailVerified) throw bad("Your email is already verified");

  const raw = generateRawToken();
  u.emailVerificationTokenHash = hashToken(raw);
  await u.save();
  const url = `${env.CLIENT_URL}/verify-email?token=${raw}`;
  sendMail(u.email, "Verify your email", wrap("Verify your email", `<p>Hi ${esc(u.name.split(" ")[0])}, confirm that this is your email address to finish setting up your account.</p>`, url, "Verify email")).catch(() => {});
  return sendSuccess(res, 200, null, "Verification email sent");
});

/** GET /api/media/:kind/:id (public: it is only a small profile picture or logo, so <img> tags work everywhere). */
export const serveMedia = catchAsync(async (req: Request, res: Response) => {
  const { kind, id } = req.params;
  if (!["user", "workspace"].includes(kind) || !/^[a-f\d]{24}$/i.test(id)) throw ApiError.notFound("Not found");
  const m: any = await Media.findOne({ kind, ownerId: id }).select("mime data");
  if (!m) throw ApiError.notFound("Not found");
  res.setHeader("Content-Type", m.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.end(Buffer.from(m.data));
});