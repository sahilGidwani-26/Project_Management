import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Project, ProjectStats, Task, WorkspaceMember } from "@/types";

/** URL wala current project + usme caller ka role. */
export function useProject() {
  const { workspaceId, projectId } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}`)).data.data as { project: Project; stats: ProjectStats },
    enabled: !!projectId,
  });
  const project = q.data?.project;
  const role = project?.myRole;
  return {
    workspaceId: workspaceId!,
    projectId: projectId!,
    project,
    stats: q.data?.stats,
    role,
    isLoading: q.isLoading,
    canEdit: role === "ADMIN" || role === "MEMBER",
    isAdmin: role === "ADMIN",
    refresh: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["project", projectId] }),
        qc.invalidateQueries({ queryKey: ["projects", workspaceId] }),
      ]),
  };
}

/** Kanban board wali hi query key, isliye cache shared rehta hai. */
export function useProjectTasks(projectId?: string) {
  return useQuery({
    queryKey: ["tasks", projectId],
    queryFn: async () => (await api.get(`/tasks?projectId=${projectId}&limit=200`)).data.data as Task[],
    enabled: !!projectId,
  });
}

export function useWorkspaceMembers(workspaceId?: string) {
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/members`)).data.data as WorkspaceMember[],
    enabled: !!workspaceId,
  });
}

/** GET /projects/:id/<path>, query key [key, projectId]. */
export function useProjectResource<T>(key: string, projectId?: string, path: string = key, refetchInterval?: number) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [key, projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}/${path}`)).data.data as T,
    enabled: !!projectId,
    refetchInterval,
  });
  return { ...q, reload: () => qc.invalidateQueries({ queryKey: [key, projectId] }) };
}