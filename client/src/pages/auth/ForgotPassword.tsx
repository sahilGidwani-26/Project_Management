import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2, MailCheck } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthShell } from "@/components/auth/AuthShell";
import { AField, EMAIL_RE, FormAlert } from "@/components/auth/authUi";

const inbox = (email: string) => {
  const d = email.split("@")[1]?.toLowerCase() || "";
  if (d === "gmail.com" || d === "googlemail.com") return ["Open Gmail", "https://mail.google.com"];
  if (/^(outlook|hotmail|live|msn)\./.test(d)) return ["Open Outlook", "https://outlook.live.com/mail"];
  if (/^yahoo\./.test(d)) return ["Open Yahoo Mail", "https://mail.yahoo.com"];
  return null;
};

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) return setError("Enter a valid email address");
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: em });
      setSent(true);
      setWait(30);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const box = inbox(email.trim());
  return (
    <AuthShell title={sent ? "Check your email" : "Reset your password"} subtitle={sent ? undefined : "Enter your email and we will send you a link to choose a new password"} footer={<Link to="/login" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Back to log in</Link>}>
      {sent ? (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"><MailCheck className="h-6 w-6 text-primary" /></span>
            <p className="text-sm">If <b>{email.trim()}</b> has an account, a reset link is on its way. The link works for 1 hour.</p>
            {box && <Button asChild variant="outline" size="sm"><a href={box[1]} target="_blank" rel="noopener noreferrer">{box[0]} <ExternalLink className="h-3.5 w-3.5" /></a></Button>}
          </div>
          {error && <FormAlert>{error}</FormAlert>}
          <p className="text-center text-sm text-muted-foreground">
            Did not get it? Check your spam folder, or{" "}
            <button type="button" disabled={wait > 0 || loading} onClick={() => send()} className="font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline">{wait > 0 ? `send again in ${wait}s` : "send it again"}</button>.
          </p>
        </div>
      ) : (
        <form onSubmit={send} className="space-y-4" noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <AField id="email" label="Email"><Input id="email" type="email" autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></AField>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}