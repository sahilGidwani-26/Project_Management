import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const selectCls = "h-10 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/** Only paths inside this app are followed after login. */
export const safeRedirect = (raw: string | null | undefined, fallback = "/app") =>
  raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : fallback;

export const INDUSTRIES = ["Software and IT", "Agency or studio", "Education", "Healthcare", "Finance", "E-commerce and retail", "Manufacturing", "Construction", "Media and marketing", "Consulting", "Non-profit", "Other"];
export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];
export const COUNTRIES = ["India", "United States", "United Kingdom", "United Arab Emirates", "Canada", "Australia", "Singapore", "Germany", "France", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Saudi Arabia", "Qatar", "Malaysia", "Indonesia", "Japan", "South Africa", "Nigeria", "Brazil", "Netherlands", "Ireland", "New Zealand"];
const DIALS: [string, string][] = [["+91", "India"], ["+1", "US / Canada"], ["+44", "UK"], ["+971", "UAE"], ["+61", "Australia"], ["+65", "Singapore"], ["+49", "Germany"], ["+33", "France"], ["+92", "Pakistan"], ["+880", "Bangladesh"], ["+94", "Sri Lanka"], ["+977", "Nepal"], ["+966", "Saudi Arabia"], ["+974", "Qatar"], ["+60", "Malaysia"], ["+62", "Indonesia"], ["+81", "Japan"], ["+86", "China"], ["+27", "South Africa"], ["+234", "Nigeria"], ["+55", "Brazil"], ["+31", "Netherlands"], ["+353", "Ireland"], ["+64", "New Zealand"], ["+82", "South Korea"], ["+90", "Turkey"], ["+20", "Egypt"]];

export const CountryList = () => <datalist id="country-list">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>;

/* --------------------------------- fields --------------------------------- */

export function AField({ id, label, hint, error, right, children }: { id?: string; label: string; hint?: string; error?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2"><label htmlFor={id} className="text-sm font-medium">{label}</label>{right}</div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FormAlert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "success" }) {
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm", tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span>
    </div>
  );
}

export const OrDivider = () => (
  <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-border" /><span className="text-xs text-muted-foreground">OR</span><div className="h-px flex-1 bg-border" /></div>
);

export function PasswordInput({ id, value, onChange, placeholder = "••••••••", autoComplete, autoFocus, className }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; autoComplete?: string; autoFocus?: boolean; className?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus} className={cn("pr-10", className)} />
      <button type="button" tabIndex={-1} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function scorePassword(p: string) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.max(1, Math.min(4, s));
}

export function StrengthMeter({ value }: { value: string }) {
  const s = scorePassword(value);
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];
  if (!value) return null;
  return (
    <div className="space-y-1">
      <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= s ? colors[s] : "bg-secondary")} />)}</div>
      <p className="text-xs text-muted-foreground">{labels[s]}{s < 3 ? ". Use 12 or more characters, capital letters, numbers and symbols." : ""}</p>
    </div>
  );
}

/* ------------------------------ phone number ------------------------------ */

export function splitPhone(v: string): [string, string] {
  const s = (v || "").trim();
  const hit = [...DIALS].sort((a, b) => b[0].length - a[0].length).find(([c]) => s.startsWith(c));
  return hit ? [hit[0], s.slice(hit[0].length).trim()] : ["+91", s.replace(/^0+/, "")];
}

/** Country code + number. Gives back one string like "+91 98765 43210" (empty when there is no number). */
export function PhoneInput({ id, value, onChange, placeholder = "98765 43210" }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [code, setCode] = useState(() => splitPhone(value)[0]);
  useEffect(() => { if (value) setCode(splitPhone(value)[0]); }, [value]);
  const num = value ? (value.startsWith(code) ? value.slice(code.length).trim() : splitPhone(value)[1]) : "";
  const set = (c: string, n: string) => onChange(n.trim() ? `${c} ${n.trim()}` : "");
  return (
    <div className="flex gap-2">
      <select aria-label="Country code" className={cn(selectCls, "w-32 shrink-0")} value={code} onChange={(e) => { setCode(e.target.value); set(e.target.value, num); }}>
        {DIALS.map(([c, n]) => <option key={c} value={c}>{c} {n}</option>)}
      </select>
      <Input id={id} inputMode="tel" autoComplete="tel-national" value={num} onChange={(e) => set(code, e.target.value.replace(/[^0-9 -]/g, ""))} placeholder={placeholder} />
    </div>
  );
}

export const phoneOk = (v: string) => { const d = v.replace(/\D/g, "").length; return d >= 8 && d <= 15; };