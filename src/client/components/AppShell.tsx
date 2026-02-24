import { useState, useEffect } from "react";
import { AppSidebar, type NavItem } from "./AppSidebar.js";
import { DashboardView } from "./DashboardView.js";
import { InboxView } from "./InboxView.js";
import { ChatView } from "./ChatView.js";
import { DataView } from "./DataView.js";

const PATH_TO_NAV: Record<string, NavItem> = {
  "/app": "dashboard",
  "/app/": "dashboard",
  "/app/inbox": "inbox",
  "/app/chat": "chat",
  "/app/data": "data",
};

const NAV_TO_PATH: Record<NavItem, string> = {
  dashboard: "/app",
  inbox: "/app/inbox",
  chat: "/app/chat",
  data: "/app/data",
};

function navFromPath(): NavItem {
  return PATH_TO_NAV[window.location.pathname] || "dashboard";
}

export function AppShell({
  initialView,
  onNavigateSettings,
}: {
  initialView?: NavItem;
  onNavigateSettings: () => void;
}) {
  const [activeNav, setActiveNav] = useState<NavItem>(initialView || navFromPath);

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
    <div className="h-screen flex bg-background">
      <AppSidebar
        activeNav={activeNav}
        onNavigate={handleNavigate}
        onOpenSettings={onNavigateSettings}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {activeNav === "dashboard" && <DashboardView />}
        {activeNav === "inbox" && <InboxView />}
        {activeNav === "chat" && <ChatView />}
        {activeNav === "data" && <DataView />}
      </main>
    </div>
  );
}
