import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { WorkspaceRole } from "@/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/FormDialog";
import { CopyField } from "./peopleUi";
import { EMPLOYMENT, ROLE_INFO, assignableRoles, genPassword, passwordIssue, roleLabel } from "@/lib/people";
import { cn } from "@/lib/utils";

type Result =
  | { kind: "created"; email: string; password?: string; emailSent: boolean }
  | { kind: "existing"; email: string }
  | { kind: "invited"; email: string; link: string };

export function AddMemberDialog({
  open, onOpenChange, workspaceId, myRole, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  myRole?: WorkspaceRole;
  onDone: () => void;
}) {
  const roles = assignableRoles(myRole);
  const [mode, setMode] = useState<"create" | "invite">("create");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("MEMBER");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [send, setSend] = useState(true);
  const [more, setMore] = useState(false);
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [company, setCompany] = useState("");
  const [employmentType, setEmploymentType] = useState("none");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode("create"); setResult(null); setBusy(false);
    setEmail(""); setName(""); setRole("MEMBER"); setPassword(""); setShowPw(false); setSend(true); setMore(false);
    setDesignation(""); setDepartment(""); setCompany(""); setEmploymentType("none"); setPhone("");
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const clean = email.trim();

    if (mode === "invite") {
      setBusy(true);
      try {
        const res = await api.post(`/workspaces/${workspaceId}/invitations`, { email: clean, role });
        setResult({ kind: "invited", email: clean.toLowerCase(), link: res.data.data.inviteUrl });
        onDone();
      } catch (err) {
        toast.error(apiError(err));
      }
      setBusy(false);
      return;
    }

    const problem = password ? passwordIssue(password) : null;
    if (problem) return toast.error(problem);

    const profile: Record<string, string> = {};
    if (designation.trim()) profile.designation = designation.trim();
    if (department.trim()) profile.department = department.trim();
    if (company.trim()) profile.company = company.trim();
    if (employmentType !== "none") profile.employmentType = employmentType;

    setBusy(true);
    try {
      const res = await api.post(`/workspaces/${workspaceId}/members`, {
        email: clean, role, sendLoginDetails: send, profile,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { personal: { phone: phone.trim() } } : {}),
        ...(password ? { password } : {}),
      });
      const d = res.data.data;
      setResult(
        d.createdAccount
          ? { kind: "created", email: clean.toLowerCase(), password: password || d.temporaryPassword, emailSent: !!d.emailQueued }
          : { kind: "existing", email: clean.toLowerCase() }
      );
      onDone();
    } catch (err) {
      toast.error(apiError(err));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Add a member</DialogTitle></DialogHeader>

        {result ? (
          <div className="space-y-4">
            {result.kind === "created" && (
              <>
                <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">Account created for <b>{result.email}</b>.</p>
                <CopyField label="Login email" value={result.email} />
                {result.password && <CopyField label="Temporary password" value={result.password} secret />}
                <p className="text-xs text-muted-foreground">
                  {result.emailSent ? "The login details were emailed to them. " : "No email was sent (it was switched off, or email is not set up on the server), so share these details yourself. "}
                  They must choose a new password the first time they log in. This password is shown only now.
                </p>
              </>
            )}
            {result.kind === "existing" && (
              <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">
                <b>{result.email}</b> already had an account, so they were added to this workspace. Their password was not touched, and they got an email.
              </p>
            )}
            {result.kind === "invited" && (
              <>
                <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">Invitation created for <b>{result.email}</b> (valid for 7 days).</p>
                <CopyField label="Invitation link" value={result.link} />
                <p className="text-xs text-muted-foreground">An email was sent if email is set up. The link only works when they log in with <b>{result.email}</b>.</p>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setResult(null); setEmail(""); setName(""); setPassword(""); }}>Add another</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-1">
              {([["create", "Create account"], ["invite", "Invite by email"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setMode(v)} className={cn("rounded px-3 py-1.5 text-sm font-medium", mode === v ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "create"
                ? "You set up the account yourself. The person gets a temporary password and must change it at first login."
                : "They get an email with a link and create their own account (or log in) to join."}
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" className="sm:col-span-2">
                <Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
              </Field>

              {mode === "create" && (
                <Field label="Full name" className="sm:col-span-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Required for a new account" />
                </Field>
              )}

              <Field label="Role" className="sm:col-span-2">
                <Select value={role} onValueChange={(v) => setRole(v as WorkspaceRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_INFO[role]}</p>
              </Field>

              {mode === "create" && (
                <>
                  <Field label="Password" className="sm:col-span-2">
                    <div className="flex gap-2">
                      <Input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave empty to generate one" autoComplete="new-password" />
                      <Button type="button" variant="outline" size="sm" onClick={() => { setPassword(genPassword()); setShowPw(true); }}>Generate</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowPw((s) => !s)}>{showPw ? "Hide" : "Show"}</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">At least 8 characters with a letter and a number. It is temporary: they must replace it at first login.</p>
                  </Field>

                  <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> Email the login details to them
                  </label>

                  <button type="button" className="text-left text-xs text-primary hover:underline sm:col-span-2" onClick={() => setMore((m) => !m)}>
                    {more ? "Hide extra details" : "Add designation, department, company, phone (optional)"}
                  </button>
                  {more && (
                    <>
                      <Field label="Designation"><Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Product Designer" /></Field>
                      <Field label="Department"><Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Design" /></Field>
                      <Field label="Company / organization"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Corp" /></Field>
                      <Field label="Employment type">
                        <Select value={employmentType} onValueChange={setEmploymentType}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not set</SelectItem>
                            {EMPLOYMENT.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Phone" className="sm:col-span-2"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></Field>
                    </>
                  )}
                </>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !email.trim() || (mode === "create" && !name.trim() && false)}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "create" ? "Create account" : "Send invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}