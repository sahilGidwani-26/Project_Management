import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { TaskStatus, WorkspaceMember } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { toast } from "sonner";

export function CreateTaskDialog({
  status,
  projectId,
  workspaceId,
  open,
  onOpenChange,
}: {
  status: TaskStatus;
  projectId: string;
  workspaceId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("unassigned");
  const [loading, setLoading] = useState(false);

  const { data: members } = useQuery({
    queryKey: ["members", workspaceId],
    queryFn: async () => (await api.get(`/workspaces/${workspaceId}/members`)).data.data as WorkspaceMember[],
    enabled: !!workspaceId && open,
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/tasks", {
        workspaceId,
        projectId,
        title,
        description,
        status,
        priority,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        assigneeId: assigneeId === "unassigned" ? undefined : assigneeId,
      });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setAssigneeId("unassigned");
      toast.success("Task created");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task in {status}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Design the login screen" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add more detail (optional)" />
          </div>

          <div className="space-y-1.5">
            <Label>Assignee</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {members?.map((m) => (
                  <SelectItem key={m.userId._id} value={m.userId._id}>
                    <span className="flex items-center gap-2">
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={m.userId.profileImage} />
                        <AvatarFallback className="text-[9px]">{initials(m.userId.name)}</AvatarFallback>
                      </Avatar>
                      {m.userId.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Low", "Medium", "High", "Urgent"].map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueDate">Due date</Label>
              <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading || !title}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}