import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAssignableRoles } from "@/hooks/useRoles";

/** Role dropdown for a person's profile. Lists only roles the logged-in person is allowed to give. */
export function RoleSelect({ workspaceId, value, currentName, onChange, disabled }: { workspaceId: string; value: string; currentName?: string; onChange: (roleId: string) => void; disabled?: boolean }) {
  const { roles } = useAssignableRoles(workspaceId);
  if (!roles) return <span className="text-xs text-muted-foreground">Loading roles…</span>;

  const hasCurrent = roles.some((r) => r._id === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Role" /></SelectTrigger>
      <SelectContent>
        {!hasCurrent && value && <SelectItem value={value} disabled>{currentName || "Current role"}</SelectItem>}
        {roles.map((r) => (
          <SelectItem key={r._id} value={r._id}>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}