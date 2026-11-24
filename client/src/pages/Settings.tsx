import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BadgeCheck, Building2, CalendarDays, CheckCircle2, Clock, KeyRound, Link2, Loader2, LogOut, Mail, Palette, ShieldAlert, SlidersHorizontal, User } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/common/PageHeader";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AField, PasswordInput, StrengthMeter, selectCls } from "@/components/auth/authUi";
import { EmailSettings } from "@/components/settings/EmailSettings";
import type { CompanyData, ProfileData } from "@/components/profile/profileTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn, formatDate } from "@/lib/utils";

const Section = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <Card><CardContent className="space-y-4 p-5"><div><h3 className="font-medium">{title}</h3>{desc && <p className="text-xs text-muted-foreground">{desc}</p>}</div>{children}</CardContent></Card>
);
const ToggleRow = ({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-center justify-between gap-4 py-1"><div><p className="text-sm">{label}</p>{desc && <p className="text-xs text-muted-foreground">{desc}</p>}</div><Switch checked={checked} onCheckedChange={onChange} /></div>
);

/* ---------------------------------- account ---------------------------------- */

function AccountSection({ p }: { p: ProfileData }) {
  const { logout } = useAuth();
  const [cp, setCp] = useState(""); const [np, setNp] = useState(""); const [np2, setNp2] = useState("");
  const [busy, setBusy] = useState(false); const [sending, setSending] = useState(false);

  const change = async () => {
    if (!cp) return toast.error("Enter your current password");
    if (np.length < 8) return toast.error("The new password must be at least 8 characters");
    if (np !== np2) return toast.error("The two new passwords do not match");
    setBusy(true);
    try { await api.post("/auth/change-password", { currentPassword: cp, newPassword: np }); toast.success("Password changed"); setCp(""); setNp(""); setNp2(""); } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };
  const verify = async () => { setSending(true); try { await api.post("/profile/resend-verification"); toast.success("Verification email sent"); } catch (e) { toast.error(apiError(e)); } setSending(false); };

  return (
    <div className="space-y-4">
      <Section title="Sign-in details">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center gap-3"><Mail className="h-5 w-5 text-muted-foreground" /><div><p className="text-sm font-medium">{p.email}</p><p className="text-xs text-muted-foreground">Your login email</p></div></div>
          {p.emailVerified ? <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400"><BadgeCheck className="h-3.5 w-3.5" /> Verified</Badge> : <Button size="sm" variant="outline" disabled={sending} onClick={verify}>{sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />} Verify email</Button>}
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground">Password</span><span>{p.hasPassword ? "Set" : "Not set"}</span></div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground">Google sign-in</span><span>{p.googleLinked ? "Linked" : "Not linked"}</span></div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground">Account created</span><span>{formatDate(p.createdAt)}</span></div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground">Last login</span><span>{p.lastLoginAt ? formatDate(p.lastLoginAt) : "—"}</span></div>
        </div>
      </Section>

      <Section title="Change password" desc="Choose a strong password that you do not use anywhere else.">
        {p.hasPassword ? (
          <div className="grid max-w-md gap-4">
            <AField id="cp" label="Current password"><PasswordInput id="cp" value={cp} onChange={setCp} autoComplete="current-password" /></AField>
            <AField id="np" label="New password"><PasswordInput id="np" value={np} onChange={setNp} autoComplete="new-password" /><StrengthMeter value={np} /></AField>
            <AField id="np2" label="Repeat the new password"><PasswordInput id="np2" value={np2} onChange={setNp2} autoComplete="new-password" /></AField>
            <div><Button disabled={busy} onClick={change}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Change password</Button></div>
          </div>
        ) : <p className="text-sm text-muted-foreground">You sign in with Google, so there is no password. To add one, use <Link to="/forgot-password" className="text-primary hover:underline">Forgot password</Link> with your email.</p>}
      </Section>

      <Section title="Session"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Log out of Flowbase on this device.</p><Button variant="outline" onClick={logout}><LogOut className="h-4 w-4" /> Log out</Button></div></Section>
    </div>
  );
}

/* -------------------------------- preferences -------------------------------- */

const ZONES: string[] = (() => { try { const z = (Intl as any).supportedValuesOf?.("timeZone"); if (z?.length) return z; } catch { /* old browser */ } return ["Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"]; })();

function PreferencesSection({ p, onSaved }: { p: ProfileData; onSaved: (p: ProfileData) => void }) {
  const [tz, setTz] = useState(p.timezone || "UTC");
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(i); }, []);
  useEffect(() => setTz(p.timezone || "UTC"), [p.timezone]);
  const list = useMemo(() => [...new Set([tz, "UTC", ...ZONES])].sort(), [tz]);
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = (() => { try { return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(new Date()); } catch { return ""; } })();

  const save = async () => { setBusy(true); try { const r = await api.put("/profile", { timezone: tz }); onSaved(r.data.data); toast.success("Timezone saved"); } catch (e) { toast.error(apiError(e)); } setBusy(false); };

  return (
    <Section title="Timezone" desc="Decides what “today” means for your dashboard, your morning standup email and your attendance.">
      <div className="max-w-md space-y-3">
        <AField id="tz" label="Your timezone"><select id="tz" className={cn(selectCls, "w-full")} value={tz} onChange={(e) => setTz(e.target.value)}>{list.map((z) => <option key={z}>{z}</option>)}</select></AField>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="h-4 w-4" /> It is {now} there</p>
        {detected && detected !== tz && <button type="button" className="text-sm text-primary hover:underline" onClick={() => setTz(detected)}>Use my device timezone ({detected})</button>}
        <div><Button disabled={busy || tz === p.timezone} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save timezone</Button></div>
      </div>
    </Section>
  );
}

/* ------------------------------- notifications ------------------------------- */

function NotificationsSection() {
  const { user, refetchUser } = useAuth();
  const saved: any = (user as any)?.notificationPreferences || {};
  const [v, setV] = useState({ taskAssigned: true, mentions: true, comments: true, deadlines: true, workspaceInvites: true, standupDigest: false, standupHour: 9 });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV((x) => ({ ...x, ...Object.fromEntries(Object.entries(saved).filter(([k]) => k in x)) })); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);
  const set = (k: keyof typeof v, val: boolean | number) => setV((x) => ({ ...x, [k]: val }));
  const dirty = Object.entries(v).some(([k, val]) => (saved[k] ?? (k === "standupDigest" ? false : k === "standupHour" ? 9 : true)) !== val);

  const save = async () => { setBusy(true); try { await api.patch("/auth/notification-preferences", v); await refetchUser(); toast.success("Notification settings saved"); } catch (e) { toast.error(apiError(e)); } setBusy(false); };

  return (
    <div className="space-y-4">
      <Section title="Email me when" desc="You always see these in the bell. This controls the emails.">
        <ToggleRow label="A task is assigned to me" checked={v.taskAssigned} onChange={(x) => set("taskAssigned", x)} />
        <ToggleRow label="Somebody mentions me" checked={v.mentions} onChange={(x) => set("mentions", x)} />
        <ToggleRow label="Somebody comments on my tasks" checked={v.comments} onChange={(x) => set("comments", x)} />
        <ToggleRow label="A deadline is coming up" checked={v.deadlines} onChange={(x) => set("deadlines", x)} />
        <ToggleRow label="I am invited to a workspace" checked={v.workspaceInvites} onChange={(x) => set("workspaceInvites", x)} />
      </Section>
      <Section title="Daily standup email" desc="A morning summary of what you did yesterday and what is on your plate. Sent on weekdays in your timezone.">
        <ToggleRow label="Send me the standup email" checked={v.standupDigest} onChange={(x) => set("standupDigest", x)} />
        {v.standupDigest && (
          <div className="max-w-xs"><AField id="sh" label="Send at"><select id="sh" className={cn(selectCls, "w-full")} value={v.standupHour} onChange={(e) => set("standupHour", Number(e.target.value))}>{[5, 6, 7, 8, 9, 10, 11, 12].map((h) => <option key={h} value={h}>{h}:00 {h < 12 ? "AM" : "PM"}</option>)}</select></AField></div>
        )}
      </Section>
      <p className="text-xs text-muted-foreground">Account emails (verify your email, reset your password) are always sent.</p>
      <div className="flex justify-end"><Button disabled={!dirty || busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save notifications</Button></div>
    </div>
  );
}

/* ------------------------------ connected accounts ------------------------------ */

function ConnectionsSection({ workspaceId, p }: { workspaceId: string; p: ProfileData }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: cal, isLoading } = useQuery({ queryKey: ["google-calendar-status"], queryFn: async () => (await api.get("/auth/google-calendar/status")).data.data as { connected: boolean } });

  const connect = async () => { setBusy(true); try { const r = await api.get(`/auth/google-calendar/connect-url?workspaceId=${workspaceId}`); window.location.href = r.data.data.url; } catch (e) { toast.error(apiError(e)); setBusy(false); } };
  const disconnect = async () => { setBusy(true); try { await api.post("/auth/google-calendar/disconnect"); qc.invalidateQueries({ queryKey: ["google-calendar-status"] }); toast.success("Google Calendar disconnected"); } catch (e) { toast.error(apiError(e)); } setBusy(false); };

  return (
    <div className="space-y-4">
      <Section title="Google Calendar" desc="Meetings you organize get a real Google Meet link on your own calendar.">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><CalendarDays className="h-5 w-5 text-primary" /></span><div><p className="text-sm font-medium">Google Calendar</p>{cal?.connected && <Badge variant="secondary" className="mt-1 gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>}</div></div>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : cal?.connected ? <Button variant="outline" size="sm" disabled={busy} onClick={disconnect}>Disconnect</Button> : <Button size="sm" disabled={busy} onClick={connect}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Connect</Button>}
        </div>
      </Section>
      <Section title="Sign in with Google"><p className="text-sm text-muted-foreground">{p.googleLinked ? "Your account is linked to Google, so you can log in with one click." : "Not linked. If you log in with Google once, using the same email, it gets linked."}</p></Section>
    </div>
  );
}

/* ----------------------------------- workspace ----------------------------------- */

function WorkspaceSection({ workspaceId }: { workspaceId: string }) {
  const { can } = usePermissions();
  const { data: co } = useQuery({ queryKey: ["company", workspaceId], queryFn: async () => (await api.get(`/workspaces/${workspaceId}/company`)).data.data as CompanyData });
  if (!co) return <Skeleton className="h-64" />;
  const links = [
    { to: `profile?tab=company`, label: "Company profile", desc: "Name, logo, industry, address and tax ID", ok: true },
    { to: "attendance/settings", label: "Attendance settings", desc: "Working days, shift hours, holidays and leave types", ok: can("attendance.settings") },
    { to: "roles", label: "Roles and permissions", desc: "Decide who can see and do what", ok: can("roles.view") },
    { to: "team", label: "Team", desc: "Add, import and manage people", ok: can("people.view") },
  ].filter((l) => l.ok);
  return (
    <div className="space-y-4">
      <Section title="Workspace">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {[["Name", co.workspace.name], ["Web address ID", co.workspace.slug], ["Owner", co.owner?.name || "—"], ["People", String(co.memberCount)], ["Created", formatDate(co.workspace.createdAt)]].map(([k, val]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-muted-foreground">{k}</span><span className="truncate pl-3">{val}</span></div>
          ))}
        </div>
      </Section>
      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => <Link key={l.to} to={`/app/${workspaceId}/${l.to}`} className="rounded-xl border border-border p-4 transition hover:border-primary/40 hover:bg-primary/5"><p className="text-sm font-medium">{l.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{l.desc}</p></Link>)}
      </div>
    </div>
  );
}

/* ------------------------------------- page ------------------------------------- */

export default function Settings() {
  const { workspaceId } = useParams();
  const w = workspaceId!;
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const { refetchUser } = useAuth();

  const { data: p } = useQuery({ queryKey: ["profile"], queryFn: async () => (await api.get("/profile")).data.data as ProfileData });

  // Google sends the browser back here after the Calendar consent screen (?calendar=connected | error)
  useEffect(() => {
    const status = sp.get("calendar");
    if (!status) return;
    if (status === "connected") { toast.success("Google Calendar connected. New meetings will get a real Google Meet link."); qc.invalidateQueries({ queryKey: ["google-calendar-status"] }); }
    else toast.error("Couldn't connect Google Calendar. Please try again.");
    setSp({ tab: "connections" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections = [
    { key: "account", label: "Account", icon: User, ok: true },
    { key: "preferences", label: "Preferences", icon: SlidersHorizontal, ok: true },
    { key: "notifications", label: "Notifications", icon: Bell, ok: true },
    { key: "appearance", label: "Appearance", icon: Palette, ok: true },
    { key: "connections", label: "Connected accounts", icon: Link2, ok: true },
    { key: "workspace", label: "Workspace", icon: Building2, ok: can("workspace.edit") },
    { key: "email", label: "Email", icon: Mail, ok: can("workspace.edit") },
  ].filter((s) => s.ok);
  const active = sections.find((s) => s.key === sp.get("tab"))?.key || "account";

  const saved = (np: ProfileData) => { qc.setQueryData(["profile"], np); refetchUser(); };

  return (
    <div>
      <PageHeader title="Settings" description="Your account, notifications and workspace" />
      <div className="grid gap-6 p-4 md:grid-cols-[220px_1fr] md:p-6">
        <nav className="flex gap-1 overflow-x-auto md:sticky md:top-4 md:h-fit md:flex-col">
          {sections.map((s) => (
            <button key={s.key} type="button" onClick={() => setSp({ tab: s.key }, { replace: true })} className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors", active === s.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
              <s.icon className="h-4 w-4" />{s.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 max-w-4xl">
          {!p ? <Skeleton className="h-96" /> : (
            <div key={active} className="lp-in">
              {active === "account" && <AccountSection p={p} />}
              {active === "preferences" && <PreferencesSection p={p} onSaved={saved} />}
              {active === "notifications" && <NotificationsSection />}
              {active === "appearance" && (
                <Section title="Theme" desc="Switch between light and dark. Your choice is remembered on this device.">
                  <div className="flex items-center gap-3"><ThemeToggle /><span className="text-sm text-muted-foreground">Click the button to change the theme.</span></div>
                </Section>
              )}
              {active === "connections" && <ConnectionsSection workspaceId={w} p={p} />}
              {active === "workspace" && <WorkspaceSection workspaceId={w} />}
              {active === "email" && <EmailSettings workspaceId={w} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}