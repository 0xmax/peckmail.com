import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext.js";
import { LoginPage } from "./components/LoginPage.js";
import { ProjectList } from "./components/ProjectList.js";
import { AccountSettings } from "./components/AccountSettings.js";
import { OAuthConsent } from "./components/OAuthConsent.js";
import { InvitePage } from "./components/InvitePage.js";
import { Workspace } from "./components/Workspace.js";
import { ContactPage } from "./components/ContactPage.js";
import { StoreProvider } from "./store/StoreContext.js";
import { SpinnerGap } from "@phosphor-icons/react";

type Route = { page: "login" } | { page: "projects" } | { page: "settings" } | { page: "contact" } | { page: "oauth-consent" } | { page: "invite"; invitationId: string } | { page: "workspace"; projectId: string };

function parseRoute(): Route {
  const path = window.location.pathname;
  if (path === "/login") return { page: "login" };
  if (path === "/projects") return { page: "projects" };
  if (path === "/settings") return { page: "settings" };
  if (path === "/contact") return { page: "contact" };
  if (path === "/oauth/consent") return { page: "oauth-consent" };
  const inviteMatch = path.match(/^\/invite\/([a-f0-9-]+)/);
  if (inviteMatch) return { page: "invite", invitationId: inviteMatch[1] };
  const match = path.match(/^\/p\/([a-f0-9-]+)/);
  if (match) return { page: "workspace", projectId: match[1] };
  return { page: "projects" };
}

export function App() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState<Route>(parseRoute);

  const navigate = (r: Route) => {
    setRoute(r);
    const url = r.page === "login" ? "/login" : r.page === "settings" ? "/settings" : r.page === "contact" ? "/contact" : r.page === "workspace" ? `/p/${r.projectId}` : r.page === "invite" ? `/invite/${r.invitationId}` : "/projects";
    window.history.pushState(null, "", url);
  };

  // Handle browser back/forward
  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <SpinnerGap size={28} className="text-text-muted animate-spin" />
      </div>
    );
  }

  // OAuth consent doesn't need full auth gate — it handles its own auth flow
  if (route.page === "oauth-consent") {
    return <OAuthConsent />;
  }

  // Contact page — accessible without auth
  if (route.page === "contact") {
    return <ContactPage />;
  }

  // Login page — show login form (if already authed, redirect to projects)
  if (route.page === "login") {
    if (user) {
      navigate({ page: "projects" });
      return null;
    }
    return <LoginPage />;
  }

  // Invite page handles both logged-in and logged-out states
  if (route.page === "invite") {
    return (
      <InvitePage
        invitationId={route.invitationId}
        onNavigate={(projectId) => navigate({ page: "workspace", projectId })}
      />
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (route.page === "settings") {
    return <AccountSettings onBack={() => navigate({ page: "projects" })} onOpenProject={(id) => navigate({ page: "workspace", projectId: id })} />;
  }

  if (route.page === "workspace") {
    return (
      <StoreProvider projectId={route.projectId}>
        <Workspace onBack={() => navigate({ page: "projects" })} />
      </StoreProvider>
    );
  }

  return (
    <ProjectList
      onOpenProject={(id) => navigate({ page: "workspace", projectId: id })}
      onOpenSettings={() => navigate({ page: "settings" })}
    />
  );
}
