import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/** Chhota dropdown menu, kisi extra package ki zarurat nahi. Click event bubble nahi hota (card ke andar safe). */
export function SimpleMenu({ trigger, items, align = "right" }: { trigger: ReactNode; items: MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
        {trigger}
      </button>
      {open && (
        <div className={cn("absolute top-full z-50 mt-1 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md", align === "right" ? "right-0" : "left-0")}>
          {items.filter((i) => !i.hidden).map((i) => (
            <button
              key={i.label}
              type="button"
              onClick={() => { setOpen(false); i.onClick(); }}
              className={cn("block w-full rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-secondary", i.danger && "text-destructive")}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}