import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api, apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/common/GoogleSignInButton";
import { AuthShell } from "@/components/auth/AuthShell";
import { AField, EMAIL_RE, FormAlert, OrDivider, PasswordInput, safeRedirect } from "@/components/auth/authUi";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) return setError("Enter a valid email address");
    if (!password) return setError("Enter your password");
    setError("");
    setLoading(true);
    try {
      await login(em, password);
      try {
        // an account created by an admin must replace its temporary password first
        const me = await api.get("/auth/me");
        if (me.data.data.mustChangePassword) { navigate("/change-password", { replace: true }); return; }
      } catch { /* the normal flow below still works */ }
      navigate(safeRedirect(redirect), { replace: true });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your Flowbase workspace"
      footer={<>Don't have an account? <Link to={`/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`} className="font-medium text-primary hover:underline">Sign up</Link></>}
    >
      {params.get("reset") === "ok" && <div className="mb-4"><FormAlert tone="success">Your password was changed. Log in with the new one.</FormAlert></div>}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <AField id="email" label="Email">
          <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </AField>
        <AField id="password" label="Password" right={<Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>}>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </AField>
        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Log in
        </Button>
      </form>
      <OrDivider />
      <GoogleSignInButton label="signin_with" />
    </AuthShell>
  );
}