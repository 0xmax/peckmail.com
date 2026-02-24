import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext.js";
import { LoginPage } from "./components/LoginPage.js";
import { OAuthConsent } from "./components/OAuthConsent.js";
import { InvitePage } from "./components/InvitePage.js";
import { ContactPage } from "./components/ContactPage.js";
import { AppShell } from "./components/AppShell.js";
import { OnboardingWizard } from "./components/OnboardingWizard.js";
import { StoreProvider } from "./store/StoreContext.js";
import { api } from "./lib/api.js";
import { SpinnerGap } from "@phosphor-icons/react";
import type { NavItem } from "./components/AppSidebar.js";

type Route =
  | { page: "login" }
  | { page: "settings" }
  | { page: "contact" }
  | { page: "oauth-consent" }
  | { page: "invite"; invitationId: string }
  | { page: "app"; view: NavItem };

function parseRoute(): Route {
  const path = window.location.pathname;
  if (path === "/login") return { page: "login" };
  if (path === "/settings") return { page: "settings" };
  if (path === "/contact") return { page: "contact" };
  if (path === "/oauth/consent") return { page: "oauth-consent" };
  const inviteMatch = path.match(/^\/invite\/([a-f0-9-]+)/);
  if (inviteMatch) return { page: "invite", invitationId: inviteMatch[1] };
  if (path === "/app" || path === "/app/") return { page: "app", view: "dashboard" };
  if (path === "/app/inbox") return { page: "app", view: "inbox" };
  if (path === "/app/senders") return { page: "app", view: "senders" };
  if (path === "/app/chat") return { page: "app", view: "chat" };
  if (path === "/app/data") return { page: "app", view: "data" };
  // Default — treat as dashboard if under /app, otherwise inbox
  if (path.startsWith("/app")) return { page: "app", view: "dashboard" };
  return { page: "app", view: "inbox" };
}

export function App() {
  const { user, loading, activeProjectId, setActiveProject } = useAuth();
  const [route, setRoute] = useState<Route>(parseRoute);
  const [checkingPendingInvites, setCheckingPendingInvites] = useState(false);
  const [allowCreateOnboarding, setAllowCreateOnboarding] = useState(false);

  const navigate = (r: Route) => {
    setRoute(r);
    let url: string;
    switch (r.page) {
      case "login": url = "/login"; break;
      case "settings": url = "/settings"; break;
      case "contact": url = "/contact"; break;
      case "oauth-consent": url = "/oauth/consent"; break;
      case "invite": url = `/invite/${r.invitationId}`; break;
      case "app":
        url = r.view === "dashboard" ? "/app" :
              r.view === "inbox" ? "/app/inbox" :
              r.view === "senders" ? "/app/senders" :
              r.view === "chat" ? "/app/chat" :
              "/app/data";
        break;
    }
    window.history.pushState(null, "", url);
  };

  // Handle browser back/forward
  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // If the user has no active project, prefer pending invitations over forcing project creation.
  useEffect(() => {
    if (!user || activeProjectId || route.page === "invite") {
      setCheckingPendingInvites(false);
      setAllowCreateOnboarding(false);
      return;
    }

    let cancelled = false;
    setCheckingPendingInvites(true);
    setAllowCreateOnboarding(false);

    api
      .get<{ invitations: { id: string }[] }>("/api/invitations")
      .then(({ invitations }) => {
        if (cancelled) return;

        if (Array.isArray(invitations) && invitations.length > 0) {
          const invitationId = invitations[0].id;
          setRoute({ page: "invite", invitationId });
          window.history.replaceState(null, "", `/invite/${invitationId}`);
          return;
        }

        setAllowCreateOnboarding(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAllowCreateOnboarding(true);
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingPendingInvites(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, activeProjectId, route.page]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <SpinnerGap size={28} className="text-muted-foreground animate-spin" />
      </div>
    );
  }

  // OAuth consent doesn't need full auth gate
  if (route.page === "oauth-consent") {
    return <OAuthConsent />;
  }

  // Contact page — accessible without auth
  if (route.page === "contact") {
    return <ContactPage />;
  }

  // Login page
  if (route.page === "login") {
    if (user) {
      navigate({ page: "app", view: "inbox" });
      return null;
    }
    return <LoginPage />;
  }

  // Invite page handles both logged-in and logged-out states
  if (route.page === "invite") {
    return (
      <InvitePage
        invitationId={route.invitationId}
        onNavigate={async (projectId) => {
          await setActiveProject(projectId);
          navigate({ page: "app", view: "inbox" });
        }}
      />
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  // App view — need an active project
  if (!activeProjectId) {
    if (checkingPendingInvites || !allowCreateOnboarding) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <SpinnerGap size={28} className="text-muted-foreground animate-spin" />
            <div className="text-muted-foreground text-sm">Checking invitations...</div>
          </div>
        </div>
      );
    }

    return (
      <OnboardingWizard
        onComplete={async (project) => {
          await setActiveProject(project.id);
          window.location.reload();
        }}
      />
    );
  }

  return (
    <StoreProvider projectId={activeProjectId}>
      <AppShell
        initialView={route.page === "settings" ? "settings" : route.page === "app" ? route.view : "dashboard"}
      />
    </StoreProvider>
  );
}
