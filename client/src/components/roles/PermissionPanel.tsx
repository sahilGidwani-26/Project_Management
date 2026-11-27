import { Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PermAction, PermModule } from "@/types";
import { MODULE_ICONS, actionIcon } from "@/lib/permissionUi";

interface Common {
  perms: Set<string>;
  editable: boolean;
  allowed: (perm: string) => boolean;
  labelOf: (perm: string) => string;
  onToggle: (perm: string, on: boolean) => void;
}

/** One permission: icon, name, and a switch. Clicking the name also flips the switch. */
export function PermRow({ a, perms, editable, allowed, labelOf, onToggle, moduleLabel }: Common & { a: PermAction; moduleLabel?: string }) {
  const Icon = actionIcon(a.key);
  const on = perms.has(a.perm);
  const lacks = !allowed(a.perm) && !on;
  const needs = a.requires.map(labelOf);
  const id = `perm-${a.perm}`;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors", on ? "border-primary/30 bg-primary/5" : "border-border hover:bg-secondary/40")}>
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}><Icon className="h-4 w-4" /></span>
      <label htmlFor={id} className={cn("min-w-0 flex-1", editable && !lacks ? "cursor-pointer" : "cursor-default")}>
        <span className="block truncate text-sm font-medium">{a.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {moduleLabel ? `${moduleLabel} · ` : ""}
          {lacks ? "You do not have this permission yourself, so you cannot give it" : needs.length ? `Needs: ${needs.join(", ")}` : "No other permission needed"}
        </span>
      </label>
      {lacks && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <Switch id={id} checked={on} disabled={!editable || lacks} onCheckedChange={(v) => onToggle(a.perm, v)} aria-label={a.label} />
    </div>
  );
}

/** The switches of one module, with a master switch on top. */
export function ModulePanel({ module: m, onAll, ...c }: Common & { module: PermModule; onAll: (on: boolean) => void }) {
  const Icon = MODULE_ICONS[m.key];
  const on = m.actions.filter((a) => c.perms.has(a.perm)).length;
  const all = on === m.actions.length;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>}
          <div className="min-w-0"><h3 className="font-semibold">{m.label}</h3><p className="text-xs text-muted-foreground">{m.description}</p></div>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-1.5">
          <span className="text-sm">Allow all</span>
          <span className="text-xs text-muted-foreground">{on}/{m.actions.length}</span>
          <Switch checked={all} disabled={!c.editable} onCheckedChange={onAll} aria-label={`Allow everything in ${m.label}`} />
        </div>
      </div>
      <div className="space-y-2">{m.actions.map((a) => <PermRow key={a.perm} a={a} {...c} />)}</div>
    </section>
  );
}