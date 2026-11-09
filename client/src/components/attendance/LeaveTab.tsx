import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { LeaveBalance, LeaveRequestItem, LeaveTypeItem } from "@/types";
import { usePermissions } from "@/hooks/usePermissions";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attempt } from "@/lib/projectMeta";
import { dayKey, fmtDate } from "@/lib/attendance";
import { cn, formatDate } from "@/lib/utils";
import { PersonCell } from "./attendanceUi";

const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  cancelled: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};
const HALF: Record<string, string> = { none: "Full day", first: "First half", second: "Second half" };
const range = (r: LeaveRequestItem) => (r.from === r.to ? fmtDate(r.from, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : `${fmtDate(r.from)} to ${fmtDate(r.to, { day: "numeric", month: "short", year: "numeric" })}`);

/* ------------------------------ request dialog ------------------------------ */

function RequestDialog({
  open, onOpenChange, workspaceId, types, balances, today, onDone,
}: { open: boolean; onOpenChange: (v: boolean) => void; workspaceId: string; types: LeaveTypeItem[]; balances: LeaveBalance[]; today: string; onDone: () => void }) {
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [half, setHalf] = useState("none");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const type = types.find((t) => t._id === (typeId || types[0]?._id));
  const bal = balances.find((b) => b.typeId === type?._id);
  const single = !!from && from === to;

  const submit = async () => {
    if (!type) return;
    setBusy(true);
    try {
      await api.post(`/attendance/workspace/${workspaceId}/leave/requests`, { typeId: type._id, from, to, half: single ? half : "none", reason: reason.trim() });
      toast.success("Leave requested. Your approvers were emailed.");
      setFrom(""); setTo(""); setReason(""); setHalf("none");
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Request leave" onSubmit={submit} busy={busy} submitLabel="Send request" disabled={!type || !from || !to || reason.trim().length < 3}>
      <Field label="Leave type">
        <Select value={type?._id || ""} onValueChange={setTypeId}>
          <SelectTrigger><SelectValue placeholder="Choose a type" /></SelectTrigger>
          <SelectContent>
            {types.map((t) => <SelectItem key={t._id} value={t._id}><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name}{t.paid ? "" : " (unpaid)"}</span></SelectItem>)}
          </SelectContent>
        </Select>
        {bal && <p className="text-xs text-muted-foreground">{bal.quota > 0 ? `${bal.remaining} day(s) left of ${bal.quota} this year` : "No yearly limit"}</p>}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From"><Input type="date" value={from} min={today} onChange={(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value); }} /></Field>
        <Field label="To"><Input type="date" value={to} min={from || today} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {single && (
        <Field label="Day part">
          <Select value={half} onValueChange={setHalf}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(HALF).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      )}
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Family function, not feeling well…" /></Field>
      <p className="text-xs text-muted-foreground">Only working days are counted. Holidays and week-offs inside your dates are skipped automatically.</p>
    </FormDialog>
  );
}

function DeclineDialog({ req, workspaceId, onClose, onDone }: { req: LeaveRequestItem | null; workspaceId: string; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!req) return null;
  const submit = async () => {
    setBusy(true);
    const ok = await attempt(() => api.post(`/attendance/workspace/${workspaceId}/leave/requests/${req._id}/review`, { decision: "reject", note: note.trim() }), "Leave declined. The person was emailed.");
    setBusy(false);
    if (ok) { setNote(""); onDone(); onClose(); }
  };
  return (
    <FormDialog open onOpenChange={(v) => !v && onClose()} title={`Decline ${req.user?.name || "this"} leave`} onSubmit={submit} busy={busy} submitLabel="Decline" disabled={note.trim().length < 3}>
      <p className="text-sm text-muted-foreground">{req.type?.name} · {range(req)} · {req.days} day(s)</p>
      <Field label="Reason (the person will see it)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoFocus /></Field>
    </FormDialog>
  );
}

/* ---------------------------------- tab ---------------------------------- */

export function LeaveTab({ workspaceId, tz }: { workspaceId: string; tz: string }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const approver = can("leave.approve");
  const [open, setOpen] = useState(false);
  const [decline, setDecline] = useState<LeaveRequestItem | null>(null);
  const [filter, setFilter] = useState("pending");
  const today = dayKey(Date.now(), tz);
  const base = `/attendance/workspace/${workspaceId}/leave`;

  const { data: bal } = useQuery({ queryKey: ["leave-balance", workspaceId], queryFn: async () => (await api.get(`${base}/balance`)).data.data as { year: number; balances: LeaveBalance[] } });
  const { data: types } = useQuery({ queryKey: ["leave-types", workspaceId], queryFn: async () => (await api.get(`${base}/types`)).data.data as LeaveTypeItem[] });
  const { data: mine, isLoading } = useQuery({ queryKey: ["leave-mine", workspaceId], queryFn: async () => (await api.get(`${base}/requests`)).data.data as { items: LeaveRequestItem[] } });
  const { data: all } = useQuery({
    queryKey: ["leave-all", workspaceId, filter],
    queryFn: async () => (await api.get(`${base}/requests?scope=all${filter === "all" ? "" : `&status=${filter}`}`)).data.data as { items: LeaveRequestItem[]; pending: number },
    enabled: approver,
  });

  const refresh = () => ["leave-balance", "leave-mine", "leave-all", "att-me", "att-team", "att-live", "att-matrix"].forEach((k) => qc.invalidateQueries({ queryKey: [k, workspaceId] }));
  const review = async (r: LeaveRequestItem) => { if (await attempt(() => api.post(`${base}/requests/${r._id}/review`, { decision: "approve" }), "Leave approved. The person was emailed.")) refresh(); };
  const cancel = async (r: LeaveRequestItem) => { if (window.confirm("Cancel this leave?") && (await attempt(() => api.post(`${base}/requests/${r._id}/cancel`), "Leave cancelled"))) refresh(); };

  const active = (types || []).filter((t) => t.active);
  const canCancel = (r: LeaveRequestItem) => r.status === "pending" || (r.status === "approved" && (approver || r.from > today));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold">My leave</h3><p className="text-xs text-muted-foreground">Balance for {bal?.year ?? "this year"}</p></div>
        {can("leave.request") && <Button size="sm" onClick={() => setOpen(true)} disabled={!active.length}><Plus className="h-4 w-4" /> Request leave</Button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!bal && <Skeleton className="h-24" />}
        {bal?.balances.map((b) => (
          <Card key={b.typeId}><CardContent className="space-y-2 p-4">
            <p className="flex items-center gap-2 text-sm font-medium"><span className="h-2 w-2 rounded-full" style={{ background: b.color }} />{b.name}</p>
            <p className="text-2xl font-semibold">{b.quota > 0 ? b.remaining : b.used}<span className="ml-1 text-xs font-normal text-muted-foreground">{b.quota > 0 ? `left of ${b.quota}` : "used (no limit)"}</span></p>
            {b.quota > 0 && <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full" style={{ width: `${Math.min(100, ((b.used + b.pending) / b.quota) * 100)}%`, background: b.color }} /></div>}
            <p className="text-[11px] text-muted-foreground">{b.used} used{b.pending ? ` · ${b.pending} pending` : ""}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card><CardContent className="space-y-2 p-5">
        <h3 className="font-medium">My requests</h3>
        {isLoading && <Skeleton className="h-20" />}
        {mine && !mine.items.length && <p className="text-sm text-muted-foreground">You have not requested any leave yet.</p>}
        <div className="divide-y divide-border">
          {mine?.items.map((r) => (
            <div key={r._id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="h-2 w-2 rounded-full" style={{ background: r.type?.color }} />{r.type?.name} · {range(r)}
                  <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium capitalize", STATUS_CLS[r.status])}>{r.status}</span>
                </p>
                <p className="text-xs text-muted-foreground">{r.days} day(s){r.half !== "none" ? ` · ${HALF[r.half]}` : ""} · {r.reason}</p>
                {r.reviewNote && <p className="text-xs text-muted-foreground">{r.reviewedBy?.name || "Reviewer"}: “{r.reviewNote}”</p>}
              </div>
              {canCancel(r) && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(r)}>Cancel</Button>}
            </div>
          ))}
        </div>
      </CardContent></Card>

      {approver && (
        <Card><CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Team requests {!!all?.pending && <span className="ml-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">{all.pending} waiting</span>}</h3>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{[["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Declined"], ["all", "All"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {all && !all.items.length && <p className="text-sm text-muted-foreground">Nothing here.</p>}
          <div className="divide-y divide-border">
            {all?.items.map((r) => (
              <div key={r._id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="space-y-1">
                  {r.user && <PersonCell p={r.user} />}
                  <p className="flex flex-wrap items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: r.type?.color }} />{r.type?.name} · {range(r)} · {r.days} day(s)
                    <span className={cn("rounded-md px-2 py-0.5 font-medium capitalize", STATUS_CLS[r.status])}>{r.status}</span></p>
                  <p className="text-xs text-muted-foreground">“{r.reason}” · requested {formatDate(r.createdAt)}</p>
                </div>
                <div className="flex gap-2">
                  {r.status === "pending" && <Button size="sm" onClick={() => review(r)}><Check className="h-3.5 w-3.5" /> Approve</Button>}
                  {r.status === "pending" && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDecline(r)}><X className="h-3.5 w-3.5" /> Decline</Button>}
                  {r.status === "approved" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(r)}>Revoke</Button>}
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      <RequestDialog open={open} onOpenChange={setOpen} workspaceId={workspaceId} types={active} balances={bal?.balances || []} today={today} onDone={refresh} />
      <DeclineDialog req={decline} workspaceId={workspaceId} onClose={() => setDecline(null)} onDone={refresh} />
    </div>
  );
}