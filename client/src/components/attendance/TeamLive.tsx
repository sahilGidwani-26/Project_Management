import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { AttLive, AttLiveRow } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDate, fmtDur, fmtTime } from "@/lib/attendance";
import { PersonCell, Stat, StatusBadge } from "./attendanceUi";

const FILTERS: [string, string][] = [
  ["all", "Everyone"], ["present", "Checked in"], ["late", "Late"], ["still", "Still in"],
  ["absent", "Absent"], ["pending", "Not yet in"], ["leave", "On leave"], ["half_day", "Half day"],
];

export function TeamLive({ workspaceId, canManage, onOpen, onEdit }: { workspaceId: string; canManage: boolean; onOpen: (userId: string) => void; onEdit: (row: AttLiveRow, tz: string, today: string) => void }) {
  const [date, setDate] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["att-live", workspaceId, date],
    queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/live${date ? `?date=${date}` : ""}`)).data.data as AttLive,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <Skeleton className="h-96" />;
  const tz = data.timezone;
  const isToday = data.date === data.today;
  const sm = data.summary;

  const match = (r: AttLiveRow) => {
    if (filter === "present") return ["present", "working", "incomplete"].includes(r.status);
    if (filter === "late") return r.late && r.firstIn != null;
    if (filter === "still") return r.sessions.some((x) => x.out == null);
    if (filter !== "all") return r.status === filter;
    return true;
  };
  const text = q.trim().toLowerCase();
  const rows = data.rows.filter((r) => match(r) && (!text || r.name.toLowerCase().includes(text) || r.email.toLowerCase().includes(text)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" value={date || data.today} max={data.today} onChange={(e) => setDate(e.target.value === data.today ? "" : e.target.value)} className="w-44" />
        {!isToday && <Button size="sm" variant="ghost" onClick={() => setDate("")}>Back to today</Button>}
        <p className="text-sm text-muted-foreground">{fmtDate(data.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {tz}</p>
      </div>

      {data.dayType !== "working" && (
        <p className="rounded-md bg-violet-500/10 px-3 py-2 text-sm">
          {data.dayType === "holiday" ? <>This day is a holiday: <b>{data.holiday}</b>.</> : "This day is a week off for the workspace."} Nobody is expected to check in.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <Stat label="Checked in" value={sm.present} cls="text-emerald-600" sub={`of ${sm.total}`} />
        <Stat label="Late" value={sm.late} cls={sm.late ? "text-amber-600" : ""} />
        <Stat label="Half day" value={sm.halfDay} />
        <Stat label="Absent" value={sm.absent} cls={sm.absent ? "text-destructive" : ""} />
        <Stat label="Not yet in" value={sm.notYet} />
        <Stat label="On leave" value={sm.onLeave} />
        <Stat label="Still in" value={sm.stillIn} cls="text-blue-600" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person…" className="max-w-xs" />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{FILTERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{rows.length} of {data.rows.length} people</span>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs text-muted-foreground">
            <tr>{["Person", "Status", "Check-in", "Check-out", "Hours", "Mode", ""].map((h) => <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!rows.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No one matches.</td></tr>}
            {rows.map((r) => {
              const inNow = r.sessions.some((x) => x.out == null);
              return (
                <tr key={r.userId} className="cursor-pointer hover:bg-secondary/30" onClick={() => onOpen(r.userId)}>
                  <td className="px-4 py-2.5"><PersonCell p={r} /></td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={r.status} short={r.short} />
                      {r.late && r.firstIn != null && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">Late</span>}
                      {inNow && <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />In now</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">{fmtTime(r.firstIn, tz)}</td>
                  <td className="px-4 py-2.5">{r.lastOut && !inNow ? fmtTime(r.lastOut, tz) : "—"}</td>
                  <td className="px-4 py-2.5">{r.worked ? fmtDur(r.worked) : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.mode || "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && r.status !== "future" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Correct this day" onClick={(e) => { e.stopPropagation(); onEdit(r, tz, data.today); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}