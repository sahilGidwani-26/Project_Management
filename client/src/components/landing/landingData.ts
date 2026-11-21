import {
  AlertTriangle, AtSign, Bell, Building2, Bug, CalendarCheck, CalendarDays, ClipboardList, Clock, Eye, FileSpreadsheet, GitBranch, Globe, History,
  KanbanSquare, KeyRound, Layers, ListChecks, Lock, LogIn, Mail, MessageSquare, Network, Paperclip, Rocket, Settings, Shield, Star, Target,
  Timer, TrendingUp, Upload, UserPlus, Users, Video, Zap, type LucideIcon,
} from "lucide-react";

export interface Feature { icon: LucideIcon; title: string; desc: string }
export interface Category { key: string; label: string; icon: LucideIcon; blurb: string; items: Feature[] }

export const CATEGORIES: Category[] = [
  {
    key: "work", label: "Projects & tasks", icon: KanbanSquare,
    blurb: "Everything to plan the work and move it forward, from a single task to a whole roadmap.",
    items: [
      { icon: KanbanSquare, title: "Kanban board", desc: "Drag tasks between Backlog, Todo, In Progress, In Review and Done. Everyone sees the move live." },
      { icon: ListChecks, title: "List view and subtasks", desc: "Switch to a list, break work into subtasks, and set priorities, labels, due dates and assignees." },
      { icon: Bug, title: "Bug tracker", desc: "Report bugs with severity and steps to reproduce. Critical ones alert the project leads." },
      { icon: Layers, title: "Timeline and dependencies", desc: "See the plan on a Gantt-style timeline and block tasks until the ones they depend on are done." },
      { icon: CalendarDays, title: "Milestones", desc: "Group tasks into checkpoints and watch progress move toward each one." },
      { icon: Zap, title: "Automation and recurring tasks", desc: "Set rules such as notify the lead when a task is done, and create repeating tasks on a schedule." },
      { icon: Paperclip, title: "Files and discussion", desc: "Keep project files and a discussion with pinned messages right beside the work." },
      { icon: AlertTriangle, title: "Risks and issues", desc: "Track risks with likelihood and impact so problems are seen early." },
    ],
  },
  {
    key: "delivery", label: "Planning & delivery", icon: TrendingUp,
    blurb: "Estimate, forecast and ship with numbers that come from your real work, not guesses.",
    items: [
      { icon: TrendingUp, title: "Sprints and reports", desc: "Plan sprints and read burndown, velocity and scope-change reports built from real task history." },
      { icon: Clock, title: "Delivery forecast", desc: "A forecast based on your actual throughput gives a likely finish date, with a range." },
      { icon: Target, title: "Planning poker", desc: "Estimate together with hidden votes and a reveal. An accuracy report compares estimates with logged time." },
      { icon: Rocket, title: "Releases and changelog", desc: "Bundle finished tasks into releases, publish a changelog, and get reminders before release day." },
      { icon: GitBranch, title: "GitHub integration", desc: "Link pull requests and commits to tasks through a webhook, and see development status on the task." },
      { icon: ClipboardList, title: "Auto standup", desc: "A daily standup built from what moved yesterday, optionally emailed each morning in your timezone." },
      { icon: Timer, title: "Time tracking", desc: "Log time on tasks and compare it with your estimates." },
    ],
  },
  {
    key: "people", label: "Team & people", icon: Users,
    blurb: "Bring your team in the way that suits you, and keep every profile and report in one place.",
    items: [
      { icon: UserPlus, title: "Add people your way", desc: "Invite by email, or create accounts yourself with a temporary password they must change at first login." },
      { icon: Upload, title: "Bulk CSV import", desc: "Add up to 100 people at once. Every row is checked first, so nothing is imported blindly." },
      { icon: Users, title: "Profiles and progress", desc: "Designation, department, company, phone and address, plus tasks done, on-time rate and workload per person." },
      { icon: Building2, title: "Departments", desc: "Group people by department and add a whole department to a project in one click." },
      { icon: Network, title: "Org chart", desc: "A collapsible reporting tree built from who reports to whom." },
      { icon: FileSpreadsheet, title: "Export", desc: "Download your team list as CSV, with private details only when you choose and are allowed." },
    ],
  },
  {
    key: "talk", label: "Communication", icon: MessageSquare,
    blurb: "Talk, meet and stay in sync without leaving the workspace.",
    items: [
      { icon: MessageSquare, title: "Team chat", desc: "Channels, private channels, direct messages, reactions and typing indicators." },
      { icon: Video, title: "Video meetings", desc: "Start a call in the browser with camera, microphone and screen sharing. Nothing to install." },
      { icon: CalendarDays, title: "Calendar", desc: "Meetings, events, task due dates and project deadlines on one calendar." },
      { icon: AtSign, title: "Mentions", desc: "@mention teammates in comments and they are notified right away." },
      { icon: Mail, title: "Email for every action", desc: "Assignments, role changes, leave decisions, invitations and more reach people by email too." },
      { icon: Bell, title: "Live notifications", desc: "A bell that updates the moment something changes, with email preferences you control." },
    ],
  },
  {
    key: "time", label: "Attendance & leave", icon: CalendarCheck,
    blurb: "Daily attendance, leave and reports with clear rules that you set once.",
    items: [
      { icon: LogIn, title: "Check in and out", desc: "One tap to check in, with a live timer. Choose Office, Remote or On-site." },
      { icon: Eye, title: "Live admin board", desc: "See who is in, late, absent or on leave right now, and look back at any day." },
      { icon: Star, title: "Fair star ratings", desc: "A 1 to 5 rating from attendance, punctuality and hours, never lowered by approved paid leave or holidays." },
      { icon: CalendarCheck, title: "Leave management", desc: "Casual, sick, earned or your own types, with yearly quotas, balances and approvals." },
      { icon: Settings, title: "Your rules", desc: "Set working days, shift hours, grace time, half-day rules, week-offs and holidays. Only admins can change them." },
      { icon: FileSpreadsheet, title: "PDF and Excel reports", desc: "Download the whole team or one person, with a daily log and a month sheet." },
      { icon: Clock, title: "Reminder emails", desc: "Automatic check-in and check-out reminders on working days, only to people who still need them." },
    ],
  },
  {
    key: "secure", label: "Security & control", icon: Shield,
    blurb: "Decide exactly who can see and do what, and know the rules are enforced.",
    items: [
      { icon: KeyRound, title: "Custom roles", desc: "Create roles with 80+ permissions across every module and give them to anyone." },
      { icon: Eye, title: "Hidden, not just disabled", desc: "What a person cannot do is never shown. Menus, tabs and buttons simply do not appear." },
      { icon: Lock, title: "Enforced on the server", desc: "Every action is checked on the server too, so hiding a button is never the only protection." },
      { icon: Globe, title: "Meeting access modes", desc: "Invited only, workspace only, or anyone with the link, plus a waiting room, passcode and lock." },
      { icon: History, title: "Activity log", desc: "Role changes, attendance corrections and exports are recorded." },
      { icon: Shield, title: "Safe by default", desc: "Passwords are hashed, admin-set passwords must be replaced at first login, and nobody can give permissions they do not have." },
    ],
  },
];

export const MARQUEE = [
  "Kanban", "Sprints", "Bug tracker", "Releases", "GitHub", "Forecast", "Planning poker", "Time tracking", "Team chat", "Video meetings",
  "Calendar", "Attendance", "Leave", "Roles", "Org chart", "Reports",
];

export const STEPS = [
  { title: "Create your workspace", desc: "Name it and you get projects, chat and your people directory ready to use." },
  { title: "Add your team and set roles", desc: "Invite by email or create accounts. Pick a built-in role or design your own." },
  { title: "Plan, talk and track", desc: "Run projects, meet in the browser, and watch delivery and attendance in one place." },
];

export const PERSONAS = [
  { icon: GitBranch, title: "Software teams", desc: "Sprints, bugs, releases and GitHub links, with a forecast you can trust." },
  { icon: Layers, title: "Agencies and studios", desc: "Client projects, time tracking, shared files and meetings with guests." },
  { icon: Video, title: "Remote teams", desc: "Chat, video calls, daily standups and attendance in one tool." },
  { icon: Users, title: "Operations and HR", desc: "People directory, leave, attendance reports and tight role control." },
];

export const FAQ = [
  { q: "How do I add my team?", a: "Two ways. Invite people by email and they join with their own account, or create accounts yourself with a temporary password that they must change at first login. For a bigger team, import up to 100 people at once from a CSV file. Every row is checked before anything is created." },
  { q: "Can I control exactly what each person sees and does?", a: "Yes. Start from the built-in roles or create your own, and tick exactly which actions each role may do, for example view, create, edit and delete for every module. Whatever is not ticked never appears for that person, and the server refuses it as well. You can also limit a role to the projects its people belong to." },
  { q: "How do video meetings work?", a: "Meetings run in the browser with camera, microphone, screen sharing, chat and raised hands. Nothing to install. Share the link and people join from the join page. Rooms hold up to 8 people, and screen sharing works on computers (phone browsers do not support it)." },
  { q: "Can people outside my team join a meeting?", a: "Only if you allow it. Each meeting is invited only, workspace only, or open to anyone with the link. Open meetings can use a waiting room, a passcode for guests, and a lock, and hosts can mute or remove anyone. Guests only need to enter a name." },
  { q: "How does attendance work?", a: "People check in and out with one tap. You set the shift hours, working days, grace time, full and half day hours, week-offs and holidays once, and Flowbase marks each day as present, half day, late or absent from that. Approved leave and holidays never count against anyone." },
  { q: "How is the attendance rating worked out?", a: "The 1 to 5 star rating is based on three things: attendance rate (60%), punctuality (25%) and hours completed (15%). The score and the breakdown are visible to the person and to admins, so it is never a mystery." },
  { q: "Can I download attendance reports?", a: "Yes, as PDF or Excel, for the whole team or one person and for any month or date range. The Excel file has a summary, a daily log and a colour-coded month sheet." },
  { q: "Does it connect with GitHub?", a: "Yes. Add a webhook to your repository and pull requests and commits that mention a task are linked to it, so the task shows its development status." },
  { q: "Does it work on phones?", a: "The whole app is responsive and works in a mobile browser, including check-in and joining meetings. The only exception is starting a screen share, which phone browsers do not allow." },
  { q: "Which emails does Flowbase send?", a: "Emails go out for the things that matter: assignments, mentions, invitations, new accounts, role changes, leave requests and decisions, meeting invitations, attendance corrections and reminders. People can switch off the optional ones in their settings." },
];