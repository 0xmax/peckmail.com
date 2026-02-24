import { useState, useEffect } from "react";
import { AppSidebar, type NavItem } from "./AppSidebar.js";
import { DashboardView } from "./DashboardView.js";
import { InboxView } from "./InboxView.js";
import { ChatView } from "./ChatView.js";
import { DataView } from "./DataView.js";
import { SendersView } from "./SendersView.js";
import { AccountSettings } from "./AccountSettings.js";
import { WorkspaceSettings } from "./WorkspaceSettings.js";
import { OnboardingWizard } from "./OnboardingWizard.js";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar.js";
import { useAuth } from "../context/AuthContext.js";

const PATH_TO_NAV: Record<string, NavItem> = {
  "/app": "dashboard",
  "/app/": "dashboard",
  "/app/inbox": "inbox",
  "/app/senders": "senders",
  "/app/chat": "chat",
  "/app/data": "data",
  "/app/workspace": "workspace",
  "/settings": "settings",
};

const NAV_TO_PATH: Record<NavItem, string> = {
  dashboard: "/app",
  inbox: "/app/inbox",
  senders: "/app/senders",
  chat: "/app/chat",
  data: "/app/data",
  workspace: "/app/workspace",
  settings: "/settings",
};

function navFromPath(): NavItem {
  return PATH_TO_NAV[window.location.pathname] || "dashboard";
}

export function AppShell({ initialView }: { initialView?: NavItem }) {
  const { setActiveProject } = useAuth();
  const [activeNav, setActiveNav] = useState<NavItem>(
    initialView || navFromPath
  );
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const handler = () => setActiveNav(navFromPath());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const handleNavigate = (item: NavItem, path?: string) => {
    setActiveNav(item);
    window.history.pushState(null, "", path || NAV_TO_PATH[item]);
  };

  return (
    <>
      <SidebarProvider defaultOpen={false} className="!h-svh !min-h-0 overflow-hidden">
        <AppSidebar
          activeNav={activeNav}
          onNavigate={handleNavigate}
          onCreateWorkspace={() => setShowOnboarding(true)}
        />
        <SidebarInset className="min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
            {activeNav === "dashboard" && <DashboardView onNavigate={handleNavigate} />}
            {activeNav === "inbox" && <InboxView />}
            {activeNav === "senders" && <SendersView />}
            {activeNav === "chat" && <ChatView />}
            {activeNav === "data" && <DataView />}
            {activeNav === "workspace" && <WorkspaceSettings />}
            {activeNav === "settings" && <AccountSettings />}
          </div>
        </SidebarInset>
      </SidebarProvider>

      {showOnboarding && (
        <div className="fixed inset-0 z-50 bg-background">
          <OnboardingWizard
            onCancel={() => setShowOnboarding(false)}
            onComplete={async (project) => {
              await setActiveProject(project.id);
              window.location.reload();
            }}
          />
        </div>
      )}
    </>
  );
}
