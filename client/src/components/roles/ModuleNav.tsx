import { cn } from "@/lib/utils";
import type { PermModule } from "@/types";
import { MODULE_ICONS, type ModuleGroup } from "@/lib/permissionUi";

/** The list of modules, in groups. Each one shows how many of its permissions are on. */
export function ModuleNav({ groups, selected, onSelect, count, dim }: {
  groups: ModuleGroup[]; selected: string; onSelect: (key: string) => void; count: (m: PermModule) => [number, number]; dim?: boolean;
}) {
  return (
    <nav aria-label="Modules" className={cn("flex flex-wrap gap-1.5 lg:block lg:space-y-5", dim && "opacity-50")}>
      {groups.map((g) => (
        <div key={g.key} className="contents lg:block">
          <p className="mb-1.5 hidden items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:flex"><g.icon className="h-3.5 w-3.5" />{g.label}</p>
          <div className="contents lg:block lg:space-y-0.5">
            {g.modules.map((m) => {
              const Icon = MODULE_ICONS[m.key] || g.icon;
              const [on, total] = count(m);
              const full = on === total && total > 0;
              const active = selected === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => onSelect(m.key)}
                  aria-current={active ? "true" : undefined}
                  className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors lg:w-full", active ? "bg-primary/10 font-medium text-primary" : "hover:bg-secondary")}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{m.label}</span>
                  <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums", full ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : on ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>{on}/{total}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}