import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissionContext } from "@/hooks/usePermissionsContext";
import { NAV_ACCESS } from "@/lib/accessMap";

/**
 * Shows its children only when the person has the permission(s).
 *   <Can perm="projects.create"><Button>New project</Button></Can>
 *   <Can any={["tasks.edit", "tasks.assign"]}>…</Can>
 *   <Can all={["a.b", "c.d"]} fallback={<p>No access</p>}>…</Can>
 */
export function Can({ perm, any, all, fallback = null, children }: { perm?: string; any?: string[]; all?: string[]; fallback?: ReactNode; children: ReactNode }) {
  const { can } = usePermissionContext();
  const ok = (perm ? can(perm) : true) && (any ? any.some(can) : true) && (all ? all.every(can) : true);
  return <>{ok ? children : fallback}</>;
}

export function NoAccess({ page, workspaceId, next }: { page?: string; workspaceId?: string; next?: string | null }) {
  const label = NAV_ACCESS.find((n) => n.to === next)?.label || (next === "settings" ? "Settings" : "");
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary"><Lock className="h-5 w-5 text-muted-foreground" /></div>
      <h2 className="text-lg font-semibold">You don't have access to {page ? `“${page}”` : "this page"}</h2>
      <p className="max-w-md text-sm text-muted-foreground">Your role does not include it. If you need it, ask a workspace admin to update your role.</p>
      {next && workspaceId && (
        <Button asChild variant="outline"><Link to={`/app/${workspaceId}/${next}`}>Go to {label}</Link></Button>
      )}
    </div>
  );
}