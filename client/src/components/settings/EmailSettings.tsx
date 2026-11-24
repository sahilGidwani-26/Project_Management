import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { AField, PasswordInput, selectCls } from "@/components/auth/authUi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn, formatDate } from "@/lib/utils";

interface EmailCfg {
  enabled: boolean; preset: string; host: string; port: number; secure: boolean; username: string; hasPassword: boolean;
  fromName: string; fromEmail: string; replyTo: string; lastStatus: { ok: boolean; message: string; at: string } | null; platformAvailable: boolean;
}
interface Form { enabled: boolean; preset: string; host: string; port: string; secure: boolean; username: string; password: string; fromName: string; fromEmail: string; replyTo: string }

const PRESETS = [
  { key: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 587, secure: false, note: "Works with a personal Gmail or Google Workspace address. About 500 emails a day for Gmail, 2,000 for Workspace.", steps: ["Turn on 2-Step Verification for your Google account.", "Open myaccount.google.com/apppasswords and create an app password called Flowbase.", "Copy the 16-letter code and paste it as the password below. Your normal Gmail password will not work."] },
  { key: "outlook", label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, secure: false, note: "Use your full email address as the username.", steps: ["Use your full Outlook or Microsoft 365 email address.", "If you use 2-step sign-in, create an app password in your Microsoft account security page.", "If login fails, your IT admin may have to switch on “Authenticated SMTP” for your mailbox."] },
  { key: "yahoo", label: "Yahoo", host: "smtp.mail.yahoo.com", port: 587, secure: false, note: "Yahoo needs an app password.", steps: ["Open your Yahoo account security page.", "Choose “Generate app password” and name it Flowbase.", "Paste the code as the password below."] },
  { key: "zoho", label: "Zoho Mail", host: "smtp.zoho.com", port: 587, secure: false, note: "In India or the EU, your server may be smtp.zoho.in or smtp.zoho.eu. Change it under Server settings.", steps: ["Use your full Zoho email address.", "If you use two-factor sign-in, create an application-specific password in Zoho security settings.", "Paste it as the password below."] },
  { key: "custom", label: "Other", host: "", port: 587, secure: false, note: "Ask your email provider for the SMTP server name, port and login.", steps: ["Open Server settings below.", "Enter the SMTP server, the port (587 with SSL off, or 465 with SSL on), and your login.", "Use an app password if your provider offers one."] },
] as const;

const toForm = (d: EmailCfg): Form => ({ enabled: d.enabled, preset: d.preset, host: d.host, port: String(d.port), secure: d.secure, username: d.username, password: "", fromName: d.fromName, fromEmail: d.fromEmail, replyTo: d.replyTo });

export function EmailSettings({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const base = `/workspaces/${workspaceId}/email`;
  const { data, isLoading, isError } = useQuery({ queryKey: ["ws-email", workspaceId], queryFn: async () => (await api.get(base)).data.data as EmailCfg });
  const [f, setF] = useState<Form | null>(null);
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "test" | "remove">("");
  useEffect(() => { if (data) { setF(toForm(data)); setAdv(data.preset === "custom"); } }, [data]);

  if (isError) return <p className="text-sm text-destructive">Could not load the email settings.</p>;
  if (isLoading || !data || !f) return <Skeleton className="h-96" />;

  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const preset = PRESETS.find((p) => p.key === f.preset) || PRESETS[4];
  const orig = toForm(data);
  const dirty = f.password !== "" || (Object.keys(orig) as (keyof Form)[]).some((k) => k !== "password" && orig[k] !== f[k]);

  const pick = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)!;
    set({ preset: key, ...(p.host ? { host: p.host, port: String(p.port), secure: p.secure } : {}) });
    setAdv(key === "custom");
  };

  const save = async () => {
    setBusy("save");
    try {
      const res = await api.put(base, { ...f, port: Number(f.port) });
      qc.setQueryData(["ws-email", workspaceId], res.data.data);
      toast.success(res.data.message);
    } catch (e) { toast.error(apiError(e)); }
    setBusy("");
  };
  const test = async () => {
    setBusy("test");
    try { const r = await api.post(`${base}/test`); toast.success(r.data.message); } catch (e) { toast.error(apiError(e)); }
    qc.invalidateQueries({ queryKey: ["ws-email", workspaceId] });
    setBusy("");
  };
  const remove = async () => {
    if (!window.confirm("Stop using your own email? Emails will go out from the Flowbase default address again.")) return;
    setBusy("remove");
    try { await api.delete(base); await qc.invalidateQueries({ queryKey: ["ws-email", workspaceId] }); toast.success("Removed"); } catch (e) { toast.error(apiError(e)); }
    setBusy("");
  };

  const st = data.lastStatus;
  return (
    <div className="space-y-4">
      {data.enabled && st && !st.ok && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>Emails from your account are failing.</b> {st.message}<p className="mt-0.5 text-xs opacity-80">Emails are not sent from the default address instead, so nothing goes out until this is fixed. {formatDate(st.at)}</p></div></div>
      )}
      {data.enabled && (!st || st.ok) && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>This workspace sends its emails from <b>{data.fromEmail}</b>.{st?.ok ? ` ${st.message}` : " Send a test email to make sure it works."}</span></div>
      )}
      {!data.enabled && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 px-4 py-3 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span>{data.platformAvailable ? "Emails (invitations, new accounts, leave, meetings and reminders) go out from the Flowbase default address. Add your own email so they come from your company." : "No email account is set up, so no emails are being sent. Add one below."}</span></div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card><CardContent className="space-y-5 p-5">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div><p className="text-sm font-medium">Send this workspace's emails from my own email</p><p className="text-xs text-muted-foreground">Invitations, account details, leave, attendance and meeting emails.</p></div>
            <Switch checked={f.enabled} onCheckedChange={(v) => set({ enabled: v })} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Email provider</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => pick(p.key)} className={cn("rounded-lg border px-3 py-2 text-left text-sm transition", f.preset === p.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40")}>{p.label}</button>)}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <AField id="em-user" label="Email address (login)"><Input id="em-user" type="email" autoComplete="off" value={f.username} onChange={(e) => set({ username: e.target.value })} placeholder="you@company.com" /></AField>
            <AField id="em-pass" label={f.preset === "gmail" || f.preset === "yahoo" ? "App password" : "Password"} hint={data.hasPassword ? "A password is saved. Leave this empty to keep it." : undefined}>
              <PasswordInput id="em-pass" value={f.password} onChange={(v) => set({ password: v })} autoComplete="new-password" placeholder={data.hasPassword ? "•••••••• (saved)" : "Paste it here"} />
            </AField>
            <AField id="em-name" label="Sender name"><Input id="em-name" value={f.fromName} maxLength={60} onChange={(e) => set({ fromName: e.target.value })} placeholder="Acme Technologies" /></AField>
            <AField id="em-from" label="“From” email" hint="Usually the same as the login."><Input id="em-from" type="email" value={f.fromEmail} onChange={(e) => set({ fromEmail: e.target.value })} placeholder={f.username || "you@company.com"} /></AField>
            <AField id="em-reply" label="Reply-to (optional)"><Input id="em-reply" type="email" value={f.replyTo} onChange={(e) => set({ replyTo: e.target.value })} placeholder="support@company.com" /></AField>
          </div>

          <div>
            <button type="button" onClick={() => setAdv((a) => !a)} className="text-sm text-primary hover:underline">{adv ? "Hide server settings" : "Server settings"}</button>
            {adv && (
              <div className="lp-in mt-3 grid gap-4 sm:grid-cols-3">
                <AField id="em-host" label="SMTP server"><Input id="em-host" value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.example.com" /></AField>
                <AField id="em-port" label="Port"><select id="em-port" className={cn(selectCls, "w-full")} value={f.port} onChange={(e) => set({ port: e.target.value, secure: e.target.value === "465" })}>{[587, 465, 2525, 25].map((p) => <option key={p}>{p}</option>)}</select></AField>
                <AField id="em-ssl" label="SSL from the start"><div className="flex h-10 items-center gap-2"><Switch checked={f.secure} onCheckedChange={(v) => set({ secure: v })} /><span className="text-xs text-muted-foreground">On for port 465, off for 587</span></div></AField>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button disabled={busy !== "" || !dirty} onClick={save}>{busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Save settings</Button>
            <Button variant="outline" disabled={busy !== "" || dirty || !data.hasPassword} onClick={test} title={dirty ? "Save first" : undefined}>{busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test email</Button>
            {(data.host || data.username) && <Button variant="ghost" className="ml-auto text-destructive" disabled={busy !== ""} onClick={remove}>Remove</Button>}
          </div>
          <p className="text-xs text-muted-foreground">🔒 Your password is stored encrypted and is never shown again. The test email goes to your own address.</p>
        </CardContent></Card>

        <Card className="h-fit"><CardContent className="space-y-3 p-5">
          <h3 className="font-medium">How to set up {preset.label}</h3>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">{preset.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">{preset.note}</p>
          <p className="text-xs text-muted-foreground">Account emails like “Verify your email” and “Reset your password” always go from the Flowbase address, because the person is not in a workspace yet.</p>
        </CardContent></Card>
      </div>
    </div>
  );
}