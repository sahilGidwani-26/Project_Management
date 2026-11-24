import dns from "dns/promises";
import net from "net";
import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";
import { WorkspaceEmail } from "../models/WorkspaceEmail";
import { decrypt } from "../services/secrets";
import { mailCtx } from "./mailContext";

export const SMTP_PORTS = [25, 465, 587, 2525, 2587];

/* ------------------------- never connect to a private network ------------------------- */

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (x.startsWith("::ffff:")) { const r = x.slice(7); return net.isIPv4(r) ? isPrivateIp(r) : true; }
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
  }
  return true;
}

/** Looks the name up once and returns a public address. Refuses names that point to private, local or reserved addresses. */
export async function resolvePublic(host: string): Promise<string> {
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("That mail server address is not allowed");
    return host;
  }
  const all = await dns.lookup(host, { all: true });
  if (!all.length || all.some((a) => isPrivateIp(a.address))) throw new Error("That mail server address is not allowed (it points to a private network)");
  return all[0].address;
}

/* ---------------------------------- helpers ---------------------------------- */

export interface SmtpCfg { host: string; port: number; secure: boolean; user: string; pass: string; fromEmail: string; fromName?: string; replyTo?: string }

async function makeTransport(c: SmtpCfg): Promise<Transporter> {
  const ip = await resolvePublic(c.host);
  return nodemailer.createTransport({
    host: ip, // connect to the address we checked, and still verify the certificate for the real name
    port: c.port,
    secure: c.secure,
    requireTLS: !c.secure && c.port !== 25, // the password is never sent without encryption
    auth: { user: c.user, pass: c.pass },
    tls: { servername: c.host },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  } as any);
}

const fromAddr = (c: SmtpCfg) => (c.fromName ? `"${c.fromName.replace(/["\r\n<>]/g, "")}" <${c.fromEmail}>` : c.fromEmail);

export function explainMailError(e: any, host = ""): string {
  const code = e?.code;
  const msg = String(e?.response || e?.message || "");
  if (code === "EAUTH" || /\b53[45]\b|authentication|credentials|username and password|invalid login/i.test(msg)) {
    return "The mail server refused the login. Check the email and password. Gmail and Yahoo need an App Password, not your normal password.";
  }
  if (code === "ENOTFOUND" || code === "EDNS") return `The mail server “${host}” was not found. Check the spelling.`;
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED"].includes(code) || /timed? ?out|ECONNREFUSED/i.test(msg)) {
    return `Could not connect to ${host}. Check the server name, the port and the “SSL” switch (587 = off, 465 = on).`;
  }
  if (/self.signed|certificate|ssl|tls|wrong version/i.test(msg)) return "The secure connection failed. Try port 587 with SSL off, or port 465 with SSL on.";
  return msg.slice(0, 200) || "Could not send the email.";
}

/* ----------------------------- workspace mail account ----------------------------- */

const cache = new Map<string, { t: Transporter; at: number; sig: string; cfg: SmtpCfg }>();
const memo = new Map<string, { ok: boolean; at: number }>();
export const forgetMailCache = (workspaceId: string) => { cache.delete(String(workspaceId)); memo.delete(String(workspaceId)); };

async function noteStatus(workspaceId: string, ok: boolean, message: string) {
  const m = memo.get(workspaceId);
  if (m && m.ok === ok && Date.now() - m.at < 10 * 60e3) return; // do not write to the database for every email
  memo.set(workspaceId, { ok, at: Date.now() });
  await WorkspaceEmail.updateOne({ workspaceId }, { $set: { lastStatus: { ok, message, at: new Date() } } }).catch(() => undefined);
}

async function workspaceMail(workspaceId: string) {
  const d: any = await WorkspaceEmail.findOne({ workspaceId, enabled: true }).select("+passwordEnc").lean();
  if (!d || !d.host || !d.username || !d.passwordEnc || !d.fromEmail) return null;
  const sig = [d.host, d.port, d.secure, d.username, d.passwordEnc, d.fromEmail, d.fromName, d.replyTo].join("|");
  let hit = cache.get(workspaceId);
  if (!hit || hit.sig !== sig || Date.now() - hit.at > 5 * 60e3) {
    let pass: string;
    try { pass = decrypt(d.passwordEnc); } catch { throw new Error("The saved email password cannot be read any more. Enter it again in Settings."); }
    const cfg: SmtpCfg = { host: d.host, port: d.port, secure: !!d.secure, user: d.username, pass, fromEmail: d.fromEmail, fromName: d.fromName, replyTo: d.replyTo };
    hit = { t: await makeTransport(cfg), at: Date.now(), sig, cfg };
    cache.set(workspaceId, hit);
  }
  return hit;
}

/** Used by the "send test email" button. Does not touch the cache or the saved status. */
export async function sendWithConfig(c: SmtpCfg, to: string, subject: string, html: string) {
  const t = await makeTransport(c);
  try {
    await t.sendMail({ from: fromAddr(c), to, subject, html, ...(c.replyTo ? { replyTo: c.replyTo } : {}) });
  } finally {
    t.close();
  }
}

/* ---------------------------------- the platform account ---------------------------------- */

let platform: Transporter | null | undefined;
function platformTransport() {
  if (platform !== undefined) return platform;
  platform = env.SMTP_HOST
    ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined })
    : null;
  if (!platform) console.warn("[mail] SMTP is not configured, emails are skipped");
  return platform;
}

/**
 * Sends one email. If the request belongs to a workspace that set up its own email account, the mail goes out from that
 * account (and is NOT silently re-routed through the platform account when it fails). Otherwise the platform account is used.
 * `extra` is passed to nodemailer as it is (attachments, calendar invites...).
 */
export async function sendMail(to: string, subject: string, html: string, extra: Record<string, unknown> = {}): Promise<void> {
  const wid = mailCtx.getStore()?.workspaceId;
  if (wid) {
    let w: Awaited<ReturnType<typeof workspaceMail>>;
    try {
      w = await workspaceMail(wid);
    } catch (e) {
      await noteStatus(wid, false, explainMailError(e));
      throw e;
    }
    if (w) {
      try {
        await w.t.sendMail({ from: fromAddr(w.cfg), to, subject, html, ...(w.cfg.replyTo ? { replyTo: w.cfg.replyTo } : {}), ...extra });
        await noteStatus(wid, true, "The last email was sent fine.");
      } catch (e) {
        cache.delete(wid);
        await noteStatus(wid, false, explainMailError(e, w.cfg.host));
        throw e;
      }
      return;
    }
  }
  const t = platformTransport();
  if (!t) return;
  await t.sendMail({ from: env.SMTP_FROM, to, subject, html, ...extra });
}