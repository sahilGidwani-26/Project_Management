import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WorkspaceMember, WorkspaceRole } from "@/types";
import { copyText, roleCls, roleLabel } from "@/lib/people";
import { cn, initials } from "@/lib/utils";

export function RoleBadge({ role, name, color }: { role: WorkspaceRole; name?: string; color?: string | null }) {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    return <span className="rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: `${color}26`, color }}>{name || roleLabel(role)}</span>;
  }
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", roleCls[role])}>{name || roleLabel(role)}</span>;
}

export function MemberAvatar({ name, image, className }: { name?: string; image?: string; className?: string }) {
  return (
    <Avatar className={className || "h-10 w-10"}>
      <AvatarImage src={image} />
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Small status pills for the team list. */
export function StatusPills({ m }: { m: WorkspaceMember }) {
  return (
    <>
      {m.status === "deactivated" && <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">Deactivated</span>}
      {m.status === "active" && m.userId.mustChangePassword && <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Not logged in yet</span>}
    </>
  );
}

export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} className={cn("text-xs", secret && "font-mono text-sm")} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" size="sm" variant="outline" onClick={() => copyText(value, `${label} copied`)}>Copy</Button>
      </div>
    </div>
  );
}

/** Shows a temporary login once (after "Resend login details"). */
export function CredentialsDialog({
  open, onOpenChange, email, password, emailQueued,
}: { open: boolean; onOpenChange: (v: boolean) => void; email: string; password: string; emailQueued: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New temporary password</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <CopyField label="Login email" value={email} />
          <CopyField label="Temporary password" value={password} secret />
          <p className="text-xs text-muted-foreground">
            {emailQueued ? "These details were also emailed to the person." : "Email is not set up on the server, so nothing was emailed. Share these details yourself."}{" "}
            This password is shown only now and must be changed at the next login.
          </p>
        </div>
        <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}