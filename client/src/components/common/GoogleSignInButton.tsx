import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

declare global {
  interface Window {
    google?: any;
  }
}

/**
 * Renders Google's own "Sign in with Google" button via Google Identity
 * Services. On success, sends the verified ID token to the backend, which
 * checks it against Google before creating a session — same flow as
 * email/password, just a different entry point.
 */
export function GoogleSignInButton({ label = "signin_with" }: { label?: "signin_with" | "signup_with" }) {
  const ref = useRef<HTMLDivElement>(null);
  const { refetchUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setUnavailable(true);
      return;
    }

    const handleCredential = async (response: { credential: string }) => {
      try {
        const res = await api.post("/auth/google", { idToken: response.credential });
        localStorage.setItem("pm_token", res.data.data.token);
        await refetchUser();
        navigate(params.get("redirect") || "/app");
      } catch (err) {
        toast.error(apiError(err));
      }
    };

    let cancelled = false;
    const tryInit = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        setTimeout(tryInit, 200); // script still loading
        return;
      }
      window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential });
      if (ref.current) {
        window.google.accounts.id.renderButton(ref.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: label,
        });
      }
    };
    tryInit();

    return () => {
      cancelled = true;
    };
  }, [label, navigate, params, refetchUser]);

  if (unavailable) return null; // no client ID configured — quietly hide, email/password still works

  return <div ref={ref} className="flex justify-center" />;
}
