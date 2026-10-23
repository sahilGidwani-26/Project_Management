import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { WorkspaceProvider } from "@/hooks/useWorkspace";
import { PermissionProvider } from "@/hooks/usePermissionsContext";
import { RouteGate } from "@/components/permissions/RouteGate";

export function AppLayout() {
  return (
    <WorkspaceProvider>
      <PermissionProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar />
            <main className="flex-1 overflow-y-auto scrollbar-thin">
              <RouteGate>
                <Outlet />
              </RouteGate>
            </main>
          </div>
        </div>
      </PermissionProvider>
    </WorkspaceProvider>
  );
}