import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute, AdminRoute } from "@/routes/ProtectedRoute";
import WorkspaceIndex from "@/routes/WorkspaceIndex";
import { AppLayout } from "@/components/layout/AppLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";

import Landing from "@/pages/Landing";
import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import Tasks from "@/pages/Tasks";
import CalendarPage from "@/pages/Calendar";
import ProjectLayout from "@/pages/ProjectLayout";
import ProjectBoardPage from "@/pages/ProjectBoardPage";
import ProjectListPage from "@/pages/ProjectListPage";
import ProjectOverview from "@/pages/project/ProjectOverview";
import ProjectBugs from "@/pages/project/ProjectBugs";
import ProjectTimeline from "@/pages/project/ProjectTime";
import ProjectCalendar from "@/pages/project/ProjectCalendar";
import ProjectSprints from "@/pages/project/ProjectSprints";
import ProjectFiles from "@/pages/project/ProjectFiles";
import ProjectDiscussion from "@/pages/project/ProjectDiscussion";
import ProjectMembers from "@/pages/project/ProjectMembers";
import ProjectReports from "@/pages/project/ProjectReports";
import ProjectReleases from "@/pages/project/ProjectReleases";
import ProjectTime from "@/pages/project/ProjectTime";
import ProjectRisks from "@/pages/project/ProjectRisks";
import ProjectAutomation from "@/pages/project/ProjectAutomation";
import ProjectSettings from "@/pages/project/ProjectSettings";
import MyTasks from "@/pages/MyTasks";
import Chat from "@/pages/Chat";
import Analytics from "@/pages/Analytics";
import Settings from "@/pages/Settings";
import SearchPage from "@/pages/Search";
import WorkspaceTeam from "@/pages/WorkspaceTeam";
import AcceptInvite from "@/pages/AcceptInvite";
import NotFound from "@/pages/NotFound";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminWorkspaces from "@/pages/admin/AdminWorkspaces";
import AdminAuditLogs from "@/pages/admin/AdminAuditLogs";
import ProjectGithub from "@/pages/project/ProjectGithub";
import ProjectSprintReports from "@/pages/project/ProjectSprintReports";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/invitations/:token" element={<AcceptInvite />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/app" element={<WorkspaceIndex />} />

                <Route path="/app/:workspaceId" element={<AppLayout />}>
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="projects" element={<Projects />} />
                  <Route path="tasks" element={<Tasks />} />
                  <Route path="calendar" element={<CalendarPage />} />
                  <Route path="projects/:projectId" element={<ProjectLayout />}>
                    <Route index element={<Navigate to="overview" replace />} />
                    <Route path="overview" element={<ProjectOverview />} />
                    <Route path="board" element={<ProjectBoardPage />} />
                    <Route path="list" element={<ProjectListPage />} />
                    <Route path="bugs" element={<ProjectBugs />} />
                    <Route path="releases" element={<ProjectReleases />} />
                    <Route path="github" element={<ProjectGithub />} />
                    <Route path="timeline" element={<ProjectTimeline />} />
                    <Route path="calendar" element={<ProjectCalendar />} />
                    <Route path="sprints" element={<ProjectSprints />} />
                    <Route path="sprint-reports" element={<ProjectSprintReports />} />
                    <Route path="files" element={<ProjectFiles />} />
                    <Route path="discussion" element={<ProjectDiscussion />} />
                    <Route path="members" element={<ProjectMembers />} />
                    <Route path="reports" element={<ProjectReports />} />
                    <Route path="time" element={<ProjectTime />} />
                    <Route path="risks" element={<ProjectRisks />} />
                    <Route path="automation" element={<ProjectAutomation />} />
                    <Route path="settings" element={<ProjectSettings />} />
                  </Route>
                  <Route path="my-tasks" element={<MyTasks />} />
                  <Route path="chat" element={<Chat />} />
                  <Route path="team" element={<WorkspaceTeam />} />
                  <Route path="analytics" element={<Analytics />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="search" element={<SearchPage />} />
                </Route>
              </Route>

              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="workspaces" element={<AdminWorkspaces />} />
                  <Route path="audit-logs" element={<AdminAuditLogs />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}