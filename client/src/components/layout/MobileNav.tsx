import { NavLink, useParams } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { NAV_ACCESS, ruleAllowed } from "@/lib/accessMap";
import { NAV_ICONS } from "./Sidebar";

export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspaceId } = useParams();
  const { can, ready } = usePermissions();
  if (!open) return null;

  const items = ready ? NAV_ACCESS.filter((n) => ruleAllowed(n, can)) : [];

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="absolute left-0 top-0 h-full w-64 bg-sidebar text-sidebar-foreground p-4">
        <div className="flex items-center justify-between mb-6">
          <span className="text-sm font-semibold">Menu</span>
          <button onClick={() => onOpenChange(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-0.5">
          {items.map((item) => {
            const Icon = NAV_ICONS[item.to];
            return (
              <NavLink
                key={item.to}
                to={`/app/${workspaceId}/${item.to}`}
                onClick={() => onOpenChange(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                    isActive ? "bg-primary text-primary-foreground" : "hover:bg-sidebar-accent"
                  )
                }
              >
                {Icon && <Icon className="h-4 w-4" />}
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}