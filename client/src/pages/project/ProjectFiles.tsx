import { useRef, useState } from "react";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject, useProjectResource } from "@/hooks/useProject";
import { attempt, downloadFromApi, fmtBytes, timeAgo } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";
import { ProjectFile } from "@/types";

export default function ProjectFiles() {
  const { projectId, canEdit, isAdmin } = useProject();
  const { data: files, isLoading, reload } = useProjectResource<ProjectFile[]>("files", projectId);
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const fd = new FormData();
    Array.from(list).slice(0, 10).forEach((f) => fd.append("files", f));
    setUploading(true);
    if (await attempt(() => api.post(`/projects/${projectId}/files`, fd), "Uploaded")) reload();
    setUploading(false);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="space-y-4 p-6">
      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
          className={cn("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center", drag && "border-primary bg-primary/5")}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm">Drag files here or</p>
          <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
          <Button size="sm" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? "Uploading…" : "Choose files"}</Button>
          <p className="text-xs text-muted-foreground">Up to 10 files at a time, 25 MB each. Executables are blocked.</p>
        </div>
      )}

      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && !files?.length && <p className="text-sm text-muted-foreground">No files uploaded yet.</p>}

      {!!files?.length && (
        <Card><CardContent className="divide-y divide-border p-0">
          {files.map((f) => (
            <div key={f._id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{f.fileName}</p>
                  <p className="text-xs text-muted-foreground">{fmtBytes(f.fileSize)} · {f.uploadedBy?.name || "Unknown"} · {timeAgo(f.createdAt)}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => attempt(() => downloadFromApi(`/projects/${projectId}/files/${f._id}/download`, f.fileName))}><Download className="h-4 w-4" /></Button>
                {canEdit && (
                  <Button size="sm" variant="ghost" className="text-destructive" title={isAdmin ? "Delete" : "Only your own uploads"}
                    onClick={async () => window.confirm(`Delete "${f.fileName}"?`) && (await attempt(() => api.delete(`/projects/${projectId}/files/${f._id}`), "File deleted")) && reload()}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}