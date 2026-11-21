import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LayoutItem, Size } from "./dashTypes";
import { WIDGETS } from "./registry";

const SIZES: Size[] = ["s", "m", "l", "xl"];

/** Saved order first (known widgets only). Widgets added later are appended in their default place. */
export function mergeLayout(saved: LayoutItem[] | null): LayoutItem[] {
  const byId = new Map(WIDGETS.map((d) => [d.id, d]));
  const out: LayoutItem[] = [];
  const seen = new Set<string>();
  for (const s of saved || []) {
    const d = byId.get(s.id);
    if (!d || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, size: SIZES.includes(s.size) ? s.size : d.size, hidden: !!s.hidden });
  }
  for (const d of WIDGETS) if (!seen.has(d.id)) out.push({ id: d.id, size: d.size, hidden: !!d.hiddenByDefault });
  return out;
}

export function useDashLayout(workspaceId: string) {
  const url = `/dashboard/workspace/${workspaceId}/layout`;
  const { data, isLoading } = useQuery({
    queryKey: ["dash-layout", workspaceId],
    queryFn: async () => (await api.get(url)).data.data.widgets as LayoutItem[] | null,
    staleTime: Infinity,
    retry: 0,
  });
  const [items, setItems] = useState<LayoutItem[]>(() => mergeLayout(null));
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pending = useRef<LayoutItem[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (isLoading) return;
    setItems(mergeLayout(data ?? null));
    setReady(true);
  }, [isLoading, data]);

  const flush = useCallback(async () => {
    const list = pending.current;
    if (!list) return;
    pending.current = null;
    setState("saving");
    try {
      await api.put(url, { widgets: list });
      setState("saved");
    } catch {
      setState("error");
    }
  }, [url]);

  const update = useCallback((next: LayoutItem[]) => {
    setItems(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }, [flush]);

  // leaving the page right after a change must not lose it
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current) void api.put(url, { widgets: pending.current }).catch(() => undefined);
  }, [url]);

  const move = (from: string, to: string) => {
    const fi = items.findIndex((i) => i.id === from);
    const ti = items.findIndex((i) => i.id === to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    const next = [...items];
    const [m] = next.splice(fi, 1);
    next.splice(ti, 0, m);
    update(next);
  };
  const patch = (id: string, p: Partial<LayoutItem>) => update(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const show = (id: string) => { const it = items.find((i) => i.id === id); if (it) update([...items.filter((i) => i.id !== id), { ...it, hidden: false }]); };

  const reset = async () => {
    clearTimeout(timer.current);
    pending.current = null;
    setItems(mergeLayout(null));
    setState("saving");
    try { await api.delete(url); setState("saved"); } catch { setState("error"); }
  };

  return { items, ready, state, move, setSize: (id: string, size: Size) => patch(id, { size }), hide: (id: string) => patch(id, { hidden: true }), show, reset };
}