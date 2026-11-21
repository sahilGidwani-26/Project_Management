import { useState } from "react";
import { ArrowLeft, ArrowRight, EyeOff, GripVertical, Plus, RotateCcw } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashOverview, Size } from "./dashTypes";
import { WIDGETS, widgetAllowed } from "./registry";
import type { useDashLayout } from "./useDashLayout";

type Layout = ReturnType<typeof useDashLayout>;

const SPAN: Record<Size, string> = {
  s: "col-span-1 md:col-span-3 xl:col-span-3",
  m: "col-span-1 md:col-span-6 xl:col-span-6",
  l: "col-span-1 md:col-span-6 xl:col-span-9",
  xl: "col-span-1 md:col-span-6 xl:col-span-12",
};
const SIZE_LABEL: { k: Size; t: string }[] = [{ k: "s", t: "S" }, { k: "m", t: "M" }, { k: "l", t: "L" }, { k: "xl", t: "Full" }];

export function DashboardGrid({ L, editing, ov, workspaceId }: { L: Layout; editing: boolean; ov?: DashOverview; workspaceId: string }) {
  const { can } = usePermissions();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const byId = new Map(WIDGETS.map((d) => [d.id, d]));
  const shown = L.items.filter((i) => !i.hidden && byId.get(i.id) && widgetAllowed(byId.get(i.id)!, can));

  const step = (id: string, dir: -1 | 1) => {
    const idx = shown.findIndex((i) => i.id === id);
    const other = shown[idx + dir];
    if (other) L.move(id, other.id);
  };

  if (!shown.length) {
    return <Card className="p-10 text-center text-sm text-muted-foreground">Every widget is hidden. {editing ? "Add some back from the tray above." : "Click Customize to add widgets."}</Card>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
      {shown.map((it, idx) => {
        const d = byId.get(it.id)!;
        const Comp = d.component;
        return (
          <div
            key={it.id}
            draggable={editing}
            onDragStart={(e) => { setDragId(it.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", it.id); }}
            onDragOver={(e) => { if (!editing || !dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overId !== it.id) setOverId(it.id); }}
            onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== it.id) L.move(dragId, it.id); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            className={cn("relative min-w-0 rounded-xl", SPAN[it.size], editing && "cursor-grab active:cursor-grabbing", dragId === it.id && "opacity-40", overId === it.id && dragId !== it.id && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
          >
            {editing && (
              <div className="absolute inset-x-2 top-2 z-20 flex items-center justify-between gap-2 rounded-lg border border-border bg-background/95 px-2 py-1 shadow-md backdrop-blur">
                <span className="flex min-w-0 items-center gap-1 text-xs font-medium"><GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{d.title}</span></span>
                <span className="flex shrink-0 items-center gap-0.5">
                  <span className="mr-1 hidden overflow-hidden rounded-md border border-border sm:flex">
                    {SIZE_LABEL.map((s) => (
                      <button key={s.k} type="button" onClick={() => L.setSize(it.id, s.k)} className={cn("px-1.5 py-0.5 text-[11px]", it.size === s.k ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>{s.t}</button>
                    ))}
                  </span>
                  <button type="button" aria-label="Move earlier" disabled={idx === 0} onClick={() => step(it.id, -1)} className="rounded p-1 hover:bg-secondary disabled:opacity-30"><ArrowLeft className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Move later" disabled={idx === shown.length - 1} onClick={() => step(it.id, 1)} className="rounded p-1 hover:bg-secondary disabled:opacity-30"><ArrowRight className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Hide widget" onClick={() => L.hide(it.id)} className="rounded p-1 text-destructive hover:bg-secondary"><EyeOff className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            )}
            {/* while customizing the content is "frozen" so the whole card can be grabbed */}
            <div className={cn("h-full", editing && "pointer-events-none select-none opacity-90")}><Comp ov={ov} workspaceId={workspaceId} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function WidgetTray({ L }: { L: Layout }) {
  const { can } = usePermissions();
  const hidden = L.items.filter((i) => i.hidden).map((i) => WIDGETS.find((d) => d.id === i.id)).filter((d) => d && widgetAllowed(d, can));
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Customize your dashboard</p>
          <p className="text-xs text-muted-foreground">Drag a card to move it (on a phone use the arrows). Use S, M, L or Full to resize, and the eye to hide. Changes are saved automatically.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{L.state === "saving" ? "Saving…" : L.state === "saved" ? "Saved ✓" : L.state === "error" ? "Could not save" : ""}</span>
          <Button size="sm" variant="outline" onClick={() => window.confirm("Put every widget back to its default place and size?") && L.reset()}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
        </div>
      </div>
      {hidden.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Add widgets</p>
          <div className="flex flex-wrap gap-2">
            {hidden.map((d) => d && (
              <button key={d.id} type="button" onClick={() => L.show(d.id)} title={d.desc} className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs hover:border-primary hover:bg-primary/5">
                <Plus className="h-3 w-3" /><d.icon className="h-3.5 w-3.5 text-muted-foreground" />{d.title}
              </button>
            ))}
          </div>
        </div>
      ) : <p className="text-xs text-muted-foreground">All widgets are on your dashboard.</p>}
    </Card>
  );
}