import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { useRoles } from "@/hooks/useRoles";
import { canGiveRole } from "@/lib/accessMap";

export function RoleSelect({ workspaceId, value, onChange, disabled }: { workspaceId: string; value: string; onChange: (roleId: string) => void; disabled?: boolean }) {
  const me = usePermissions();
  const { roles } = useRoles(workspaceId);
  if (!roles) return <span className="text-xs text-muted-foreground">Loading roles…</span>;

  const list = roles.filter((r) => r._id === value || canGiveRole(r, me));
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Role" /></SelectTrigger>
      <SelectContent>
        {list.map((r) => (
          <SelectItem key={r._id} value={r._id}>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}