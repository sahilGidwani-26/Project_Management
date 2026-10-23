import { usePermissionContext } from "./usePermissionsContext";

/**
 * Mirrors the backend so the UI can hide what the logged-in person is not allowed to do.
 * This is a UX convenience only. The backend is the real enforcement point.
 *
 * New code: use can("projects.create") / canAny(...) or <Can perm="...">.
 * The old names below keep working and now follow the person's real role.
 */
export function usePermissions() {
  const ctx = usePermissionContext();
  const { can } = ctx;

  return {
    ...ctx,
    role: ctx.legacyRole,
    isViewer: !can("tasks.create") && !can("tasks.edit"),
    canCreateProject: can("projects.create"),
    canEditProject: can("projects.edit"),
    canDeleteProject: can("projects.delete"),
    canCreateTask: can("tasks.create"),
    canEditTask: can("tasks.edit"),
    canDeleteTask: can("tasks.delete"),
    canComment: can("tasks.comment"),
    canManageMembers: can("people.invite"),
  };
}