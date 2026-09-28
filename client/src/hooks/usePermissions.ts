import { useWorkspace } from "./useWorkspace";
import { WorkspaceRole } from "@/types";

const MANAGERS: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER"];
const NOT_VIEWER: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER"];

/**
 * Mirrors the backend's role checks so the UI can hide/disable actions the
 * user isn't allowed to take. This is a UX convenience only — the backend
 * is the real enforcement point (frontend checks alone are never enough).
 */
export function usePermissions() {
  const { currentWorkspace } = useWorkspace();
  const role = currentWorkspace?.myRole;

  return {
    role,
    isViewer: role === "VIEWER",
    canCreateProject: !!role && MANAGERS.includes(role),
    canEditProject: !!role && MANAGERS.includes(role),
    canDeleteProject: role === "OWNER" || role === "ADMIN",
    canCreateTask: !!role && NOT_VIEWER.includes(role),
    canEditTask: !!role && NOT_VIEWER.includes(role),
    canDeleteTask: !!role && MANAGERS.includes(role),
    canComment: !!role && NOT_VIEWER.includes(role),
    canManageMembers: role === "OWNER" || role === "ADMIN",
  };
}
