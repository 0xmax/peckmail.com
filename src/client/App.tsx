import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext.js";
import { LoginPage } from "./components/LoginPage.js";
import { ProjectList } from "./components/ProjectList.js";
import { Workspace } from "./components/Workspace.js";
import { StoreProvider } from "./store/StoreContext.js";

export function App() {
  const { user, loading } = useAuth();
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  // Check URL for project route
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/p\/([a-f0-9-]+)/);
    if (match) {
      setCurrentProjectId(match[1]);
    }
  }, []);

  // Update URL when project changes
  useEffect(() => {
    if (currentProjectId) {
      window.history.pushState(null, "", `/p/${currentProjectId}`);
    } else if (user) {
      window.history.pushState(null, "", "/");
    }
  }, [currentProjectId, user]);

  // Handle browser back/forward
  useEffect(() => {
    const handler = () => {
      const path = window.location.pathname;
      const match = path.match(/^\/p\/([a-f0-9-]+)/);
      setCurrentProjectId(match ? match[1] : null);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-text-muted text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (!currentProjectId) {
    return <ProjectList onOpenProject={setCurrentProjectId} />;
  }

  return (
    <StoreProvider projectId={currentProjectId}>
      <Workspace onBack={() => setCurrentProjectId(null)} />
    </StoreProvider>
  );
}
