import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Trash2, UserPlus } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { WorkspaceMember, WorkspaceRole } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { initials } from "@/lib/utils";
import { toast } from "sonner";

const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "PROJECT_MANAGER", "MEMBER", "VIEWER"];
const roleDescriptions: Record<WorkspaceRole, string> = {
  OWNER: "Full control — manage workspace, members, projects, settings",
  ADMIN: "Manage projects, members and tasks",
  PROJECT_MANAGER: "Create projects, manage assigned projects and tasks",
  MEMBER: "View permitted projects, create/update tasks, comment",
  VIEWER: "Read-only access — cannot modify anything",
};

export default function WorkspaceTeam() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const { data: members } = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/members`)).data.data as WorkspaceMember[],
    enabled: !!workspaceId,
  });

  const myRole = members?.find((m) => m.userId._id === user?._id)?.role;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setLastInviteLink(null);
    try {
      const res = await api.post(`/workspaces/${workspaceId}/invitations`, { email, role });
      // SMTP might not be configured yet — surface the accept link directly so testing
      // doesn't depend on email delivery.
      const token = res.data.data.token;
      setLastInviteLink(`${window.location.origin}/invitations/${token}`);
      toast.success("Invitation created");
      setEmail("");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (memberId: string, newRole: WorkspaceRole) => {
    try {
      await api.patch(`/workspaces/${workspaceId}/members/${memberId}`, { role: newRole });
      qc.invalidateQueries({ queryKey: ["members", workspaceId] });
      toast.success("Role updated");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      await api.delete(`/workspaces/${workspaceId}/members/${memberId}`);
      qc.invalidateQueries({ queryKey: ["members", workspaceId] });
      toast.success("Member removed");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Team"
        description="Workspace members and roles"
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <UserPlus className="h-4 w-4" /> Invite member
            </Button>
          ) : undefined
        }
      />

      <div className="p-6 space-y-2">
        {members?.map((m) => (
          <Card key={m._id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={m.userId.profileImage} />
                  <AvatarFallback>{initials(m.userId.name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{m.userId.name}</p>
                  <p className="text-xs text-muted-foreground">{m.userId.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {canManage && m.userId._id !== user?._id ? (
                  <>
                    <Select value={m.role} onValueChange={(v) => changeRole(m._id, v as WorkspaceRole)}>
                      <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeMember(m._id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <Badge variant="secondary">{m.role.replace("_", " ")}</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setLastInviteLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a member</DialogTitle>
          </DialogHeader>
          <form onSubmit={invite} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as WorkspaceRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== "OWNER").map((r) => (
                    <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{roleDescriptions[role]}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={inviting || !email}>
                {inviting && <Loader2 className="h-4 w-4 animate-spin" />}
                <Mail className="h-4 w-4" /> Send invitation
              </Button>
            </DialogFooter>
          </form>

          {lastInviteLink && (
            <div className="rounded-md border border-border bg-secondary/50 p-3">
              <p className="text-xs font-medium mb-1">
                Invite link (use this if email isn't set up yet — open it in an incognito window logged in as the invited user):
              </p>
              <code className="block break-all text-xs text-primary">{lastInviteLink}</code>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
