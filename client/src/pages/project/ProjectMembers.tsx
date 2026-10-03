import { useState } from "react";
import { api } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject, useWorkspaceMembers } from "@/hooks/useProject";
import { attempt } from "@/lib/projectMeta";
import { initials } from "@/lib/utils";
import { ProjectRole } from "@/types";

const ROLES: [ProjectRole, string, string][] = [
  ["ADMIN", "Admin", "Edit project, manage members"],
  ["MEMBER", "Member", "Create and edit tasks, files, discussion"],
  ["VIEWER", "Viewer", "View only"],
];

export default function ProjectMembers() {
  const { workspaceId, projectId, project, isAdmin, refresh } = useProject();
  const { data: wsMembers } = useWorkspaceMembers(workspaceId);
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<ProjectRole>("MEMBER");

  if (!project) return <div className="p-6"><Skeleton className="h-40" /></div>;

  const roleOf = (id: string): ProjectRole => project.memberRoles?.find((r) => r.userId?._id === id)?.role || "MEMBER";
  const memberIds = new Set(project.members.map((m) => m._id));
  const addable = (wsMembers || []).filter((m) => !memberIds.has(m.userId._id));
  const base = `/projects/${projectId}/members`;

  const add = async () => { if (await attempt(() => api.post(base, { userId: newUser, role: newRole }), "Member added")) { setNewUser(""); refresh(); } };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {isAdmin && (
        <Card><CardContent className="space-y-3 p-5">
          <h2 className="font-semibold">Add member</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={newUser} onValueChange={setNewUser}>
              <SelectTrigger className="w-64"><SelectValue placeholder={addable.length ? "Pick a teammate…" : "Everyone is already in"} /></SelectTrigger>
              <SelectContent>{addable.map((m) => <SelectItem key={m.userId._id} value={m.userId._id}>{m.userId.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as ProjectRole)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
            <Button disabled={!newUser} onClick={add}>Add</Button>
          </div>
          <p className="text-xs text-muted-foreground">{ROLES.find((r) => r[0] === newRole)?.[2]}. They receive an email.</p>
        </CardContent></Card>
      )}

      <Card><CardContent className="divide-y divide-border p-0">
        {project.members.map((m) => {
          const isManager = project.managerId?._id === m._id;
          return (
            <div key={m._id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8"><AvatarImage src={m.profileImage} /><AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback></Avatar>
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">{m.name}{isManager && <Badge variant="secondary" className="text-[10px]">Manager</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && !isManager ? (
                  <Select value={roleOf(m._id)} onValueChange={async (v) => (await attempt(() => api.patch(`${base}/${m._id}`, { role: v }), "Role updated")) && refresh()}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline">{isManager ? "Admin" : ROLES.find((r) => r[0] === roleOf(m._id))?.[1]}</Badge>
                )}
                {isAdmin && !isManager && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => window.confirm(`Remove ${m.name} from this project?`) && (await attempt(() => api.delete(`${base}/${m._id}`), "Member removed")) && refresh()}>Remove</Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Workspace owners, admins and project managers always have admin access to every project.</p>
    </div>
  );
}