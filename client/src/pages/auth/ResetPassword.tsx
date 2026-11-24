import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/AuthShell";
import { AField, FormAlert, PasswordInput, StrengthMeter } from "@/components/auth/authUi";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("The password must be at least 8 characters");
    if (password !== again) return setError("The two passwords do not match");
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="This link is not valid" subtitle="The reset link is incomplete. Request a new one.">
        <div className="space-y-4"><div className="flex justify-center"><ShieldAlert className="h-10 w-10 text-muted-foreground" /></div><Button asChild size="lg" className="w-full"><Link to="/forgot-password">Get a new link</Link></Button></div>
      </AuthShell>
    );
  }
  if (done) {
    return (
      <AuthShell title="Password changed">
        <div className="space-y-5 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15"><CheckCircle2 className="h-7 w-7 text-emerald-600" /></span>
          <p className="text-sm text-muted-foreground">Your password was changed. You can log in with the new password now.</p>
          <Button asChild size="lg" className="w-full"><Link to="/login?reset=ok">Log in</Link></Button>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password" subtitle="Pick something you have not used before" footer={<Link to="/login" className="font-medium text-primary hover:underline">Back to log in</Link>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <FormAlert>{error}{/invalid|expired/i.test(error) && <> <Link to="/forgot-password" className="underline">Get a new link</Link></>}</FormAlert>}
        <AField id="password" label="New password"><PasswordInput id="password" autoFocus value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" /><StrengthMeter value={password} /></AField>
        <AField id="again" label="Repeat the password"><PasswordInput id="again" value={again} onChange={setAgain} autoComplete="new-password" /></AField>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Save password</Button>
      </form>
    </AuthShell>
  );
}