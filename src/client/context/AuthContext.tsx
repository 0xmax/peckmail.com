import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase.js";
import { api } from "../lib/api.js";
import type { User, Session } from "@supabase/supabase-js";
import type { UserPreferences } from "../store/types.js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  preferences: UserPreferences;
  defaultApiKey: string | null;
  handle: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  updatePreferences: (prefs: UserPreferences) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<UserPreferences>({});
  const [defaultApiKey, setDefaultApiKey] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    const handleSession = (session: Session | null) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setPreferences(session.user.user_metadata?.preferences || {});
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
      } else {
        setDefaultApiKey(null);
        setHandle(null);
      }
      setLoading(false);
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
    await supabase.auth.signOut();
    window.location.href = "/";
  }, []);

  const updatePreferences = useCallback(async (prefs: UserPreferences) => {
    await api.put("/api/user/preferences", prefs);
    setPreferences(prefs);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        preferences,
        defaultApiKey,
        handle,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        updatePreferences,
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
