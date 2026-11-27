import {
  Activity, AlertTriangle, Archive, BarChart3, Building2, Bug, CalendarCheck, CalendarDays, Check, CheckCircle2, ClipboardList, Copy, Download, Eye, FileSpreadsheet, Flag,
  FolderKanban, GitBranch, Hash, KeyRound, Layers, LayoutDashboard, ListChecks, Lock, LogIn, MessageCircle, MessageSquare, Paperclip, Pencil, Play, Plus, Repeat, Rocket,
  Send, Settings, Shield, ShieldCheck, Sun, Target, Timer, Trash2, TrendingUp, Upload, UserMinus, UserPlus, Users, Video, Zap, type LucideIcon,
} from "lucide-react";
import type { PermModule } from "@/types";

export const MODULE_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, projects: FolderKanban, milestones: Flag, tasks: ListChecks, bugs: Bug, releases: Rocket, github: GitBranch, sprints: Repeat,
  sprint_reports: Activity, forecast: TrendingUp, standup: ClipboardList, poker: Target, files: Paperclip, discussion: MessageCircle, timeline: Layers, risks: AlertTriangle,
  time: Timer, automation: Zap, reports: BarChart3, analytics: BarChart3, calendar: CalendarDays, chat: MessageSquare, meetings: Video, attendance: CalendarCheck, leave: Sun,
  people: Users, roles: KeyRound, workspace: Building2,
};

/** Icon of one action ("view", "create", "edit"...). Anything unknown gets a shield. */
export const ACTION_ICONS: Record<string, LucideIcon> = {
  view: Eye, create: Plus, edit: Pencil, delete: Trash2, assign: UserPlus, comment: MessageSquare, publish: Send, export: Download, members: Users, archive: Archive,
  templates: Copy, run: Play, upload: Upload, post: MessageSquare, moderate: Shield, log: Timer, team: Users, mark: LogIn, manage: Settings, settings: Settings,
  request: Send, approve: CheckCircle2, invite: UserPlus, private: Lock, progress: TrendingUp, deactivate: UserMinus, bulk: FileSpreadsheet, configure: Settings,
  facilitate: Play, vote: Check, channels: Hash, send: Send,
};
export const actionIcon = (key: string): LucideIcon => ACTION_ICONS[key] || ShieldCheck;

const CATEGORIES: { key: string; label: string; icon: LucideIcon; modules: string[] }[] = [
  { key: "work", label: "Work", icon: FolderKanban, modules: ["projects", "milestones", "tasks", "bugs", "releases", "github", "sprints", "timeline", "risks", "automation", "time", "files", "discussion", "poker", "standup"] },
  { key: "insights", label: "Insights", icon: BarChart3, modules: ["dashboard", "analytics", "reports", "sprint_reports", "forecast"] },
  { key: "talk", label: "Communication", icon: MessageSquare, modules: ["calendar", "chat", "meetings"] },
  { key: "hr", label: "Attendance and leave", icon: CalendarCheck, modules: ["attendance", "leave"] },
  { key: "admin", label: "People and admin", icon: Shield, modules: ["people", "roles", "workspace"] },
];

export interface ModuleGroup { key: string; label: string; icon: LucideIcon; modules: PermModule[] }

/** The catalog's modules in the groups above. A module that is in no group (added later) goes under “Other”. */
export function groupModules(mods: PermModule[]): ModuleGroup[] {
  const out: ModuleGroup[] = CATEGORIES.map((c) => ({
    key: c.key, label: c.label, icon: c.icon,
    modules: c.modules.map((k) => mods.find((m) => m.key === k)).filter(Boolean) as PermModule[],
  })).filter((g) => g.modules.length);
  const used = new Set(out.flatMap((g) => g.modules.map((m) => m.key)));
  const rest = mods.filter((m) => !used.has(m.key));
  if (rest.length) out.push({ key: "other", label: "Other", icon: Shield, modules: rest });
  return out;
}