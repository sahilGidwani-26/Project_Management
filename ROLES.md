# Roles & Permissions — What Each Role Can Do

Every workspace member has exactly one role. Roles are assigned when
inviting someone (Sidebar → Team → Invite member) and can be changed later
by an Owner or Admin from the same Team page.

**Enforcement happens on the backend** (`server/src/middleware/workspaceRole.ts`,
`taskAccess.ts`, and the route files) — the frontend just hides/disables
buttons the role doesn't allow, as a convenience. Even if someone edits the
frontend or calls the API directly, the backend still blocks disallowed
actions with a 403 error.

## Role summary

| Module / Action | OWNER | ADMIN | PROJECT_MANAGER | MEMBER | VIEWER |
|---|:---:|:---:|:---:|:---:|:---:|
| View dashboard, projects, tasks, analytics | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create / edit / archive projects | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete projects | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create / edit tasks, drag on Kanban board | ✅ | ✅ | ✅ | ✅ | ❌ |
| Delete tasks | ✅ | ✅ | ✅ | ❌ | ❌ |
| Set task dependencies / recurrence | ✅ | ✅ | ✅ | ❌ | ❌ |
| Comment on tasks | ✅ | ✅ | ✅ | ✅ | ❌ |
| Team Chat (channels, DMs) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Invite / remove members, change roles | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit workspace settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete the workspace | ✅ | ❌ | ❌ | ❌ | ❌ |

## Where this is enforced in the code

**Backend** (the real gate — always checked, regardless of what the frontend shows):
- `server/src/middleware/workspaceRole.ts` — `requireWorkspaceRole(...)`, used on
  routes that already have `:workspaceId` in the URL (e.g. inviting members).
- `server/src/middleware/taskAccess.ts` — `loadTaskWorkspaceRole` and
  `loadProjectWorkspaceRole` resolve the role for routes identified by
  `:taskId` or `:projectId` instead (since those URLs don't carry a
  workspace ID directly), then the same `requireWorkspaceRole(...)` applies.
- Applied in `server/src/routes/project.routes.ts`, `task.routes.ts`, and
  `comment.routes.ts`.

**Frontend** (UX only — hides buttons a role can't use, backend still guards everything):
- `client/src/hooks/usePermissions.ts` — reads the current user's role for
  the active workspace and exposes `canCreateProject`, `canCreateTask`,
  `canDeleteTask`, `canComment`, etc.
- Used in `pages/Projects.tsx` (hides "New project"), `components/kanban/Column.tsx`
  (hides the "+" add-task button and disables drag for Viewers),
  `components/tasks/TaskDetailDialog.tsx` (disables status/priority editing,
  hides "Delete task", disables the comment box).

## A note on Platform Admin (`isSuperAdmin`)

This is separate from workspace roles — it's a platform-wide flag on the
`User` document (not per-workspace) that unlocks `/admin` (user/workspace
management, audit logs). It is **not** settable from the UI on purpose;
set it directly in MongoDB (`{ isSuperAdmin: true }`) for whichever account
should have it. See `client/README.md` for the exact steps.

## Testing roles yourself

1. Register your main account → it becomes the workspace **Owner** automatically.
2. Sidebar → **Team** → **Invite member** → pick an email + role. Since SMTP
   may not be configured yet, the dialog shows a direct invite link you can
   open yourself (in an incognito window, logged in as a second test account)
   instead of waiting on an email.
3. Log in as that second account and confirm the table above holds: a
   Viewer, for example, should see everything but have no "New project",
   no "+" on the Kanban columns, and a disabled comment box.
