import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Project, ProjectTemplateInfo } from "@/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { useWorkspaceMembers } from "@/hooks/useProject";
import { CATEGORIES, CURRENCIES, PRIORITIES, PROJECT_COLORS, PROJECT_ICONS, PROJECT_STATUSES, attempt, toInput, toISO } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";

const empty = {
  name: "", description: "", status: "Planning", priority: "Medium", startDate: "", endDate: "", managerId: "none",
  memberIds: [] as string[], color: PROJECT_COLORS[0], icon: "📁", category: "none", tags: "", clientName: "",
  budget: "", currency: "USD", visibility: "public", coverImage: "", templateId: "blank",
};
type Form = typeof empty;

const fromProject = (p: Project): Form => ({
  ...empty,
  name: p.name, description: p.description || "", status: p.status === "Archived" ? "Planning" : p.status, priority: p.priority,
  startDate: toInput(p.startDate), endDate: toInput(p.endDate), managerId: p.managerId?._id || "none", color: p.color || empty.color,
  icon: p.icon || "📁", category: p.category || "none", tags: (p.tags || []).join(", "), clientName: p.clientName || "",
  budget: p.budget != null ? String(p.budget) : "", currency: p.currency || "USD", visibility: p.visibility || "public", coverImage: p.coverImage || "",
});

/** `project` na do to Create, `project` do to Edit dialog. */
export function ProjectFormDialog({
  open, onOpenChange, workspaceId, project, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  project?: Project;
  onCreated?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const { data: members } = useWorkspaceMembers(open ? workspaceId : undefined);
  const { data: templates } = useQuery({
    queryKey: ["project-templates", workspaceId],
    queryFn: async () => (await api.get(`/projects/templates/${workspaceId}`)).data.data as ProjectTemplateInfo[],
    enabled: open && !project,
  });

  useEffect(() => {
    if (open) setF(project ? fromProject(project) : empty);
  }, [open, project]);

  const dateError = f.startDate && f.endDate && f.endDate < f.startDate;

  const submit = async () => {
    if (dateError) return toast.error("End date must be after the start date");
    const body: Record<string, unknown> = {
      name: f.name.trim(), description: f.description, status: f.status, priority: f.priority,
      startDate: toISO(f.startDate), endDate: toISO(f.endDate), managerId: f.managerId === "none" ? null : f.managerId,
      color: f.color, icon: f.icon, category: f.category === "none" ? null : f.category,
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), clientName: f.clientName,
      budget: f.budget === "" ? null : Number(f.budget), currency: f.currency, visibility: f.visibility, coverImage: f.coverImage,
    };
    if (!project) Object.assign(body, { workspaceId, memberIds: f.memberIds, templateId: f.templateId });
    setBusy(true);
    let createdId: string | undefined;
    const ok = await attempt(async () => {
      const res = project ? await api.patch(`/projects/${project._id}`, body) : await api.post("/projects", body);
      createdId = res.data.data?._id;
    }, project ? "Project updated" : "Project created");
    setBusy(false);
    if (!ok) return;
    qc.invalidateQueries({ queryKey: ["projects", workspaceId] });
    if (project) qc.invalidateQueries({ queryKey: ["project", project._id] });
    onOpenChange(false);
    if (!project && createdId) onCreated?.(createdId);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={project ? "Edit project" : "New project"} onSubmit={submit} busy={busy} disabled={f.name.trim().length < 2} submitLabel={project ? "Save changes" : "Create project"} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name" className="sm:col-span-2">
          <Input required autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Website Redesign" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What is this project about?" />
        </Field>

        <Field label="Status">
          <Select value={f.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onValueChange={(v) => set("priority", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} /></Field>

        <Field label="Project manager">
          <Select value={f.managerId} onValueChange={(v) => set("managerId", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No manager</SelectItem>
              {members?.map((m) => <SelectItem key={m.userId._id} value={m.userId._id}>{m.userId.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Category">
          <Select value={f.category} onValueChange={(v) => set("category", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No category</SelectItem>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        {!project && (
          <Field label="Team members" className="sm:col-span-2">
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border p-2">
              {members?.map((m) => {
                const on = f.memberIds.includes(m.userId._id);
                return (
                  <button type="button" key={m.userId._id} onClick={() => set("memberIds", on ? f.memberIds.filter((i) => i !== m.userId._id) : [...f.memberIds, m.userId._id])}
                    className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                    {m.userId.name}
                  </button>
                );
              })}
              {!members?.length && <span className="text-xs text-muted-foreground">Loading members…</span>}
            </div>
          </Field>
        )}

        <Field label="Client name"><Input value={f.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Acme Corp" /></Field>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label="Budget"><Input type="number" min={0} value={f.budget} onChange={(e) => set("budget", e.target.value)} /></Field>
          <Field label="Currency">
            <Select value={f.currency} onValueChange={(v) => set("currency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Tags (comma separated)" className="sm:col-span-2">
          <Input value={f.tags} onChange={(e) => set("tags", e.target.value)} placeholder="website, q4, client-work" />
        </Field>

        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => set("color", c)} className={cn("h-6 w-6 rounded-full border-2", f.color === c ? "border-foreground" : "border-transparent")} style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </Field>
        <Field label="Icon">
          <div className="flex flex-wrap gap-1">
            {PROJECT_ICONS.map((i) => (
              <button type="button" key={i} onClick={() => set("icon", i)} className={cn("rounded-md border px-1.5 py-0.5 text-base", f.icon === i ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary")}>{i}</button>
            ))}
          </div>
        </Field>

        <Field label="Visibility">
          <div className="grid grid-cols-2 gap-2">
            {(["public", "private"] as const).map((v) => (
              <button type="button" key={v} onClick={() => set("visibility", v)} className={cn("rounded-md border px-3 py-2 text-left text-sm", f.visibility === v ? "border-primary bg-primary/5" : "border-border")}>
                <span className="block font-medium capitalize">{v}</span>
                <span className="block text-[11px] text-muted-foreground">{v === "public" ? "Whole workspace can see it" : "Only invited members"}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Cover image URL">
          <Input value={f.coverImage} onChange={(e) => set("coverImage", e.target.value)} placeholder="https://…" />
        </Field>

        {!project && (
          <Field label="Start from" className="sm:col-span-2">
            <Select value={f.templateId} onValueChange={(v) => set("templateId", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(templates || [{ id: "blank", name: "Blank project", custom: false, milestoneCount: 0, taskCount: 0 }]).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{t.taskCount ? ` · ${t.taskCount} tasks` : ""}{t.custom ? " (saved)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      {dateError && <p className="text-xs text-destructive">End date must be after the start date.</p>}
    </FormDialog>
  );
}