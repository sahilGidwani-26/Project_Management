import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordIssue } from "@/lib/people";

export default function ChangePassword() {
  const { user, refetchUser, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordIssue(next);
    if (problem) return toast.error(problem);
    if (next !== again) return toast.error("The two new passwords do not match");
    if (next === current) return toast.error("Choose a password that is different from the temporary one");

    setLoading(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      await refetchUser();
      toast.success("Password changed. Welcome!");
      navigate("/app", { replace: true });
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Workflow className="h-5 w-5" /></div>
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.name ? `Hi ${user.name.split(" ")[0]}, ` : ""}your admin gave you a temporary password. Enter it below, then pick your own.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cur">Temporary password</Label>
            <Input id="cur" type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">New password</Label>
            <Input id="new" type="password" required autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least 8 characters, with a letter and a number.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="again">Repeat new password</Label>
            <Input id="again" type="password" required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save password
          </Button>
        </form>

        <button type="button" onClick={logout} className="mt-4 w-full text-center text-xs text-muted-foreground hover:underline">Log out</button>
      </div>
    </div>
  );
}