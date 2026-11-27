import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Eye, Globe, Info, Lock, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Shield, ShieldCheck, Sparkles, Trash2, Users, X } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { AccessRoleItem, PermCatalog, PermModule } from "@/types";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/hooks/useRoles";
import { NAV_ACCESS, PROJECT_TAB_ACCESS, ruleAllowed, setPerm } from "@/lib/accessMap";
import { groupModules } from "@/lib/permissionUi";
import { PageHeader } from "@/components/common/PageHeader";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { MemberAvatar } from "@/components/people/peopleUi";
import { ModuleNav } from "@/components/roles/ModuleNav";
import { ModulePanel, PermRow } from "@/components/roles/PermissionPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attempt } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";
import { WorkspaceMember } from "@/types";

const ROLE_COLORS = ["#7C3AED", "#2563EB", "#0F766E", "#16A34A", "#CA8A04", "#EA580C", "#DC2626", "#DB2777", "#475569", "#64748B"];

interface Draft { name: string; description: string; color: string; scope: "all" | "member"; perms: Set<string> }
const draftOf = (r: AccessRoleItem): Draft => ({ name: r.name, description: r.description, color: r.color, scope: r.scope, perms: new Set(r.permissions) });
type Tab = "perms" | "settings" | "preview";

export default function Roles() {
  const { workspaceId } = useParams();
  const w = workspaceId!;
  const qc = useQueryClient();
  const me = usePermissions();
  const canManage = me.can("roles.manage");
  const { roles, isLoading } = useRoles(w);

  const { data: catalog } = useQuery({
    queryKey: ["perm-catalog", w],
    queryFn: async () => (await api.get(`/workspaces/${w}/permissions/catalog`)).data.data as PermCatalog,
    enabled: !!w,
    staleTime: 5 * 60_000,
  });
  const { data: members } = useQuery({
    queryKey: ["members", w],
    queryFn: async () => (await api.get(`/workspaces/${w}/members`)).data.data as WorkspaceMember[],
    enabled: !!w && me.can("people.view"),
  });

  const modules = catalog?.modules || [];
  const groups = useMemo(() => groupModules(modules), [modules]);
  const requires = useMemo(() => new Map(modules.flatMap((m) => m.actions.map((a) => [a.perm, a.requires] as [string, string[]]))), [modules]);
  const labels = useMemo(() => new Map(modules.flatMap((m) => m.actions.map((a) => [a.perm, `${m.label}: ${a.label}`] as [string, string]))), [modules]);
  const labelOf = (p: string) => labels.get(p) || p;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Tab>("perms");
  const [modKey, setModKey] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFrom, setNewFrom] = useState("blank");

  const selected = roles?.find((r) => r._id === selectedId) || null;
  const current: PermModule | undefined = modules.find((m) => m.key === modKey) || groups[0]?.modules[0];

  useEffect(() => { if (roles && !selected) setSelectedId((roles.find((r) => r.isMine) || roles[0])?._id ?? null); }, [roles, selected]);
  const sig = selected ? JSON.stringify([selected._id, selected.name, selected.description, selected.color, selected.scope, selected.permissions]) : "";
  useEffect(() => { setDraft(selected ? draftOf(selected) : null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sig]);

  const dirty =
    !!selected && !!draft &&
    (draft.name !== selected.name || draft.description !== selected.description || draft.color !== selected.color || draft.scope !== selected.scope ||
      draft.perms.size !== selected.permissions.length || selected.permissions.some((p) => !draft.perms.has(p)));
  const editable = !!selected?.editable && canManage;
  const allowed = (p: string) => me.isOwner || me.perms.has(p);
  const canOf = (p: string) => !!draft?.perms.has(p);

  const pick = (id: string) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    setSelectedId(id);
  };

  const refreshAll = () => {
    ["roles", "my-permissions", "team-members", "members", "member"].forEach((k) => qc.invalidateQueries({ queryKey: [k, w] }));
  };

  /* ------------------------------ switching permissions ------------------------------ */

  const toggle = (perm: string, on: boolean) => {
    if (!draft || !editable) return;
    const next = setPerm(draft.perms, perm, on, requires);
    if (on) {
      const blocked = [...next].filter((p) => !draft.perms.has(p) && !allowed(p));
      if (blocked.length) return toast.error(`This also needs: ${blocked.map(labelOf).join(", ")}. You do not have that permission yourself.`);
    }
    const added = [...next].filter((p) => !draft.perms.has(p) && p !== perm);
    const removed = [...draft.perms].filter((p) => !next.has(p) && p !== perm);
    if (added.length) toast.info(`Also turned on: ${added.map(labelOf).join(", ")}`);
    if (removed.length) toast.info(`Also turned off: ${removed.map(labelOf).join(", ")}`);
    setDraft({ ...draft, perms: next });
  };

  const setModule = (m: PermModule, on: boolean) => {
    if (!draft || !editable) return;
    let next = draft.perms;
    for (const a of m.actions) {
      if (on && !allowed(a.perm)) continue;
      const tried = setPerm(next, a.perm, on, requires);
      if (on && [...tried].some((x) => !next.has(x) && !allowed(x))) continue;
      next = tried;
    }
    setDraft({ ...draft, perms: next });
  };

  const quick = (kind: "read" | "all" | "none") => {
    if (!draft || !editable) return;
    let next = new Set<string>();
    if (kind !== "none") {
      for (const m of modules) for (const a of m.actions) {
        if (allowed(a.perm) && (kind === "all" || a.key === "view")) next = setPerm(next, a.perm, true, requires);
      }
      next = new Set([...next].filter(allowed));
    }
    setDraft({ ...draft, perms: next });
  };

  /* ---------------------------------- actions ---------------------------------- */

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    const body: Record<string, unknown> = { description: draft.description, color: draft.color, scope: draft.scope, permissions: [...draft.perms] };
    if (!selected.isSystem) body.name = draft.name;
    if (await attempt(() => api.patch(`/workspaces/${w}/roles/${selected._id}`, body), "Role saved")) refreshAll();
    setBusy(false);
  };
  const reset = async () => {
    if (!selected || !window.confirm(`Reset “${selected.name}” to its default permissions?`)) return;
    if (await attempt(() => api.post(`/workspaces/${w}/roles/${selected._id}/reset`), "Role reset")) refreshAll();
  };
  const remove = async () => {
    if (!selected || !window.confirm(`Delete the role “${selected.name}”?`)) return;
    if (await attempt(() => api.delete(`/workspaces/${w}/roles/${selected._id}`), "Role deleted")) { setSelectedId(null); refreshAll(); }
  };
  const openNew = (from = "blank", name = "") => { setNewFrom(from); setNewName(name); setNewOpen(true); };
  const createRole = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/workspaces/${w}/roles`, { name: newName.trim(), ...(newFrom !== "blank" ? { cloneFrom: newFrom } : {}) });
      toast.success("Role created");
      setNewOpen(false);
      refreshAll();
      setSelectedId(res.data.data._id);
      setTab("perms");
    } catch (e) { toast.error(apiError(e)); }
    setBusy(false);
  };

  /* ----------------------------------- search ----------------------------------- */

  const q = search.trim().toLowerCase();
  const results = q
    ? modules.map((m) => ({ m, actions: m.actions.filter((a) => `${m.label} ${a.label} ${a.perm} ${m.description}`.toLowerCase().includes(q)) })).filter((r) => r.actions.length)
    : [];
  const rowProps = { perms: draft?.perms || new Set<string>(), editable, allowed, labelOf, onToggle: toggle };
  const people = (members || []).filter((m) => selected && m.roleRefId === selected._id);

  const note = !selected ? "" : selected.locked ? "The Owner role always has every permission and cannot be changed. This keeps the workspace from being locked out."
    : !canManage ? "You can look at roles but not change them."
    : !selected.editable ? "This role has permissions you do not have yourself, so you cannot change it." : "";

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        description="Pick a role, then switch on what it may do. What is switched off is hidden from that person."
        actions={canManage ? <Button size="sm" onClick={() => openNew()}><Plus className="h-4 w-4" /> New role</Button> : undefined}
      />

      <div className="grid gap-4 p-4 lg:h-[calc(100vh-11rem)] lg:min-h-[34rem] lg:grid-cols-[250px_1fr] md:p-6">
        {/* ------------------------------ roles ------------------------------ */}
        <aside className="flex min-h-0 gap-2 overflow-x-auto lg:flex-col lg:overflow-x-visible lg:overflow-y-auto">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {roles?.map((r) => {
            const on = r._id === selectedId;
            return (
              <button key={r._id} type="button" onClick={() => pick(r._id)} aria-current={on ? "true" : undefined}
                className={cn("flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors lg:w-full", on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50")}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${r.color}26`, color: r.color }}>
                  {r.locked ? <Lock className="h-4 w-4" /> : r.isSystem ? <Shield className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{r.name}</span>{r.isMine && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">You</Badge>}</span>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Users className="h-3 w-3" />{r.memberCount} · {r.permissions.length} permissions</span>
                </span>
              </button>
            );
          })}
        </aside>

        {/* ------------------------------ editor ------------------------------ */}
        {selected && draft ? (
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${draft.color}26`, color: draft.color }}><ShieldCheck className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold">{draft.name || selected.name}</h2>
                    <Badge variant="outline" className="text-[10px]">{selected.isSystem ? "Built-in" : "Custom"}</Badge>
                    {selected.locked && <Badge variant="secondary" className="gap-1 text-[10px]"><Lock className="h-3 w-3" />Locked</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{draft.perms.size} of {catalog?.total ?? "…"} permissions · {selected.memberCount} {selected.memberCount === 1 ? "person" : "people"} · {draft.scope === "all" ? "all projects" : "only their projects"}</p>
                </div>
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><MoreHorizontal className="h-4 w-4" /> Actions</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => openNew(selected._id, `${selected.name} copy`)}><Copy className="h-4 w-4" /> Clone this role</DropdownMenuItem>
                    {selected.isSystem && !selected.locked && editable && <DropdownMenuItem onClick={reset}><RotateCcw className="h-4 w-4" /> Reset to default</DropdownMenuItem>}
                    {!selected.isSystem && editable && (<><DropdownMenuSeparator /><DropdownMenuItem disabled={selected.memberCount > 0} onClick={remove} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4" /> {selected.memberCount > 0 ? "Delete (people use it)" : "Delete role"}</DropdownMenuItem></>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </header>

            <div className="flex gap-1 border-b border-border px-3 pt-2">
              {([["perms", "Permissions", ShieldCheck], ["settings", "Settings", Pencil], ["preview", "What they see", Eye]] as const).map(([k, l, Icon]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={cn("flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  <Icon className="h-4 w-4" />{l}
                </button>
              ))}
            </div>

            {note && <div className="flex items-start gap-2 border-b border-border bg-secondary/50 px-4 py-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{note}</div>}

            {/* ---- permissions ---- */}
            {tab === "perms" && (
              <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_1fr]">
                <div className="max-h-56 overflow-y-auto border-b border-border p-3 lg:max-h-none lg:border-b-0 lg:border-r">
                  <ModuleNav groups={groups} selected={current?.key || ""} dim={!!q} onSelect={(k) => { setModKey(k); setSearch(""); }} count={(m) => [m.actions.filter((a) => canOf(a.perm)).length, m.actions.length]} />
                </div>
                <div className="min-h-0 overflow-y-auto p-4">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[180px] flex-1">
                      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a permission (export, delete…)" className="pl-8 pr-8" />
                      {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
                    </div>
                    {editable && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Sparkles className="h-4 w-4" /> Quick set</Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onClick={() => quick("read")}><Eye className="h-4 w-4" /> Read only (all “View”)</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => quick("all")}><ShieldCheck className="h-4 w-4" /> Everything I may give</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => quick("none")}><X className="h-4 w-4" /> Switch everything off</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>

                  {q ? (
                    results.length ? (
                      <div className="space-y-5">
                        <p className="text-xs text-muted-foreground">{results.reduce((s, r) => s + r.actions.length, 0)} matching permissions</p>
                        {results.map((r) => <div key={r.m.key} className="space-y-2">{r.actions.map((a) => <PermRow key={a.perm} a={a} moduleLabel={r.m.label} {...rowProps} />)}</div>)}
                      </div>
                    ) : <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches “{search}”.</p>
                  ) : current ? (
                    <ModulePanel module={current} onAll={(on) => setModule(current, on)} {...rowProps} />
                  ) : <Skeleton className="h-64" />}
                </div>
              </div>
            )}

            {/* ---- settings ---- */}
            {tab === "settings" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="max-w-xl space-y-6">
                  <Field label="Role name">
                    <Input value={draft.name} disabled={!editable || selected.isSystem} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    {selected.isSystem && <p className="text-xs text-muted-foreground">Built-in roles keep their name. Clone the role to use a different name.</p>}
                  </Field>
                  <Field label="Description">
                    <Input value={draft.description} disabled={!editable} maxLength={200} placeholder="Who is this role for?" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </Field>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Colour</p>
                    <div className="flex flex-wrap gap-2">
                      {ROLE_COLORS.map((c) => <button key={c} type="button" aria-label={c} disabled={!editable} onClick={() => setDraft({ ...draft, color: c })} className={cn("h-7 w-7 rounded-full border-2 transition disabled:opacity-50", draft.color === c ? "scale-110 border-foreground" : "border-transparent")} style={{ background: c }} />)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">{draft.scope === "all" ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</span>
                      <div><p className="text-sm font-medium">Only projects they are a member of</p><p className="text-xs text-muted-foreground">{draft.scope === "all" ? "Off: they can see every project of the workspace (private ones stay private)." : "On: they never see projects they are not part of."}</p></div>
                    </div>
                    <Switch checked={draft.scope === "member"} disabled={!editable || (draft.scope === "member" && !me.isOwner && me.scope === "member")} onCheckedChange={(v) => setDraft({ ...draft, scope: v ? "member" : "all" })} aria-label="Only projects they are a member of" />
                  </div>

                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-sm font-medium"><Users className="h-4 w-4" /> People with this role ({selected.memberCount})</p>
                    {!me.can("people.view") ? <p className="text-xs text-muted-foreground">You do not have permission to see the people list.</p>
                      : !people.length ? <p className="text-xs text-muted-foreground">Nobody has this role yet. Give it to someone from their profile on the Team page.</p>
                      : <div className="flex flex-wrap gap-2">{people.map((m) => <span key={m._id} className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-xs"><MemberAvatar name={m.userId.name} image={m.userId.profileImage} className="h-6 w-6" />{m.userId.name}</span>)}</div>}
                  </div>
                </div>
              </div>
            )}

            {/* ---- preview ---- */}
            {tab === "preview" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
                  {([["Menu", NAV_ACCESS], ["Project tabs", PROJECT_TAB_ACCESS]] as const).map(([title, list]) => (
                    <div key={title} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((n) => {
                          const ok = ruleAllowed(n, canOf);
                          return <span key={n.to} className={cn("rounded-md px-2 py-1 text-xs", ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-secondary text-muted-foreground line-through")}>{n.label}</span>;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-5 max-w-xl text-xs text-muted-foreground">Green is what the person sees. Crossed out is hidden. Buttons such as Create, Edit and Delete appear only when their switch is on. This updates as you switch things, before you save.</p>
              </div>
            )}

            {dirty && (
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm"><Pencil className="h-4 w-4" /> You have unsaved changes</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(draftOf(selected))}>Discard</Button>
                  <Button size="sm" disabled={!editable || busy || draft.name.trim().length < 2} onClick={save}>Save changes</Button>
                </span>
              </footer>
            )}
          </section>
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-10 text-sm text-muted-foreground">{isLoading ? <Skeleton className="h-40 w-full" /> : "Choose a role to see what it can do."}</div>
        )}
      </div>

      <FormDialog open={newOpen} onOpenChange={setNewOpen} title="New role" onSubmit={createRole} busy={busy} disabled={newName.trim().length < 2} submitLabel="Create role">
        <Field label="Role name"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="QA Lead" maxLength={40} autoFocus /></Field>
        <Field label="Start from">
          <Select value={newFrom} onValueChange={setNewFrom}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="blank">Blank, everything off</SelectItem>
              {roles?.map((r) => <SelectItem key={r._id} value={r._id}>Copy of {r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <p className="text-xs text-muted-foreground">You can only give permissions you have yourself. After creating it, switch on what it needs and save.</p>
      </FormDialog>
    </div>
  );
}