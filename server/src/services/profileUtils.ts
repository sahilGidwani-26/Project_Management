import { Request } from "express";
import { ApiError } from "../utils/ApiError";

export const PHONE = /^\+?[0-9\s().-]{6,20}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const bad = (m: string) => ApiError.badRequest(m);

/** Trims, cuts to `max`, removes control characters (new lines stay only when `multiline`). */
export const text = (v: unknown, max: number, multiline = false) =>
  typeof v === "string" ? v.replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : undefined;

/** "company.com" -> "https://company.com/". Only http and https links are accepted. */
export function site(raw: unknown) {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const full = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(full);
    if (!u.hostname.includes(".")) throw new Error("x");
    return u.toString().slice(0, 200);
  } catch {
    throw bad("That website address looks wrong. Example: company.com");
  }
}

const SOCIAL = {
  linkedin: { domains: ["linkedin.com"], base: "https://www.linkedin.com/in/" },
  github: { domains: ["github.com"], base: "https://github.com/" },
  twitter: { domains: ["x.com", "twitter.com"], base: "https://x.com/" },
  instagram: { domains: ["instagram.com"], base: "https://instagram.com/" },
} as const;

/** Accepts a full link of the right site, or just a username. */
export function social(kind: keyof typeof SOCIAL, raw: unknown) {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const s = SOCIAL[kind];
  if (/^https?:\/\//i.test(v)) {
    let u: URL;
    try { u = new URL(v); } catch { throw bad(`That ${kind} link looks wrong`); }
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!s.domains.some((d) => h === d || h.endsWith(`.${d}`))) throw bad(`That does not look like a ${kind} link`);
    return u.toString().slice(0, 200);
  }
  const handle = v.replace(/^@/, "");
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(handle)) throw bad(`That ${kind} username looks wrong`);
  return s.base + handle;
}

/* ---------------------------------- images ---------------------------------- */

const IMG = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Checks a data URL sent by the browser and returns the real bytes (the file header is checked, not just the claimed type). */
export function parseImage(v: unknown, maxBytes = 300 * 1024) {
  const m = IMG.exec(String(v || ""));
  if (!m) throw bad("Choose a JPG, PNG or WebP image");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 100 || buf.length > maxBytes) throw bad(`The image is too large. Use one under ${Math.round(maxBytes / 1024)} KB.`);
  const ok =
    (m[1] === "image/jpeg" && buf[0] === 0xff && buf[1] === 0xd8) ||
    (m[1] === "image/png" && buf.subarray(1, 4).toString() === "PNG") ||
    (m[1] === "image/webp" && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP");
  if (!ok) throw bad("That file is not a real image");
  return { mime: m[1], buf };
}

/** Public address of a stored image. Set SERVER_URL in .env when the API sits behind a proxy or another domain. */
export const mediaUrl = (req: Request, kind: "user" | "workspace", id: unknown) =>
  `${(process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "")}/api/media/${kind}/${id}?v=${Date.now()}`;