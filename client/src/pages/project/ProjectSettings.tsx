import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field, FormDialog } from "@/components/common/FormDialog";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { useProject } from "@/hooks/useProject";
import { attempt, downloadFromApi } from "@/lib/projectMeta";

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="max-w-md"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{desc}</p></div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export default function ProjectSettings() {
  const { workspaceId, projectId, project, isAdmin, refresh } = useProject();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [dup, setDup] = useState<{ name: string; tasks: boolean; milestones: boolean } | null>(null);
  const [tpl, setTpl] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!project) return <div className="p-6"><Skeleton className="h-40" /></div>;
  if (!isAdmin) return <p className="p-6 text-sm text-muted-foreground">Only project admins can open settings.</p>;
  const archived = project.status === "Archived";
  const base = `/projects/${projectId}`;

  const duplicate = async () => {
    if (!dup) return;
    setBusy(true);
    let newId = "";
    const ok = await attempt(async () => { newId = (await api.post(`${base}/duplicate`, { name: dup.name, includeTasks: dup.tasks, includeMilestones: dup.milestones })).data.data._id; }, "Project duplicated");
    setBusy(false);
    if (ok) { setDup(null); refresh(); navigate(`/app/${workspaceId}/projects/${newId}/overview`); }
  };
  const saveTemplate = async () => {
    setBusy(true);
    const ok = await attempt(() => api.post(`${base}/save-as-template`, { name: tpl }), "Saved as template");
    setBusy(false);
    if (ok) setTpl(null);
  };
  const remove = async () => {
    setBusy(true);
    const ok = await attempt(() => api.delete(base), "Project deleted");
    setBusy(false);
    if (ok) { await refresh(); navigate(`/app/${workspaceId}/projects`); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Card><CardContent className="divide-y divide-border px-5 py-1">
        <Row title="Project details" desc="Name, dates, manager, budget, tags, color and more."><Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>Edit details</Button></Row>
        <Row title="Visibility" desc={project.visibility === "private" ? "Private: only invited members can see this project." : "Public: everyone in the workspace can see this project."}>
          <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.patch(base, { visibility: project.visibility === "private" ? "public" : "private" }), "Visibility updated")) && refresh()}>Make {project.visibility === "private" ? "public" : "private"}</Button>
        </Row>
        <Row title="Export tasks" desc="Download all tasks of this project as a CSV file."><Button size="sm" variant="outline" onClick={() => attempt(() => downloadFromApi(`${base}/export`, "tasks.csv"))}>Export CSV</Button></Row>
        <Row title="Save as template" desc="Reuse this project's milestones and tasks when creating new projects."><Button size="sm" variant="outline" onClick={() => setTpl(`${project.name} template`)}>Save template</Button></Row>
        <Row title="Duplicate project" desc="Copy this project with its tasks and milestones into a new project."><Button size="sm" variant="outline" onClick={() => setDup({ name: `${project.name} (Copy)`, tasks: true, milestones: true })}>Duplicate</Button></Row>
      </CardContent></Card>

      <Card className="border-destructive/40"><CardContent className="divide-y divide-border px-5 py-1">
        <Row title={archived ? "Restore project" : "Archive project"} desc={archived ? "Bring this project back to the active list." : "Hide it from the active list. Nothing is deleted and you can restore it any time."}>
          <Button size="sm" variant="outline" onClick={async () => (await attempt(() => api.post(`${base}/${archived ? "restore" : "archive"}`), archived ? "Project restored" : "Project archived")) && refresh()}>{archived ? "Restore" : "Archive"}</Button>
        </Row>
        <Row title="Delete project" desc="Permanently deletes the project, all tasks, files, milestones, sprints and history. Members get an email. Only workspace owners and admins can do this."><Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmName("")}>Delete…</Button></Row>
      </CardContent></Card>

      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} workspaceId={workspaceId} project={project} />

      <FormDialog open={!!dup} onOpenChange={(v) => !v && setDup(null)} title="Duplicate project" onSubmit={duplicate} busy={busy} disabled={!dup?.name.trim()} submitLabel="Duplicate">
        {dup && (<>
          <Field label="New project name"><Input value={dup.name} onChange={(e) => setDup({ ...dup, name: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dup.tasks} onChange={(e) => setDup({ ...dup, tasks: e.target.checked })} /> Copy tasks (they start in Backlog)</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dup.milestones} onChange={(e) => setDup({ ...dup, milestones: e.target.checked })} /> Copy milestones</label>
        </>)}
      </FormDialog>

      <FormDialog open={tpl !== null} onOpenChange={(v) => !v && setTpl(null)} title="Save as template" onSubmit={saveTemplate} busy={busy} disabled={!tpl?.trim()}>
        <Field label="Template name"><Input value={tpl || ""} onChange={(e) => setTpl(e.target.value)} /></Field>
      </FormDialog>

      <FormDialog open={confirmName !== null} onOpenChange={(v) => !v && setConfirmName(null)} title="Delete project" onSubmit={remove} busy={busy} disabled={confirmName !== project.name} submitLabel="Delete forever">
        <p className="text-sm text-muted-foreground">This cannot be undone. Type <b className="text-foreground">{project.name}</b> to confirm.</p>
        <Input value={confirmName || ""} onChange={(e) => setConfirmName(e.target.value)} autoFocus />
      </FormDialog>
    </div>
  );
}