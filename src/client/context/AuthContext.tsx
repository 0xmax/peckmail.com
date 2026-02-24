import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase.js";
import { api, setApiToken } from "../lib/api.js";
import type { User, Session } from "@supabase/supabase-js";

interface CreditBalance {
  balance: number;
  held: number;
  available: number;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  defaultApiKey: string | null;
  handle: string | null;
  credits: CreditBalance | null;
  activeProjectId: string | null;
  refreshCredits: () => Promise<void>;
  setActiveProject: (projectId: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [defaultApiKey, setDefaultApiKey] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    const handleSession = (session: Session | null) => {
      setApiToken(session?.access_token ?? "");
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Ensure a default API key exists (fire-and-forget)
        api
          .post<{ key: string; created: boolean }>("/api/keys/ensure-default")
          .then((r) => setDefaultApiKey(r.key))
          .catch(() => {});
        // Fetch user handle
        api
          .get<{ handle: string | null }>("/api/user/profile")
          .then((r) => setHandle(r.handle))
          .catch(() => {});
        // Fetch credit balance
        api
          .get<CreditBalance>("/api/credits/balance")
          .then((r) => setCredits(r))
          .catch(() => {});
        // Fetch active project — auto-select first project if none set
        api
          .get<{ projectId: string | null }>("/api/user/active-project")
          .then(async (r) => {
            if (r.projectId) {
              setActiveProjectId(r.projectId);
            } else {
              // No active project — try to auto-select the first one
              try {
                const { projects } = await api.get<{ projects: { id: string }[] }>("/api/projects");
                if (projects.length > 0) {
                  const firstId = projects[0].id;
                  await api.put("/api/user/active-project", { projectId: firstId }).catch(() => {});
                  setActiveProjectId(firstId);
                }
              } catch {
                // No projects — will show onboarding
              }
            }
            setLoading(false);
          })
          .catch(() => {
            setLoading(false);
          });
      } else {
        setDefaultApiKey(null);
        setHandle(null);
        setCredits(null);
        setActiveProjectId(null);
        setLoading(false);
      }
    };

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    },
    []
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) throw error;
    },
    []
  );

  const signOut = useCallback(async () => {
    setApiToken("");
    await supabase.auth.signOut();
    window.location.href = "/";
  }, []);

  const refreshCredits = useCallback(async () => {
    try {
      const r = await api.get<CreditBalance>("/api/credits/balance");
      setCredits(r);
    } catch {
      // ignore
    }
  }, []);

  const setActiveProject = useCallback(async (projectId: string) => {
    await api.put("/api/user/active-project", { projectId });
    setActiveProjectId(projectId);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        defaultApiKey,
        handle,
        credits,
        activeProjectId,
        refreshCredits,
        setActiveProject,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
