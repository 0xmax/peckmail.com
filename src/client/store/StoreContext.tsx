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
import type { StoreState, StoreAction, FileNode, ChatMessage, ChatSession, ProjectSettings, TtsPlayback } from "./types.js";

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
    store.loadTree();
    store.loadChatSessions();
    store.loadSettings();

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

export function useTree(): { tree: FileNode[]; loading: boolean } {
  const tree = useSelector((s) => s.tree);
  const loading = useSelector((s) => s.treeLoading);
  return { tree, loading };
}

export function useOpenFile(): {
  path: string | null;
  content: string | null;
  loading: boolean;
} {
  const path = useSelector((s) => s.openFilePath);
  const content = useSelector((s) => s.fileContent);
  const loading = useSelector((s) => s.fileLoading);
  return { path, content, loading };
}

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

export function useHighlight(): { fromLine: number; toLine: number } | null {
  return useSelector((s) => s.highlight);
}

export function useTtsPlayback(): TtsPlayback | null {
  return useSelector((s) => s.ttsPlayback);
}

export function useTtsFromLine(): number | null {
  return useSelector((s) => s.ttsFromLine);
}

export function useProjectSettings(): ProjectSettings {
  return useSelector((s) => s.projectSettings);
}

export function useLoadFileContent(): (path: string) => Promise<void> {
  const store = useStore();
  return (path: string) => store.loadFileContent(path);
}
