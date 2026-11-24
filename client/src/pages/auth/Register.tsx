import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Briefcase, Check, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { api, apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/common/GoogleSignInButton";
import { AuthShell } from "@/components/auth/AuthShell";
import { AField, COMPANY_SIZES, CountryList, EMAIL_RE, FormAlert, INDUSTRIES, OrDivider, PasswordInput, PhoneInput, StrengthMeter, phoneOk, safeRedirect, selectCls } from "@/components/auth/authUi";
import { cn } from "@/lib/utils";

type Kind = "owner" | "member";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect");
  const invited = !!redirect && /^\/(invitations|meet)\//.test(redirect);

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>(invited ? "member" : "owner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [country, setCountry] = useState("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [website, setWebsite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const steps = kind === "owner" ? ["Account", "About you", "Company"] : ["Account", "About you"];
  const last = step === steps.length - 1;

  const check = (s: number): string => {
    if (s === 0) {
      if (name.trim().length < 2) return "Enter your full name";
      if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address";
      if (password.length < 8) return "The password must be at least 8 characters";
    }
    if (s === 1 && !phoneOk(phone)) return "Enter your mobile number";
    if (s === 2 && kind === "owner" && company.trim().length < 2) return "Enter your company or team name";
    return "";
  };

  const next = () => {
    const e = check(step);
    setError(e);
    if (!e) setStep((x) => x + 1);
  };

  const finish = async () => {
    for (let s = 0; s < steps.length; s++) {
      const e = check(s);
      if (e) { setError(e); setStep(s); return; }
    }
    setError("");
    setLoading(true);
    try {
      await register(name.trim(), email.trim().toLowerCase(), password);
    } catch (err) {
      setError(apiError(err));
      setStep(0);
      setLoading(false);
      return;
    }

    // the account exists now, so everything below is best effort
    try { await api.put("/profile", { phone, jobTitle: jobTitle.trim(), country: country.trim(), accountType: kind }); } catch { /* shown later in Profile */ }

    let target = safeRedirect(redirect, "/onboarding");
    if (kind === "owner") {
      try {
        const base = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "workspace";
        const ws = await api.post("/workspaces", { name: company.trim(), description: "", slug: `${base}-${Date.now().toString(36).slice(-4)}` });
        const id = ws.data.data._id;
        await api.put(`/workspaces/${id}/company`, { company: { industry, size, website: website.trim() } }).catch(() => undefined);
        target = `/app/${id}/dashboard`;
      } catch (err) {
        toast.error(`Your account is ready, but the workspace could not be created: ${apiError(err)}`);
        target = "/onboarding";
      }
    }
    toast.success("Welcome to Flowbase! Check your inbox to verify your email.");
    navigate(target, { replace: true });
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle={step === 0 ? "Start managing projects with your team" : step === 1 ? "Tell us a little about you" : "Tell us about your company"}
      footer={<>Already have an account? <Link to={`/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`} className="font-medium text-primary hover:underline">Log in</Link></>}
    >
      <CountryList />
      {/* progress */}
      <div className="mb-6">
        <div className="flex gap-1.5">{steps.map((_, i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-secondary")} />)}</div>
        <p className="mt-2 text-xs text-muted-foreground">Step {step + 1} of {steps.length} · {steps[step]}</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (loading) return; last ? finish() : next(); }} className="space-y-4" noValidate>
        {error && <FormAlert>{error}</FormAlert>}

        {step === 0 && (
          <div key="s0" className="lp-in space-y-4">
            <AField id="name" label="Full name"><Input id="name" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" /></AField>
            <AField id="email" label="Work email"><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></AField>
            <AField id="password" label="Password">
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" />
              <StrengthMeter value={password} />
            </AField>
          </div>
        )}

        {step === 1 && (
          <div key="s1" className="lp-in space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {([["owner", Briefcase, "I run a company or team", "Create a workspace and invite people"], ["member", Users, "I am joining my team", "Use an invitation, or an account your admin made"]] as const).map(([k, Icon, t, d]) => (
                <button key={k} type="button" onClick={() => setKind(k)} className={cn("relative rounded-xl border p-3.5 text-left transition", kind === k ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40")}>
                  {kind === k && <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>}
                  <Icon className="mb-2 h-5 w-5 text-primary" />
                  <p className="text-sm font-medium">{t}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d}</p>
                </button>
              ))}
            </div>
            <AField id="phone" label="Mobile number" hint="Used for your profile. Your team sees it only if you allow it."><PhoneInput id="phone" value={phone} onChange={setPhone} /></AField>
            <div className="grid gap-4 sm:grid-cols-2">
              <AField id="job" label="Your role (optional)"><Input id="job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Founder, Designer…" maxLength={100} /></AField>
              <AField id="country" label="Country (optional)"><Input id="country" list="country-list" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="India" maxLength={80} /></AField>
            </div>
            {kind === "member" && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">{invited ? "You will join your team as soon as your account is ready." : "After signing up, open the invitation link from your email to join your team. You can also create your own workspace."}</p>}
          </div>
        )}

        {step === 2 && kind === "owner" && (
          <div key="s2" className="lp-in space-y-4">
            <AField id="company" label="Company or team name"><Input id="company" autoFocus value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Technologies" maxLength={80} /></AField>
            <div className="grid gap-4 sm:grid-cols-2">
              <AField id="industry" label="Industry (optional)">
                <select id="industry" className={cn(selectCls, "w-full")} value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">Choose…</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select>
              </AField>
              <AField id="size" label="Team size (optional)">
                <select id="size" className={cn(selectCls, "w-full")} value={size} onChange={(e) => setSize(e.target.value)}><option value="">Choose…</option>{COMPANY_SIZES.map((i) => <option key={i}>{i}</option>)}</select>
              </AField>
            </div>
            <AField id="website" label="Website (optional)"><Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" /></AField>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {step > 0 && <Button type="button" variant="outline" size="lg" disabled={loading} onClick={() => { setError(""); setStep((x) => x - 1); }}><ArrowLeft className="h-4 w-4" /> Back</Button>}
          <Button type="submit" size="lg" className="flex-1" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {last ? "Create account" : <>Continue <ArrowRight className="h-4 w-4" /></>}
          </Button>
        </div>
      </form>

      {step === 0 && (<><OrDivider /><GoogleSignInButton label="signup_with" /></>)}
    </AuthShell>
  );
}