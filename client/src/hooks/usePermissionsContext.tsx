import { createContext, useContext, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MyPermissions, WorkspaceRole } from "@/types";

export interface PermissionCtx {
  /** false while the permissions are loading, pages wait for this so buttons do not flicker */
  ready: boolean;
  /** true when the permissions could not be loaded. The UI then stays open and the server still enforces everything */
  degraded: boolean;
  perms: Set<string>;
  isOwner: boolean;
  scope: "all" | "member";
  roleName: string;
  roleColor: string | null;
  roleKey: WorkspaceRole | null;
  legacyRole?: WorkspaceRole;
  can: (perm: string) => boolean;
  canAny: (...perms: string[]) => boolean;
  canAll: (...perms: string[]) => boolean;
  refetch: () => void;
}

const Ctx = createContext<PermissionCtx | null>(null);

// used outside the provider (should not happen inside the app): everything open, the server still decides
const OPEN: PermissionCtx = {
  ready: true, degraded: true, perms: new Set(), isOwner: false, scope: "all", roleName: "", roleColor: null, roleKey: null,
  can: () => true, canAny: () => true, canAll: () => true, refetch: () => undefined,
};

export function usePermissionContext() {
  return useContext(Ctx) ?? OPEN;
}

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const { workspaceId } = useParams();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-permissions", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/permissions/me`)).data.data as MyPermissions,
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    staleTime: 20_000,
    retry: 1,
  });

  const value = useMemo<PermissionCtx>(() => {
    const perms = new Set(data?.permissions ?? []);
    const degraded = isError && !data;
    const can = (p: string) => degraded || perms.has(p);
    return {
      ready: !isLoading,
      degraded,
      perms,
      isOwner: !!data?.role.isOwner,
      scope: data?.scope ?? "all",
      roleName: data?.role.name ?? "",
      roleColor: data?.role.color ?? null,
      roleKey: data?.role.key ?? null,
      legacyRole: data?.legacyRole,
      can,
      canAny: (...p) => p.some(can),
      canAll: (...p) => p.every(can),
      refetch: () => qc.invalidateQueries({ queryKey: ["my-permissions", workspaceId] }),
    };
  }, [data, isLoading, isError, qc, workspaceId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}