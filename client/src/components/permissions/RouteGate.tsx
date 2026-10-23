import { Navigate, useLocation, useParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissionContext } from "@/hooks/usePermissionsContext";
import { NoAccess } from "./permissionUi";
import { ROUTE_ACCESS, firstAllowed, ruleAllowed } from "@/lib/accessMap";

export function RouteGate({ children }: { children: React.ReactNode }) {
  const { workspaceId } = useParams();
  const { pathname } = useLocation();
  const { ready, can } = usePermissionContext();

  if (!ready) return <div className="p-6"><Skeleton className="h-40" /></div>;

  const parts = pathname.split("/").filter(Boolean); // ["app", workspaceId, "team", "me"]
  const seg = parts[2] || "";
  const rule = ROUTE_ACCESS[seg];
  const ownProfile = seg === "team" && parts[3] === "me"; // everybody may open their own profile

  if (rule && !ownProfile && !ruleAllowed(rule, can)) {
    const next = firstAllowed(can)?.to ?? "settings";
    // the dashboard is the landing page: send people somewhere they may go instead of an error
    if (seg === "dashboard") return <Navigate to={`/app/${workspaceId}/${next}`} replace />;
    return <NoAccess page={rule.label} workspaceId={workspaceId} next={next} />;
  }
  return <>{children}</>;
}