import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, Workflow } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export default function AcceptInvite() {
  const { token } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) return; // wait for login prompt below

    (async () => {
      try {
        const res = await api.post(`/workspaces/invitations/${token}/accept`);
        setWorkspaceId(res.data.data.workspaceId);
        setStatus("success");
      } catch (err) {
        setMessage(apiError(err));
        setStatus("error");
      }
    })();
  }, [token, user, loading]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Workflow className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-semibold">Log in to accept this invitation</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Log in or create an account with the email address this invite was sent to, then come back to this link.
        </p>
        <div className="flex gap-2">
          <Button asChild><Link to={`/login?redirect=/invitations/${token}`}>Log in</Link></Button>
          <Button variant="outline" asChild><Link to={`/register?redirect=/invitations/${token}`}>Sign up</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      {status === "pending" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
      {status === "success" && (
        <>
          <CheckCircle2 className="h-10 w-10 text-success" />
          <h1 className="text-xl font-semibold">You're in!</h1>
          <p className="text-sm text-muted-foreground">You've joined the workspace successfully.</p>
          <Button onClick={() => navigate(`/app/${workspaceId}/dashboard`)}>Go to workspace</Button>
        </>
      )}
      {status === "error" && (
        <>
          <XCircle className="h-10 w-10 text-destructive" />
          <h1 className="text-xl font-semibold">Couldn't accept invitation</h1>
          <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
          <Button variant="outline" onClick={() => navigate("/app")}>Go to app</Button>
        </>
      )}
    </div>
  );
}
