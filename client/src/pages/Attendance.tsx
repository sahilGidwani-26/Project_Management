import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Settings, UserCheck, Users } from "lucide-react";
import { api } from "@/lib/api";
import { AttLiveRow, AttSettings } from "@/types";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/common/PageHeader";
import { NoAccess } from "@/components/permissions/permissionUi";
import { Skeleton } from "@/components/ui/skeleton";
import { AttendanceSettingsTab } from "@/components/attendance/AttendanceSettingsTab";
import { EditDayDialog } from "@/components/attendance/EditDayDialog";
import { EmployeeDetail } from "@/components/attendance/EmployeeDetail";
import { LeaveTab } from "@/components/attendance/LeaveTab";
import { MonthSheet } from "@/components/attendance/MonthSheet";
import { MyDay } from "@/components/attendance/MyDay";
import { MyMonth } from "@/components/attendance/MyMonth";
import { TeamLive } from "@/components/attendance/TeamLive";
import { TeamSummary } from "@/components/attendance/TeamSummary";
import { dayKey } from "@/lib/attendance";
import { cn } from "@/lib/utils";

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
type Sub = "live" | "summary" | "sheet";
const SUBS: [Sub, string][] = [["live", "Live board"], ["summary", "Summary and analytics"], ["sheet", "Month sheet"]];

export default function Attendance() {
  const { workspaceId, tab } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, ready } = usePermissions();

  const [ym, setYm] = useState(() => dayKey(Date.now(), browserTz).slice(0, 7));
  const [sub, setSub] = useState<Sub>("live");
  const [empId, setEmpId] = useState<string | null>(null);
  const [liveEdit, setLiveEdit] = useState<{ row: AttLiveRow; today: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ["att-settings", workspaceId],
    queryFn: async () => (await api.get(`/attendance/workspace/${workspaceId}/settings`)).data.data as AttSettings,
    enabled: !!workspaceId && can("attendance.view"),
  });
  const tz = settings?.timezone || browserTz;

  const tabs = [
    { key: "me", label: "My attendance", icon: UserCheck, ok: can("attendance.view") },
    { key: "team", label: "Team", icon: Users, ok: can("attendance.team") },
    { key: "leave", label: "Leave", icon: CalendarDays, ok: can("leave.view") },
    { key: "settings", label: "Settings", icon: Settings, ok: can("attendance.settings") },
  ].filter((t) => t.ok);

  if (!ready) return <div className="p-6"><Skeleton className="h-64" /></div>;
  if (!tabs.length) return <NoAccess page="Attendance" workspaceId={workspaceId} next="dashboard" />;

  const active = tabs.find((t) => t.key === tab)?.key || tabs[0].key;
  const go = (key: string) => { setEmpId(null); navigate(`/app/${workspaceId}/attendance/${key}`); };
  const w = workspaceId!;
  const refreshTeam = () => ["att-live", "att-team", "att-matrix", "att-emp"].forEach((k) => qc.invalidateQueries({ queryKey: [k, w] }));

  return (
    <div>
      <PageHeader title="Attendance" description="Check in, track your hours and see how the team is doing" />
      <div className="space-y-6 p-6">
        <div className="flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => go(t.key)} className={cn("flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors", active === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {active === "me" && (
          <div className="space-y-6">
            <MyDay workspaceId={w} />
            <MyMonth workspaceId={w} ym={ym} setYm={setYm} tz={tz} />
          </div>
        )}

        {active === "team" && (
          empId ? (
            <EmployeeDetail workspaceId={w} userId={empId} ym={ym} setYm={setYm} tz={tz} canManage={can("attendance.manage")} canExport={can("attendance.export")} onBack={() => setEmpId(null)} />
          ) : (
            <div className="space-y-5">
              <div className="inline-flex rounded-md border border-border p-0.5">
                {SUBS.map(([k, l]) => <button key={k} type="button" onClick={() => setSub(k)} className={cn("rounded px-3 py-1.5 text-sm font-medium", sub === k ? "bg-secondary" : "text-muted-foreground hover:text-foreground")}>{l}</button>)}
              </div>
              {sub === "live" && <TeamLive workspaceId={w} canManage={can("attendance.manage")} onOpen={setEmpId} onEdit={(row, _tz, today) => setLiveEdit({ row, today })} />}
              {sub === "summary" && <TeamSummary workspaceId={w} ym={ym} setYm={setYm} tz={tz} canExport={can("attendance.export")} onOpen={setEmpId} />}
              {sub === "sheet" && <MonthSheet workspaceId={w} ym={ym} setYm={setYm} tz={tz} onOpen={setEmpId} />}
            </div>
          )
        )}

        {active === "leave" && <LeaveTab workspaceId={w} tz={tz} />}
        {active === "settings" && <AttendanceSettingsTab workspaceId={w} />}
      </div>

      {liveEdit && (
        <EditDayDialog open onOpenChange={(v) => !v && setLiveEdit(null)} workspaceId={w} person={{ userId: liveEdit.row.userId, name: liveEdit.row.name }} day={liveEdit.row} tz={tz} today={liveEdit.today} onSaved={refreshTeam} />
      )}
    </div>
  );
}