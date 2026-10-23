import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiError } from "@/lib/api";
import { AccessRoleItem, PermCatalog } from "@/types";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/hooks/useRoles";
import { NAV_ACCESS, PROJECT_TAB_ACCESS, ruleAllowed, setPerm } from "@/lib/accessMap";
import { PageHeader } from "@/components/common/PageHeader";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attempt } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";

const ROLE_COLORS = ["#7C3AED", "#2563EB", "#0F766E", "#16A34A", "#CA8A04", "#EA580C", "#DC2626", "#DB2777", "#475569", "#64748B"];

interface Draft { name: string; description: string; color: string; scope: "all" | "member"; perms: Set<string> }

const draftOf = (r: AccessRoleItem): Draft => ({ name: r.name, description: r.description, color: r.color, scope: r.scope, perms: new Set(r.permissions) });

export default function Roles() {
  const { workspaceId } = useParams();
  const qc = useQueryClient();
  const me = usePermissions();
  const canManage = me.can("roles.manage");
  const { roles, isLoading } = useRoles(workspaceId);

  const { data: catalog } = useQuery({
    queryKey: ["perm-catalog", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/permissions/catalog`)).data.data as PermCatalog,
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
  });
  const requires = useMemo(() => new Map((catalog?.modules || []).flatMap((m) => m.actions.map((a) => [a.perm, a.requires] as [string, string[]]))), [catalog]);
  const labelOf = useMemo(() => new Map((catalog?.modules || []).flatMap((m) => m.actions.map((a) => [a.perm, `${m.label}: ${a.label}`] as [string, string]))), [catalog]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFrom, setNewFrom] = useState("blank");

  const selected = roles?.find((r) => r._id === selectedId) || null;

  useEffect(() => {
    if (roles && !selected) setSelectedId((roles.find((r) => r.isMine) || roles[0])?._id ?? null);
  }, [roles, selected]);

  // load the saved role into the editor whenever it changes
  const sig = selected ? JSON.stringify([selected._id, selected.name, selected.description, selected.color, selected.scope, selected.permissions]) : "";
  useEffect(() => {
    setDraft(selected ? draftOf(selected) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const dirty =
    !!selected && !!draft &&
    (draft.name !== selected.name || draft.description !== selected.description || draft.color !== selected.color || draft.scope !== selected.scope ||
      draft.perms.size !== selected.permissions.length || selected.permissions.some((p) => !draft.perms.has(p)));
  const editable = !!selected?.editable && canManage;
  const allowedPerm = (p: string) => me.isOwner || me.perms.has(p);

  const pick = (id: string) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    setSelectedId(id);
  };

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["roles", workspaceId] });
    qc.invalidateQueries({ queryKey: ["my-permissions", workspaceId] });
    qc.invalidateQueries({ queryKey: ["team-members", workspaceId] });
    qc.invalidateQueries({ queryKey: ["members", workspaceId] });
    qc.invalidateQueries({ queryKey: ["member", workspaceId] });
  };

  const toggle = (perm: string, on: boolean) => {
    if (!draft || !editable) return;
    const next = setPerm(draft.perms, perm, on, requires);
    if (on) {
      const blocked = [...next].filter((p) => !draft.perms.has(p) && !allowedPerm(p));
      if (blocked.length) return toast.error(`This also needs: ${blocked.map((p) => labelOf.get(p) || p).join(", ")}. You do not have that permission yourself.`);
    }
    setDraft({ ...draft, perms: next });
  };

  const setModule = (perms: string[], on: boolean) => {
    if (!draft || !editable) return;
    let next = draft.perms;
    for (const p of perms) {
      if (on && !allowedPerm(p)) continue;
      const tried = setPerm(next, p, on, requires);
      if (on && [...tried].some((x) => !next.has(x) && !allowedPerm(x))) continue;
      next = tried;
    }
    setDraft({ ...draft, perms: next });
  };

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    const body: Record<string, unknown> = { description: draft.description, color: draft.color, scope: draft.scope, permissions: [...draft.perms] };
    if (!selected.isSystem) body.name = draft.name;
    const ok = await attempt(() => api.patch(`/workspaces/${workspaceId}/roles/${selected._id}`, body), "Role saved");
    setBusy(false);
    if (ok) refreshAll();
  };

  const reset = async () => {
    if (!selected || !window.confirm(`Reset “${selected.name}” to its default permissions?`)) return;
    if (await attempt(() => api.post(`/workspaces/${workspaceId}/roles/${selected._id}/reset`), "Role reset")) refreshAll();
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete the role “${selected.name}”?`)) return;
    if (await attempt(() => api.delete(`/workspaces/${workspaceId}/roles/${selected._id}`), "Role deleted")) { setSelectedId(null); refreshAll(); }
  };

  const openNew = (from = "blank", name = "") => { setNewFrom(from); setNewName(name); setNewOpen(true); };
  const createRole = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/workspaces/${workspaceId}/roles`, { name: newName.trim(), ...(newFrom !== "blank" ? { cloneFrom: newFrom } : {}) });
      toast.success("Role created");
      setNewOpen(false);
      refreshAll();
      setSelectedId(res.data.data._id);
    } catch (e) {
      toast.error(apiError(e));
    }
    setBusy(false);
  };

  const q = search.trim().toLowerCase();
  const modules = (catalog?.modules || []).filter((m) => !q || m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.actions.some((a) => a.label.toLowerCase().includes(q)));
  const canOf = (p: string) => !!draft?.perms.has(p);

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="Decide exactly what each role can see and do. What is not ticked is hidden from that person."
        actions={canManage ? <Button size="sm" onClick={() => openNew()}>New role</Button> : undefined}
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[280px_1fr]">
        {/* ---------------- list ---------------- */}
        <div className="space-y-2">
          {isLoading && <Skeleton className="h-48" />}
          {roles?.map((r) => (
            <button key={r._id} type="button" onClick={() => pick(r._id)} className={cn("w-full rounded-lg border px-3 py-2.5 text-left transition-colors", r._id === selectedId ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40")}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="flex-1 truncate text-sm font-medium">{r.name}</span>
                {r.locked && <span title="Always has every permission">🔒</span>}
                {r.isMine && <Badge variant="secondary" className="text-[10px]">You</Badge>}
              </div>
              <p className="mt-0.5 pl-[18px] text-xs text-muted-foreground">
                {r.isSystem ? "Built-in" : "Custom"} · {r.memberCount} {r.memberCount === 1 ? "person" : "people"} · {r.permissions.length} permissions
              </p>
            </button>
          ))}
        </div>

        {/* ---------------- editor ---------------- */}
        {selected && draft && (
          <div className="min-w-0 space-y-4">
            {selected.locked && <p className="rounded-md bg-violet-500/10 px-3 py-2 text-sm">The <b>Owner</b> role always has every permission and cannot be changed. This protects the workspace from being locked out.</p>}
            {!selected.locked && !canManage && <p className="rounded-md bg-secondary px-3 py-2 text-sm">You can view roles but not change them.</p>}
            {!selected.locked && canManage && !selected.editable && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">This role has permissions you do not have yourself, so you cannot change it.</p>}

            <Card><CardContent className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Role name">
                  <Input value={draft.name} disabled={!editable || selected.isSystem} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  {selected.isSystem && <p className="text-xs text-muted-foreground">Built-in roles keep their name. Create a new role if you want a different name.</p>}
                </Field>
                <Field label="Which projects can they see?">
                  <Select value={draft.scope} disabled={!editable} onValueChange={(v) => setDraft({ ...draft, scope: v as "all" | "member" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" disabled={!me.isOwner && me.scope === "member"}>All projects of the workspace</SelectItem>
                      <SelectItem value="member">Only projects they are a member of</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <Input value={draft.description} disabled={!editable} maxLength={200} placeholder="Who is this role for?" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </Field>
                <Field label="Color" className="sm:col-span-2">
                  <div className="flex flex-wrap gap-2">
                    {ROLE_COLORS.map((c) => (
                      <button key={c} type="button" disabled={!editable} onClick={() => setDraft({ ...draft, color: c })} aria-label={c} className={cn("h-6 w-6 rounded-full border-2 disabled:opacity-50", draft.color === c ? "border-foreground" : "border-transparent")} style={{ background: c }} />
                    ))}
                  </div>
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">{draft.perms.size} of {catalog?.total ?? "…"} permissions · {selected.memberCount} {selected.memberCount === 1 ? "person has" : "people have"} this role</p>
                <div className="flex flex-wrap gap-2">
                  {canManage && <Button size="sm" variant="outline" onClick={() => openNew(selected._id, `${selected.name} copy`)}>Clone</Button>}
                  {canManage && selected.isSystem && !selected.locked && editable && <Button size="sm" variant="outline" onClick={reset}>Reset to default</Button>}
                  {canManage && !selected.isSystem && editable && (
                    <Button size="sm" variant="outline" className="text-destructive" disabled={selected.memberCount > 0} title={selected.memberCount > 0 ? "Give these people another role first" : undefined} onClick={remove}>Delete</Button>
                  )}
                  {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(draftOf(selected))}>Discard</Button>}
                  <Button size="sm" disabled={!editable || !dirty || busy || draft.name.trim().length < 2} onClick={save}>Save changes</Button>
                </div>
              </div>
            </CardContent></Card>

            {/* permissions */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Permissions</h3>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search (e.g. export, delete)…" className="max-w-xs" />
            </div>
            {!modules.length && <p className="text-sm text-muted-foreground">Nothing matches “{search}”.</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {modules.map((m) => {
                const on = m.actions.filter((a) => canOf(a.perm)).length;
                return (
                  <Card key={m.key}><CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{m.label} <span className="text-xs font-normal text-muted-foreground">{on}/{m.actions.length}</span></p>
                        <p className="text-xs text-muted-foreground">{m.description}</p>
                      </div>
                      {editable && (
                        <div className="flex shrink-0 gap-1 text-xs">
                          <button type="button" className="text-primary hover:underline" onClick={() => setModule(m.actions.map((a) => a.perm), true)}>All</button>
                          <span className="text-muted-foreground">/</span>
                          <button type="button" className="text-muted-foreground hover:underline" onClick={() => setModule(m.actions.map((a) => a.perm), false)}>None</button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      {m.actions.map((a) => {
                        const checked = canOf(a.perm);
                        const lacks = !allowedPerm(a.perm);
                        const needs = a.requires.map((r) => labelOf.get(r) || r);
                        return (
                          <label
                            key={a.perm}
                            title={lacks && !checked ? "You do not have this permission yourself, so you cannot give it" : needs.length ? `Needs: ${needs.join(", ")}` : undefined}
                            className={cn("flex items-center gap-2 rounded px-1.5 py-1 text-sm", editable && !(lacks && !checked) ? "cursor-pointer hover:bg-secondary/50" : "cursor-not-allowed opacity-70")}
                          >
                            <input type="checkbox" checked={checked} disabled={!editable || (lacks && !checked)} onChange={(e) => toggle(a.perm, e.target.checked)} />
                            {a.label}
                          </label>
                        );
                      })}
                    </div>
                  </CardContent></Card>
                );
              })}
            </div>

            {/* preview */}
            <Card><CardContent className="space-y-3 p-5">
              <h3 className="font-medium">What will this role see?</h3>
              <p className="text-xs text-muted-foreground">Updates as you tick boxes, before you save.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Menu</p>
                  <div className="flex flex-wrap gap-1.5">
                    {NAV_ACCESS.map((n) => {
                      const ok = ruleAllowed(n, canOf);
                      return <span key={n.to} className={cn("rounded-md px-2 py-0.5 text-xs", ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground line-through")}>{n.label}</span>;
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Project tabs</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PROJECT_TAB_ACCESS.map((n) => {
                      const ok = ruleAllowed(n, canOf);
                      return <span key={n.to} className={cn("rounded-md px-2 py-0.5 text-xs", ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground line-through")}>{n.label}</span>;
                    })}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Buttons such as Create, Edit and Delete appear only when their box is ticked. Green = visible, crossed out = hidden.</p>
            </CardContent></Card>
          </div>
        )}
      </div>

      <FormDialog open={newOpen} onOpenChange={setNewOpen} title="New role" onSubmit={createRole} busy={busy} disabled={newName.trim().length < 2} submitLabel="Create role">
        <Field label="Role name"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="QA Lead" maxLength={40} autoFocus /></Field>
        <Field label="Start from">
          <Select value={newFrom} onValueChange={setNewFrom}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="blank">Blank, nothing ticked</SelectItem>
              {roles?.map((r) => <SelectItem key={r._id} value={r._id}>Copy of {r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">You can only give permissions you have yourself. After creating it, tick the permissions and save.</p>
      </FormDialog>
    </div>
  );
}