import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS, monthLabel, shiftMonth } from "@/lib/attendance";
import { cn, initials } from "@/lib/utils";

export function StatusBadge({ status, short }: { status: string; short?: boolean }) {
  const m = STATUS[status];
  if (!m) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium", m.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}{short && status === "absent" ? " (short hours)" : ""}
    </span>
  );
}

export function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  return (
    <span className="inline-flex" aria-label={value == null ? "No rating yet" : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={cn(value != null && i <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")} />
      ))}
    </span>
  );
}

export const Stat = ({ label, value, sub, cls }: { label: string; value: React.ReactNode; sub?: string; cls?: string }) => (
  <Card><CardContent className="p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={cn("mt-1 text-2xl font-semibold", cls)}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
  </CardContent></Card>
);

export function MonthNav({ ym, onChange, current }: { ym: string; onChange: (ym: string) => void; current: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => onChange(shiftMonth(ym, -1))} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
      <Button variant="outline" size="icon" onClick={() => onChange(shiftMonth(ym, 1))} disabled={ym >= current} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
      <h3 className="min-w-[8.5rem] font-semibold">{monthLabel(ym)}</h3>
      {ym !== current && <Button variant="ghost" size="sm" onClick={() => onChange(current)}>This month</Button>}
    </div>
  );
}

export function PersonCell({ p }: { p: { name: string; email?: string; profileImage?: string; designation?: string } }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="h-7 w-7"><AvatarImage src={p.profileImage} /><AvatarFallback className="text-[10px]">{initials(p.name)}</AvatarFallback></Avatar>
      <div className="min-w-0"><p className="truncate text-sm font-medium">{p.name}</p><p className="truncate text-xs text-muted-foreground">{p.designation || p.email}</p></div>
    </div>
  );
}