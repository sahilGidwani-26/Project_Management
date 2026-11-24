import crypto from "crypto";
import { env } from "../config/env";

// Set APP_ENCRYPTION_KEY in .env (any long random text). If it is missing the JWT secret is used, but then changing
// the JWT secret would make saved email passwords unreadable.
const key = () => crypto.createHash("sha256").update(process.env.APP_ENCRYPTION_KEY || `${env.JWT_SECRET}|secrets`).digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, data] = String(blob).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}