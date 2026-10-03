import { useMemo, useState } from "react";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";
import { Button } from "@/components/ui/button";
import { useProject, useProjectResource, useProjectTasks } from "@/hooks/useProject";
import { taskStatusColor } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";
import { Milestone, Task } from "@/types";

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
type Ev = { label: string; color: string; task?: Task };

export default function ProjectCalendar() {
  const { projectId, project } = useProject();
  const { data: tasks } = useProjectTasks(projectId);
  const { data: milestones } = useProjectResource<Milestone[]>("milestones", projectId);
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [open, setOpen] = useState<Task | null>(null);

  const events = useMemo(() => {
    const m = new Map<string, Ev[]>();
    const push = (date: string | undefined, e: Ev) => { if (!date) return; const k = key(new Date(date)); m.set(k, [...(m.get(k) || []), e]); };
    tasks?.forEach((t) => push(t.dueDate, { label: t.title, color: taskStatusColor[t.status], task: t }));
    milestones?.forEach((x) => push(x.dueDate, { label: `◆ ${x.title}`, color: "#F59E0B" }));
    push(project?.startDate, { label: "▶ Project starts", color: "#0F766E" });
    push(project?.endDate, { label: "⚑ Project due", color: "#DC2626" });
    return m;
  }, [tasks, milestones, project]);

  const first = new Date(month);
  first.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i); return d; });
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shift(-1)}>‹</Button>
        <Button size="sm" variant="outline" onClick={() => shift(1)}>›</Button>
        <Button size="sm" variant="outline" onClick={() => { const d = new Date(); d.setDate(1); setMonth(d); }}>Today</Button>
        <h2 className="ml-2 font-semibold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="bg-secondary/50 px-2 py-1.5 font-medium text-muted-foreground">{d}</div>)}
        {cells.map((d) => {
          const ev = events.get(key(d)) || [];
          const inMonth = d.getMonth() === month.getMonth();
          const today = key(d) === key(new Date());
          return (
            <div key={key(d)} className={cn("min-h-24 border-l border-t border-border p-1.5", !inMonth && "bg-secondary/20 text-muted-foreground")}>
              <div className={cn("mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full", today && "bg-primary text-primary-foreground")}>{d.getDate()}</div>
              {ev.slice(0, 3).map((e, i) => (
                <button key={i} onClick={() => e.task && setOpen(e.task)} className="mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px]" style={{ background: `${e.color}25`, color: e.color, cursor: e.task ? "pointer" : "default" }}>{e.label}</button>
              ))}
              {ev.length > 3 && <span className="text-[10px] text-muted-foreground">+{ev.length - 3} more</span>}
            </div>
          );
        })}
      </div>
      {open && <TaskDetailDialog task={open} open onOpenChange={(v) => !v && setOpen(null)} />}
    </div>
  );
}