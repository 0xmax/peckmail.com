import { useState, useEffect } from "react";
import { AppSidebar, type NavItem } from "./AppSidebar.js";
import { DashboardView } from "./DashboardView.js";
import { InboxView } from "./InboxView.js";
import { ChatView } from "./ChatView.js";
import { DataView } from "./DataView.js";
import { AccountSettings } from "./AccountSettings.js";
import { WorkspaceSettings } from "./WorkspaceSettings.js";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar.js";

const PATH_TO_NAV: Record<string, NavItem> = {
  "/app": "dashboard",
  "/app/": "dashboard",
  "/app/inbox": "inbox",
  "/app/chat": "chat",
  "/app/data": "data",
  "/app/workspace": "workspace",
  "/settings": "settings",
};

const NAV_TO_PATH: Record<NavItem, string> = {
  dashboard: "/app",
  inbox: "/app/inbox",
  chat: "/app/chat",
  data: "/app/data",
  workspace: "/app/workspace",
  settings: "/settings",
};

function navFromPath(): NavItem {
  return PATH_TO_NAV[window.location.pathname] || "dashboard";
}

export function AppShell({ initialView }: { initialView?: NavItem }) {
  const [activeNav, setActiveNav] = useState<NavItem>(
    initialView || navFromPath
  );

  useEffect(() => {
    const handler = () => setActiveNav(navFromPath());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const handleNavigate = (item: NavItem) => {
    setActiveNav(item);
    window.history.pushState(null, "", NAV_TO_PATH[item]);
  };

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar activeNav={activeNav} onNavigate={handleNavigate} />
      <SidebarInset>
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {activeNav === "dashboard" && <DashboardView />}
          {activeNav === "inbox" && <InboxView />}
          {activeNav === "chat" && <ChatView />}
          {activeNav === "data" && <DataView />}
          {activeNav === "workspace" && <WorkspaceSettings />}
          {activeNav === "settings" && <AccountSettings />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
