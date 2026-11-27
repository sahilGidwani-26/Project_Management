import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bug, CalendarCheck, ChevronDown, Download, FileSpreadsheet, FileText, FolderKanban, LayoutDashboard, ListChecks, Loader2, RefreshCw, Timer, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Project } from "@/types";
import { PageHeader } from "@/components/common/PageHeader";
import { ReportView } from "@/components/analytics/ReportView";
import type { ReportMeta, ReportOptions, SectionDef } from "@/components/analytics/analyticsTypes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { attempt, downloadFromApi } from "@/lib/projectMeta";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { overview: LayoutDashboard, projects: FolderKanban, tasks: ListChecks, bugs: Bug, team: Users, time: Timer, attendance: CalendarCheck };
const BLURB: Record<string, string> = {
  overview: "The big picture: what was created and finished, what is late, and where time and meetings went.",
  projects: "How every project is doing: progress, overdue work, bugs, logged time and deadlines.",
  tasks: "Delivery speed and flow: throughput, how long tasks take, what is late and what has been waiting too long.",
  bugs: "Quality: how many bugs are reported and fixed, how serious they are, and how fast they get fixed.",
  team: "Workload and delivery per person. For planning and support, not for ranking people.",
  time: "Where the hours went, and how close estimates were to reality.",
  attendance: "Attendance, punctuality, leave and star ratings of the team.",
};
const PRESETS: [string, string][] = [["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["month", "This month"], ["lastmonth", "Last month"], ["year", "This year"]];

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

function presetRange(key: string, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  switch (key) {
    case "7d": return { from: addDays(today, -6), to: today };
    case "90d": return { from: addDays(today, -89), to: today };
    case "month": return { from: `${today.slice(0, 8)}01`, to: today };
    case "lastmonth": return { from: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10) };
    case "year": return { from: `${y}-01-01`, to: today };
    default: return { from: addDays(today, -29), to: today };
  }
}

export default function Analytics() {
  const { workspaceId } = useParams();
  const w = workspaceId!;
  const [sp, setSp] = useSearchParams();
  const [preset, setPreset] = useState("30d");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [project, setProject] = useState("all");
  const [busy, setBusy] = useState(false);

  const { data: opts, isError: optsError } = useQuery({
    queryKey: ["rep-options", w],
    queryFn: async () => (await api.get(`/analytics/workspace/${w}/reports/meta`)).data.data as ReportOptions,
    enabled: !!w,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects-picker", w],
    queryFn: async () => (await api.get(`/projects/workspace/${w}?limit=100`)).data.data as Project[],
    enabled: !!w,
  });

  useEffect(() => { if (opts && !range) setRange(presetRange("30d", opts.today)); }, [opts, range]);

  const sections = opts?.sections || [];
  const wanted = sp.get("s");
  const section = sections.some((s) => s.key === wanted) ? (wanted as string) : sections[0]?.key;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (range) { p.set("from", range.from); p.set("to", range.to); }
    if (project !== "all") p.set("projectId", project);
    return p.toString();
  }, [range, project]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["rep", w, section, qs],
    queryFn: async () => (await api.get(`/analytics/workspace/${w}/reports/section?section=${section}&${qs}`)).data.data as { meta: ReportMeta; section: SectionDef },
    enabled: !!section && !!range,
    staleTime: 30_000,
  });

  const pick = (key: string) => {
    if (!opts) return;
    setPreset(key);
    if (key === "custom") { setDraft(range || { from: "", to: "" }); return; }
    setRange(presetRange(key, opts.today));
  };
  const applyCustom = () => {
    if (!opts) return;
    const { from, to } = draft;
    if (!from || !to) return toast.error("Choose both dates");
    if (from > to) return toast.error("The start date is after the end date");
    if (to > opts.today) return toast.error("The end date cannot be in the future");
    if (diffDays(from, to) > 365) return toast.error("Choose a range of at most one year");
    setRange({ from, to });
  };

  const download = async (format: "pdf" | "xlsx", scope: "this" | "all") => {
    if (!range) return;
    setBusy(true);
    const name = `analytics-${scope === "all" ? "all" : section}-${range.from}_to_${range.to}.${format}`;
    await attempt(() => downloadFromApi(`/analytics/workspace/${w}/reports/export?${qs}&format=${format}&section=${scope === "all" ? "all" : section}`, name), "Your report is ready");
    setBusy(false);
  };

  const thisLabel = sections.find((s) => s.key === section)?.label || "this tab";

  if (optsError) {
    return <div><PageHeader title="Analytics" description="Reports on projects, tasks, people, time and attendance" /><p className="p-6 text-sm text-destructive">You do not have access to analytics, or it could not be loaded.</p></div>;
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Reports on projects, tasks, people, time and attendance"
        actions={
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" aria-label="Refresh" onClick={() => refetch()}><RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={busy || !range || !section}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download <ChevronDown className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onClick={() => download("pdf", "this")}><FileText className="h-4 w-4" /> {thisLabel} report (PDF)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("pdf", "all")}><FileText className="h-4 w-4" /> Full report, every tab (PDF)</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => download("xlsx", "this")}><FileSpreadsheet className="h-4 w-4" /> {thisLabel} data (Excel)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("xlsx", "all")}><FileSpreadsheet className="h-4 w-4" /> Full data, every tab (Excel)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="space-y-5 p-4 md:p-6">
        {/* ---------------------------- filters ---------------------------- */}
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex flex-wrap gap-1 rounded-lg bg-secondary/60 p-1">
            {[...PRESETS, ["custom", "Custom"] as [string, string]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => pick(k)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", preset === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </div>
          {preset === "custom" && opts && (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" aria-label="From" value={draft.from} max={opts.today} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="h-9 w-40" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" aria-label="To" value={draft.to} max={opts.today} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className="h-9 w-40" />
              <Button size="sm" variant="outline" onClick={applyCustom}>Apply</Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="All projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects?.map((p) => <SelectItem key={p._id} value={p._id}>{p.icon || "📁"} {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* ---------------------------- tabs ---------------------------- */}
        {!opts ? <Skeleton className="h-10 w-full max-w-xl" /> : (
          <div role="tablist" aria-label="Report sections" className="flex flex-wrap gap-1.5">
            {sections.map((s) => {
              const Icon = ICONS[s.key] || Activity;
              const on = s.key === section;
              return (
                <button key={s.key} type="button" role="tab" aria-selected={on} onClick={() => setSp({ s: s.key }, { replace: true })}
                  className={cn("flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all", on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                  <Icon className="h-4 w-4" />{s.label}
                </button>
              );
            })}
          </div>
        )}
        {section && <p className="text-sm text-muted-foreground">{BLURB[section]}</p>}

        {/* ---------------------------- report ---------------------------- */}
        {(isLoading || !range) && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
            <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
          </div>
        )}
        {isError && (
          <Card className="flex items-center justify-between gap-3 border-destructive/40 p-4 text-sm">
            <span>Could not load this report. Try a shorter date range.</span><Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
          </Card>
        )}
        {data && !isError && (
          <div key={`${section}-${qs}`} className="lp-in">
            <ReportView section={data.section} />
            <p className="mt-6 text-center text-xs text-muted-foreground">
              {data.meta.from} to {data.meta.to} ({data.meta.days} days) · {data.meta.project ? `Project: ${data.meta.project}` : "All projects you can see"} · timezone {data.meta.tz}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}