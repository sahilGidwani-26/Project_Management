import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X, FolderKanban } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { TaskStatus, TaskType, BugSeverity, Project } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AssigneeMultiSelect } from "./AssigneeMultiSelect";
import { toast } from "sonner";

const TYPES: TaskType[] = ["Task", "Bug", "Feature", "Improvement"];
const SEVERITIES: BugSeverity[] = ["Minor", "Major", "Critical"];

function invalidateAllTaskLists(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return key === "tasks" || key === "tasks-list" || key === "workspace-tasks" || key === "my-tasks-assigned" || key === "my-tasks-created";
    },
  });
}

export function CreateTaskDialog({
  workspaceId,
  projectId, // if provided, project is locked (e.g. opened from a project's Kanban board); otherwise the user picks one, or none
  defaultStatus = "Todo",
  defaultType = "Task",
  open,
  onOpenChange,
}: {
  workspaceId: string;
  projectId?: string;
  defaultStatus?: TaskStatus;
  defaultType?: TaskType;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<TaskType>(defaultType);
  const [priority, setPriority] = useState("Medium");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId || "none");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [loading, setLoading] = useState(false);

  // bug-only fields
  const [severity, setSeverity] = useState<BugSeverity>("Major");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [environment, setEnvironment] = useState("");
  const [foundIn, setFoundIn] = useState("");

  const isProjectLocked = !!projectId;
  const isBug = type === "Bug";

  const { data: projects } = useQuery({
    queryKey: ["projects-picker", workspaceId],
    queryFn: async () => (await api.get(`/projects/workspace/${workspaceId}?limit=100`)).data.data as Project[],
    enabled: !isProjectLocked && open,
  });

  const addSubtaskDraft = () => {
    if (!subtaskDraft.trim()) return;
    setSubtasks((prev) => [...prev, subtaskDraft.trim()]);
    setSubtaskDraft("");
  };

  const reset = () => {
    setTitle("");
    setDescription("");
    setType(defaultType);
    setAssigneeIds([]);
    setSubtasks([]);
    setSubtaskDraft("");
    setStartDate("");
    setDueDate("");
    setStatus(defaultStatus);
    setSelectedProjectId(projectId || "none");
    setSeverity("Major");
    setSteps("");
    setExpected("");
    setActual("");
    setEnvironment("");
    setFoundIn("");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const finalProjectId = selectedProjectId === "none" ? undefined : selectedProjectId;
      const bugDetails = isBug
        ? Object.fromEntries(
            Object.entries({
              severity,
              stepsToReproduce: steps.trim(),
              expectedResult: expected.trim(),
              actualResult: actual.trim(),
              environment: environment.trim(),
              foundInVersion: foundIn.trim(),
            }).filter(([, v]) => v !== "")
          )
        : undefined;

      await api.post("/tasks", {
        workspaceId,
        projectId: finalProjectId,
        title,
        description,
        type,
        bugDetails,
        status,
        priority,
        assigneeIds,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        subtasks,
      });
      invalidateAllTaskLists(qc);
      onOpenChange(false);
      reset();
      toast.success(isBug ? "Bug reported" : "Task created");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle>{isBug ? "Report a bug" : "New task"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isBug ? "Login button does nothing on Safari" : "Design the login screen"} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as TaskType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t === "Bug" ? "🐛 Bug" : t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Project</Label>
              {isProjectLocked ? (
                <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-secondary/40 px-3 text-sm text-muted-foreground">
                  <FolderKanban className="h-4 w-4 shrink-0" />
                  <span className="truncate">Current project</span>
                </div>
              ) : (
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects?.map((p) => (
                      <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {isBug && (
            <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs font-medium text-red-600">Bug details</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Severity</Label>
                  <Select value={severity} onValueChange={(v) => setSeverity(v as BugSeverity)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Found in version</Label>
                  <Input value={foundIn} onChange={(e) => setFoundIn(e.target.value)} placeholder="v1.3.0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Steps to reproduce</Label>
                <Textarea value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={"1. Open the login page\n2. Enter valid details\n3. Click Login"} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Expected result</Label>
                  <Textarea value={expected} onChange={(e) => setExpected(e.target.value)} className="min-h-[60px]" />
                </div>
                <div className="space-y-1.5">
                  <Label>Actual result</Label>
                  <Textarea value={actual} onChange={(e) => setActual(e.target.value)} className="min-h-[60px]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Environment</Label>
                <Input value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="Chrome 126, Windows 11" />
              </div>
              {severity === "Critical" && (
                <p className="text-xs text-muted-foreground">Critical bugs email the project leads right away.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="## Overview&#10;Add more detail (optional) — supports ## heading, **bold**, - list"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Assignees</Label>
            <AssigneeMultiSelect workspaceId={workspaceId} value={assigneeIds} onChange={setAssigneeIds} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Backlog", "Todo", "In Progress", "In Review", "Done"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start date</Label>
              <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueDate">Due date</Label>
              <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Subtasks</Label>
            {subtasks.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1.5 text-sm">
                <span className="flex-1">{s}</span>
                <button type="button" onClick={() => setSubtasks((prev) => prev.filter((_, idx) => idx !== i))}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={subtaskDraft}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                placeholder="Add a subtask..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubtaskDraft();
                  }
                }}
              />
              <Button type="button" variant="outline" size="icon" onClick={addSubtaskDraft}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading || !title}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isBug ? "Report bug" : "Create task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}