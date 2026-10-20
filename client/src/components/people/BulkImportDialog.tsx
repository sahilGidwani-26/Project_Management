import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { BulkCheckRow, BulkResultRow } from "@/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseCsv, toCsv, downloadText } from "@/lib/csv";
import { roleLabel } from "@/lib/people";
import { cn } from "@/lib/utils";

type Row = Record<string, string>;
type Step = "input" | "preview" | "result";

const TEMPLATE = toCsv([
  ["email", "name", "role", "designation", "department", "company", "employment_type", "phone"],
  ["asha@example.com", "Asha Verma", "Member", "Product Designer", "Design", "Acme Corp", "full-time", "+91 98765 43210"],
  ["ravi@example.com", "Ravi Kumar", "Project Manager", "Delivery Lead", "Operations", "", "contractor", ""],
]);

const statusText: Record<BulkResultRow["status"], { label: string; cls: string }> = {
  created: { label: "Account created", cls: "text-emerald-600" },
  added: { label: "Existing user added", cls: "text-emerald-600" },
  invited: { label: "Invitation sent", cls: "text-emerald-600" },
  refreshed: { label: "Invitation refreshed", cls: "text-emerald-600" },
  failed: { label: "Failed", cls: "text-destructive" },
};

function toRows(text: string): Row[] {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("Add a header row and at least one person");
  const head = table[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const find = (names: string[]) => head.findIndex((h) => names.includes(h));
  const col = {
    email: find(["email", "emailaddress", "mail"]),
    name: find(["name", "fullname"]),
    role: find(["role"]),
    designation: find(["designation", "jobtitle", "title", "position"]),
    department: find(["department", "dept", "team"]),
    company: find(["company", "organization", "organisation"]),
    employmentType: find(["employmenttype", "type", "employment"]),
    phone: find(["phone", "mobile", "phonenumber"]),
  };
  if (col.email < 0) throw new Error("Could not find an “email” column in the header row");
  const get = (r: string[], i: number) => (i >= 0 ? r[i] || "" : "");
  const rows = table.slice(1).map((r) => ({
    email: get(r, col.email), name: get(r, col.name), role: get(r, col.role), designation: get(r, col.designation),
    department: get(r, col.department), company: get(r, col.company), employmentType: get(r, col.employmentType), phone: get(r, col.phone),
  }));
  if (rows.length > 100) throw new Error(`The file has ${rows.length} people. Import at most 100 at a time, split the file in parts`);
  return rows;
}

export function BulkImportDialog({ open, onOpenChange, workspaceId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; workspaceId: string; onDone: () => void }) {
  const [step, setStep] = useState<Step>("input");
  const [mode, setMode] = useState<"create" | "invite">("create");
  const [text, setText] = useState("");
  const [send, setSend] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [checks, setChecks] = useState<BulkCheckRow[]>([]);
  const [results, setResults] = useState<BulkResultRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [emailsSent, setEmailsSent] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const url = `/workspaces/${workspaceId}/members/bulk-import`;

  useEffect(() => {
    if (!open) return;
    setStep("input"); setMode("create"); setText(""); setSend(true); setRows([]); setChecks([]); setResults([]); setBusy(false);
  }, [open]);

  const check = async (parsed: Row[], m = mode) => {
    setBusy(true);
    try {
      const res = await api.post(url, { mode: m, rows: parsed, validateOnly: true });
      setChecks(res.data.data.checks);
      setRows(parsed);
      setStep("preview");
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  const next = async () => {
    try { await check(toRows(text)); } catch (e) { toast.error((e as Error).message); }
  };

  const readFile = (f?: File) => {
    if (!f) return;
    if (f.size > 1_000_000) return toast.error("That file is too large for a people list");
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ""));
    r.readAsText(f);
    if (file.current) file.current.value = "";
  };

  const runImport = async () => {
    const good = rows.filter((_, i) => checks[i]?.ok);
    setBusy(true);
    try {
      const res = await api.post(url, { mode, rows: good, sendLoginDetails: send });
      const d = res.data.data;
      // keep the original CSV line numbers (rows were filtered)
      const lines = checks.filter((c) => c.ok).map((c) => c.line);
      const out: BulkResultRow[] = [
        ...checks.filter((c) => !c.ok).map((c) => ({ line: c.line, email: c.email, name: c.name, status: "failed" as const, message: c.error })),
        ...(d.results as BulkResultRow[]).map((r, i) => ({ ...r, line: lines[i] ?? r.line })),
      ].sort((a, b) => a.line - b.line);
      setResults(out);
      setEmailsSent(!!d.emailsSent);
      setStep("result");
      onDone();
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  const okCount = checks.filter((c) => c.ok).length;
  const failCount = checks.length - okCount;
  const withPw = results.filter((r) => r.temporaryPassword);
  const done = results.filter((r) => r.status !== "failed").length;

  const downloadCreds = () => {
    if (!window.confirm("This file contains temporary passwords. Share them safely and delete the file afterwards. Download?")) return;
    downloadText("new-accounts.csv", toCsv([["Name", "Email", "Temporary password"], ...withPw.map((r) => [r.name || "", r.email, r.temporaryPassword || ""])], false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Import people from CSV</DialogTitle></DialogHeader>

        {step === "input" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-1">
              {([["create", "Create accounts"], ["invite", "Send invitations"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setMode(v)} className={cn("rounded px-3 py-1.5 text-sm font-medium", mode === v ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "create"
                ? "Each person gets an account with an auto-generated temporary password they must change at first login. Existing users are simply added, their password is never touched."
                : "Each person gets an invitation email and creates their own account. Extra columns (department, company…) are ignored for invitations."}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <input ref={file} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => readFile(e.target.files?.[0])} />
              <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}>Choose CSV file</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => downloadText("people-template.csv", TEMPLATE)}>Download template</Button>
              <span className="text-xs text-muted-foreground">Max 100 people. Columns: email, name, role, designation, department, company, employment_type, phone.</span>
            </div>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"or paste here:\nemail,name,role\nasha@example.com,Asha Verma,Member"} className="min-h-[180px] font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Roles: Owner, Admin, Project Manager, Member, Viewer (empty means Member). Passwords are never read from the file.</p>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={busy || !text.trim()} onClick={next}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Check file</Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <p className="text-sm">
              <b className="text-emerald-600">{okCount} ready</b>
              {failCount > 0 && <> · <b className="text-destructive">{failCount} with problems</b> (these will be skipped)</>}
            </p>
            <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary text-xs text-muted-foreground">
                  <tr>{["#", "Email", "Name", "Role", "Check"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {checks.map((c) => (
                    <tr key={c.line}>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.line}</td>
                      <td className="px-3 py-2">{c.email || "—"}</td>
                      <td className="px-3 py-2">{c.name || "—"}</td>
                      <td className="px-3 py-2 text-xs">{c.role ? roleLabel(c.role) : rows[c.line - 1]?.role || "—"}</td>
                      <td className={cn("px-3 py-2 text-xs", c.ok ? "text-emerald-600" : "text-destructive")}>{c.ok ? c.note || "Ready" : c.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mode === "create" && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} /> Email each new person their login details
              </label>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("input")}>Back</Button>
              <Button disabled={busy || okCount === 0} onClick={runImport}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Import {okCount} {okCount === 1 ? "person" : "people"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "result" && (
          <div className="space-y-4">
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm">
              Done: <b>{done}</b> of {results.length} imported{results.length - done > 0 ? `, ${results.length - done} failed` : ""}. You also got a summary email.
            </p>
            <div className="max-h-[40vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary text-xs text-muted-foreground">
                  <tr>{["#", "Email", "Result"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.map((r) => (
                    <tr key={r.line}>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.line}</td>
                      <td className="px-3 py-2">{r.email || "—"}</td>
                      <td className={cn("px-3 py-2 text-xs", statusText[r.status].cls)}>
                        {statusText[r.status].label}{r.status === "failed" && r.message ? `: ${r.message}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {withPw.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium">{withPw.length} new account(s) have temporary passwords</p>
                <p className="text-xs text-muted-foreground">
                  {emailsSent ? "They were also emailed to each person. " : "No emails were sent (they were switched off, or email is not set up on the server), so share the passwords yourself. "}
                  This is the only time they are shown. Each person must change theirs at first login.
                </p>
                <Button size="sm" variant="outline" onClick={downloadCreds}>Download credentials (CSV)</Button>
              </div>
            )}
            <DialogFooter><Button onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}