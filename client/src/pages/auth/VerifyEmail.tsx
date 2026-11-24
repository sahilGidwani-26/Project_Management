import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/AuthShell";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { user, refetchUser } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [msg, setMsg] = useState("");
  const ran = useRef(false); // the link can be used once, so React's double effect must not call it twice

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) { setMsg("This verification link is incomplete."); setState("error"); return; }
    api.post("/auth/verify-email", { token })
      .then(async () => { setState("ok"); if (localStorage.getItem("pm_token")) await refetchUser(); })
      .catch((e) => { setMsg(apiError(e)); setState("error"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell title={state === "ok" ? "Email verified" : state === "error" ? "Could not verify" : "Verifying your email…"}>
      <div className="space-y-5 text-center">
        {state === "loading" && <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />}
        {state === "ok" && (<><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15"><CheckCircle2 className="h-7 w-7 text-emerald-600" /></span><p className="text-sm text-muted-foreground">Thank you. Your email address is confirmed.</p><Button asChild size="lg" className="w-full"><Link to={user ? "/app" : "/login"}>{user ? "Continue to Flowbase" : "Log in"}</Link></Button></>)}
        {state === "error" && (<><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10"><XCircle className="h-7 w-7 text-destructive" /></span><p className="text-sm text-muted-foreground">{msg} The link may have expired or was already used.</p><p className="text-xs text-muted-foreground">Log in and use “Verify email” in Settings to get a new link.</p><Button asChild variant="outline" size="lg" className="w-full"><Link to={user ? "/app" : "/login"}>{user ? "Go to Flowbase" : "Log in"}</Link></Button></>)}
      </div>
    </AuthShell>
  );
}