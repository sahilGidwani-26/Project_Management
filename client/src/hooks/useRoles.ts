import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AccessRoleItem } from "@/types";
import { usePermissions } from "./usePermissions";

/** The workspace's roles (only requested when the person may view roles, so there are no needless 403 errors). */
export function useRoles(workspaceId?: string) {
  const { can, ready } = usePermissions();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["roles", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/roles`)).data.data as AccessRoleItem[],
    enabled: !!workspaceId && ready && can("roles.view"),
    staleTime: 15_000,
  });
  return { roles: q.data, isLoading: q.isLoading, reload: () => qc.invalidateQueries({ queryKey: ["roles", workspaceId] }) };
}