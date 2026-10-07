import { useState, useEffect } from "react";
import { Trash2, Pencil, Check } from "lucide-react";
import { api, apiError } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriorityBadge } from "@/components/common/PriorityBadge";
import { formatDate } from "@/lib/utils";
import { renderLiteMarkdown } from "@/lib/markdown";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { AssigneeMultiSelect } from "./AssigneeMultiSelect";
import { SubtasksSection } from "./SubtasksSection";
import { TaskDiscussion } from "./TaskDiscussion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Task, TaskType, BugSeverity, Release } from "@/types";
import { TaskDevelopment } from "./TaskDevelopment";

const TYPES: TaskType[] = ["Task", "Bug", "Feature", "Improvement"];
const SEVERITIES: BugSeverity[] = ["Minor", "Major", "Critical"];

export function TaskDetailDialog({ task, open, onOpenChange }: { task: Task; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { canEditTask, canDeleteTask } = usePermissions();

  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [type, setType] = useState<TaskType>(task.type || "Task");
  const [releaseId, setReleaseId] = useState(task.releaseId || "none");
  const projectId = task.projectId?._id;
  const { data: releases } = useQuery({
    queryKey: ["releases", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}/releases`)).data.data as Release[],
    enabled: !!projectId && open,
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task.assigneeIds.map((u) => u._id));
  const [startDate, setStartDate] = useState(task.startDate?.slice(0, 10) || "");
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) || "");

  const [editingDescription, setEditingDescription] = useState(false);
  const [description, setDescription] = useState(task.description || "");

  // bug fields
  const [severity, setSeverity] = useState<BugSeverity>(task.bugDetails?.severity || "Major");
  const [steps, setSteps] = useState(task.bugDetails?.stepsToReproduce || "");
  const [expected, setExpected] = useState(task.bugDetails?.expectedResult || "");
  const [actual, setActual] = useState(task.bugDetails?.actualResult || "");
  const [environment, setEnvironment] = useState(task.bugDetails?.environment || "");
  const [foundIn, setFoundIn] = useState(task.bugDetails?.foundInVersion || "");
  const [fixedIn, setFixedIn] = useState(task.bugDetails?.fixedInVersion || "");

  useEffect(() => {
    setStatus(task.status);
    setPriority(task.priority);
    setType(task.type || "Task");
    setReleaseId(task.releaseId || "none");
    setAssigneeIds(task.assigneeIds.map((u) => u._id));
    setStartDate(task.startDate?.slice(0, 10) || "");
    setDueDate(task.dueDate?.slice(0, 10) || "");
    setDescription(task.description || "");
    setEditingDescription(false);
    setSeverity(task.bugDetails?.severity || "Major");
    setSteps(task.bugDetails?.stepsToReproduce || "");
    setExpected(task.bugDetails?.expectedResult || "");
    setActual(task.bugDetails?.actualResult || "");
    setEnvironment(task.bugDetails?.environment || "");
    setFoundIn(task.bugDetails?.foundInVersion || "");
    setFixedIn(task.bugDetails?.fixedInVersion || "");
  }, [task]);

  const refresh = () =>
    qc.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return key === "tasks" || key === "tasks-list" || key === "workspace-tasks" || key === "my-tasks-assigned" || key === "my-tasks-created";
      },
    });

  const updateField = async (patch: Record<string, unknown>) => {
    try {
      await api.patch(`/tasks/${task._id}`, patch);
      refresh();
      return true;
    } catch (err) {
      toast.error(apiError(err));
      return false;
    }
  };

  const changeStatus = async (v: string) => {
    setStatus(v as any);
    try {
      await api.patch(`/tasks/${task._id}/status`, { status: v });
      refresh();
    } catch (err) {
      setStatus(task.status); // e.g. "Blocked by TASK-3 ..." -> put the select back
      toast.error(apiError(err));
    }
  };

  const changeAssignees = (ids: string[]) => {
    setAssigneeIds(ids);
    updateField({ assigneeIds: ids });
  };

  const saveDescription = async () => {
    await updateField({ description });
    setEditingDescription(false);
  };

  const saveBugDetails = async () => {
    const bugDetails = Object.fromEntries(
      Object.entries({
        severity,
        stepsToReproduce: steps.trim(),
        expectedResult: expected.trim(),
        actualResult: actual.trim(),
        environment: environment.trim(),
        foundInVersion: foundIn.trim(),
        fixedInVersion: fixedIn.trim(),
      }).filter(([, v]) => v !== "")
    );
    if (await updateField({ bugDetails })) toast.success("Bug details saved");
  };

  const deleteTask = async () => {
    try {
      await api.delete(`/tasks/${task._id}`);
      refresh();
      onOpenChange(false);
      toast.success("Task deleted");
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] p-0 overflow-hidden">
        <div className="flex h-full">
          {/* Left: task fields */}
          <div className="flex-1 min-w-0 overflow-y-auto scrollbar-thin p-6 space-y-4">
            <DialogHeader>
              <p className="text-xs font-mono text-muted-foreground mb-1">
                TASK-{task.taskNumber}
                {type !== "Task" && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-sans text-[10px] font-medium uppercase">{type === "Bug" ? "🐛 Bug" : type}</span>}
              </p>
              <DialogTitle className="pr-6">{task.title}</DialogTitle>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <Select
                  disabled={!canEditTask}
                  value={type}
                  onValueChange={(v) => { setType(v as TaskType); updateField({ type: v }); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => <SelectItem key={t} value={t}>{t === "Bug" ? "🐛 Bug" : t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select disabled={!canEditTask} value={status} onValueChange={changeStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Backlog", "Todo", "In Progress", "In Review", "Done"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <Select
                  disabled={!canEditTask}
                  value={priority}
                  onValueChange={(v) => { setPriority(v as any); updateField({ priority: v }); }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Low", "Medium", "High", "Urgent"].map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {type === "Bug" && (
              <div className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                <p className="text-xs font-medium text-red-600">Bug details</p>
                <p className="text-[11px] text-muted-foreground">
                  Board flow: <b>Todo</b> = new · <b>In Progress</b> = being fixed · <b>In Review</b> = fixed, waiting for QA · <b>Done</b> = verified and closed.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Severity</label>
                    <Select disabled={!canEditTask} value={severity} onValueChange={(v) => setSeverity(v as BugSeverity)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Found in</label>
                    <Input disabled={!canEditTask} value={foundIn} onChange={(e) => setFoundIn(e.target.value)} placeholder="v1.3.0" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Fixed in</label>
                    <Input disabled={!canEditTask} value={fixedIn} onChange={(e) => setFixedIn(e.target.value)} placeholder="v1.3.1" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Steps to reproduce</label>
                  <Textarea disabled={!canEditTask} value={steps} onChange={(e) => setSteps(e.target.value)} className="min-h-[80px]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Expected result</label>
                    <Textarea disabled={!canEditTask} value={expected} onChange={(e) => setExpected(e.target.value)} className="min-h-[60px]" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Actual result</label>
                    <Textarea disabled={!canEditTask} value={actual} onChange={(e) => setActual(e.target.value)} className="min-h-[60px]" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Environment</label>
                  <Input disabled={!canEditTask} value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="Chrome 126, Windows 11" />
                </div>
                {canEditTask && (
                  <div className="flex justify-end">
                    <Button size="sm" onClick={saveBugDetails}><Check className="h-3.5 w-3.5" /> Save bug details</Button>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Assignees</label>
              <AssigneeMultiSelect
                workspaceId={task.workspaceId}
                value={assigneeIds}
                onChange={changeAssignees}
                disabled={!canEditTask}
              />
            </div>

                        {projectId && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Release</label>
                <Select
                  disabled={!canEditTask}
                  value={releaseId}
                  onValueChange={async (v) => {
                    setReleaseId(v);
                    if (await updateField({ releaseId: v === "none" ? null : v })) {
                      qc.invalidateQueries({ queryKey: ["releases", projectId] });
                    } else {
                      setReleaseId(task.releaseId || "none");
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No release</SelectItem>
                    {releases?.map((r) => (
                      <SelectItem key={r._id} value={r._id}>{r.name}{r.status === "Released" ? " (released)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Start date</label>
                <Input
                  type="date"
                  disabled={!canEditTask}
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); updateField({ startDate: e.target.value ? new Date(e.target.value).toISOString() : null }); }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Due date</label>
                <Input
                  type="date"
                  disabled={!canEditTask}
                  value={dueDate}
                  onChange={(e) => { setDueDate(e.target.value); updateField({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : null }); }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <PriorityBadge priority={task.priority} />
              {task.dueDate && <span className="text-xs text-muted-foreground">Due {formatDate(task.dueDate)}</span>}
            </div>

            {/* Description: rendered lite-markdown, with an edit toggle */}
            <div className="border-t border-border pt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  Description <span className="opacity-70">(supports ## heading, **bold**, - list)</span>
                </label>
                {canEditTask && !editingDescription && (
                  <button onClick={() => setEditingDescription(true)} className="text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {editingDescription ? (
                <div className="space-y-2">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[120px]"
                    placeholder="## Overview&#10;What needs to happen and why."
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditingDescription(false); setDescription(task.description || ""); }}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveDescription}>
                      <Check className="h-3.5 w-3.5" /> Save
                    </Button>
                  </div>
                </div>
              ) : task.description ? (
                <div
                  className="text-sm text-foreground/90"
                  dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(task.description) }}
                />
              ) : (
                <p className="text-sm text-muted-foreground italic">No description yet.</p>
              )}
            </div>

            <SubtasksSection taskId={task._id} canEdit={canEditTask} />

                        {task.projectId && <TaskDevelopment taskId={task._id} taskNumber={task.taskNumber} title={task.title} />}

            {canDeleteTask && (
              <div className="flex justify-end border-t border-border pt-3">
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={deleteTask}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete task
                </Button>
              </div>
            )}
          </div>

          {/* Right: discussion panel */}
          <div className="hidden md:flex w-80 shrink-0 flex-col border-l border-border p-5 bg-secondary/20">
            <TaskDiscussion taskId={task._id} workspaceId={task.workspaceId} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}