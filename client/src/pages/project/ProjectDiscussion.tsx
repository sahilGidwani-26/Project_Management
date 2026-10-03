import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject, useProjectResource, useWorkspaceMembers } from "@/hooks/useProject";
import { attempt, timeAgo } from "@/lib/projectMeta";
import { cn, initials } from "@/lib/utils";
import { ProjectComment } from "@/types";

const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Comment text me @Name ko highlight karta hai. */
function Rendered({ c }: { c: ProjectComment }) {
  const names = c.mentions.map((m) => m.name).filter(Boolean);
  if (!names.length) return <>{c.content}</>;
  const parts = c.content.split(new RegExp(`(@(?:${names.map(escRx).join("|")}))`, "g"));
  return <>{parts.map((p, i) => (p.startsWith("@") && names.some((n) => p === `@${n}`) ? <span key={i} className="rounded bg-primary/10 px-1 font-medium text-primary">{p}</span> : <span key={i}>{p}</span>))}</>;
}

export default function ProjectDiscussion() {
  const { projectId, canEdit, isAdmin } = useProject();
  const { user } = useAuth(); // ASSUMPTION: useAuth() returns { user } with user._id
  const { data: comments, isLoading, reload } = useProjectResource<ProjectComment[]>("comments", projectId, "comments", 8000);
  const { data: members } = useWorkspaceMembers(useProject().workspaceId);

  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<{ _id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<ProjectComment | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);

  const token = /@([\w .-]*)$/.exec(text);
  const suggestions = token ? (members || []).filter((m) => m.userId.name.toLowerCase().includes(token[1].toLowerCase())).slice(0, 5) : [];

  const pick = (id: string, name: string) => {
    setText((t) => t.replace(/@([\w .-]*)$/, `@${name} `));
    setMentions((m) => (m.some((x) => x._id === id) ? m : [...m, { _id: id, name }]));
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const ids = mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m._id);
    if (await attempt(() => api.post(`/projects/${projectId}/comments`, { content: body, mentions: ids }))) { setText(""); setMentions([]); reload(); }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (!editing || !editText.trim()) return;
    if (await attempt(() => api.patch(`/projects/${projectId}/comments/${editing._id}`, { content: editText.trim() }), "Updated")) { setEditing(null); reload(); }
  };

  const mine = (c: ProjectComment) => c.userId?._id === user?._id;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {isLoading && <Skeleton className="h-32" />}
      {!isLoading && !comments?.length && <p className="text-sm text-muted-foreground">No messages yet. Start the discussion, use @ to mention a teammate (they get an email).</p>}

      <div className="space-y-3">
        {comments?.map((c) => (
          <div key={c._id} className={cn("flex gap-3 rounded-lg border border-border bg-card p-3", c.pinned && "border-amber-500/50 bg-amber-500/5")}>
            <Avatar className="h-8 w-8"><AvatarImage src={c.userId?.profileImage} /><AvatarFallback className="text-xs">{initials(c.userId?.name || "?")}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-sm font-medium">{c.userId?.name}</span>
                <span className="text-muted-foreground">{timeAgo(c.createdAt)}{c.editedAt && " · edited"}</span>
                {c.pinned && <span className="text-amber-600">📌 Pinned</span>}
                <span className="ml-auto flex gap-2 text-muted-foreground">
                  {isAdmin && <button className="hover:text-foreground" onClick={async () => (await attempt(() => api.patch(`/projects/${projectId}/comments/${c._id}`, { pinned: !c.pinned }))) && reload()}>{c.pinned ? "Unpin" : "Pin"}</button>}
                  {canEdit && (mine(c) || isAdmin) && <button className="hover:text-foreground" onClick={() => { setEditing(c); setEditText(c.content); }}>Edit</button>}
                  {canEdit && (mine(c) || isAdmin) && <button className="hover:text-destructive" onClick={async () => window.confirm("Delete this message?") && (await attempt(() => api.delete(`/projects/${projectId}/comments/${c._id}`))) && reload()}>Delete</button>}
                </span>
              </div>
              {editing?._id === c._id ? (
                <div className="mt-2 space-y-2">
                  <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div className="flex gap-2"><Button size="sm" onClick={saveEdit}>Save</Button><Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button></div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm"><Rendered c={c} /></p>
              )}
            </div>
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="relative space-y-2">
          {!!suggestions.length && (
            <div className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-md border border-border bg-popover p-1 shadow-md">
              {suggestions.map((m) => <button key={m.userId._id} type="button" onClick={() => pick(m.userId._id, m.userId.name)} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-secondary">{m.userId.name}</button>)}
            </div>
          )}
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message… use @ to mention someone" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }} />
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Ctrl + Enter to send</span><Button size="sm" disabled={busy || !text.trim()} onClick={send}>Send</Button></div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You have view-only access to this project.</p>
      )}
    </div>
  );
}