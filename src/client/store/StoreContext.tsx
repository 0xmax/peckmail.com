import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { WorkspaceStore } from "./store.js";
import { useAuth } from "../context/AuthContext.js";
import type {
  StoreState,
  StoreAction,
  ChatMessage,
  ChatSession,
  IncomingEmail,
} from "./types.js";

const StoreContext = createContext<WorkspaceStore | null>(null);

export function StoreProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { session } = useAuth();
  const storeRef = useRef<WorkspaceStore | null>(null);

  // Create store once per projectId
  if (!storeRef.current || storeRef.current.getState().projectId !== projectId) {
    storeRef.current?.dispose();
    storeRef.current = new WorkspaceStore(projectId);
  }

  const store = storeRef.current;

  // Connect WS and load initial data
  useEffect(() => {
    if (session?.access_token) {
      store.connect(session.access_token);
    }
    store.loadProjectName();
    store.loadChatSessions();
    store.loadEmails();

    return () => {
      store.dispose();
      storeRef.current = null;
    };
  }, [store, session?.access_token]);

  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

function useStore(): WorkspaceStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used within StoreProvider");
  return store;
}

function useSelector<T>(selector: (state: StoreState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

// --- Selector hooks ---

export function useChatState(): {
  sessions: ChatSession[];
  currentSessionId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
} {
  const sessions = useSelector((s) => s.chatSessions);
  const currentSessionId = useSelector((s) => s.currentSessionId);
  const messages = useSelector((s) => s.chatMessages);
  const streaming = useSelector((s) => s.chatStreaming);
  const error = useSelector((s) => s.chatError);
  return { sessions, currentSessionId, messages, streaming, error };
}

export function useConnected(): boolean {
  return useSelector((s) => s.connected);
}

export function useProjectId(): string {
  return useSelector((s) => s.projectId);
}

export function useStoreDispatch(): (action: StoreAction) => void {
  const store = useStore();
  return store.dispatch;
}

export function useChatPrompt(): string | null {
  return useSelector((s) => s.chatPrompt);
}

export function useProjectName(): string {
  return useSelector((s) => s.projectName);
}

export function useRenameProject(): (name: string) => Promise<boolean> {
  const store = useStore();
  return (name: string) => store.renameProject(name);
}

export function useIncomingEmails(): IncomingEmail[] {
  return useSelector((s) => s.incomingEmails);
}

export function useHasMoreEmails(): boolean {
  return useSelector((s) => s.hasMoreEmails);
}

export function useLoadingMoreEmails(): boolean {
  return useSelector((s) => s.loadingMoreEmails);
}

export function useLoadMoreEmails(): () => void {
  const store = useStore();
  return () => store.loadMoreEmails();
}
