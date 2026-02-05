import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "../lib/api.js";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

interface ProjectState {
  projectId: string;
  tree: FileNode[];
  openFilePath: string | null;
  fileContent: string | null;
  loading: boolean;
  treeLoading: boolean;
}

type ProjectAction =
  | { type: "SET_TREE"; tree: FileNode[] }
  | { type: "SET_TREE_LOADING"; loading: boolean }
  | { type: "OPEN_FILE"; path: string; content: string }
  | { type: "CLOSE_FILE" }
  | { type: "SET_CONTENT"; content: string }
  | { type: "SET_LOADING"; loading: boolean };

function reducer(state: ProjectState, action: ProjectAction): ProjectState {
  switch (action.type) {
    case "SET_TREE":
      return { ...state, tree: action.tree, treeLoading: false };
    case "SET_TREE_LOADING":
      return { ...state, treeLoading: action.loading };
    case "OPEN_FILE":
      return {
        ...state,
        openFilePath: action.path,
        fileContent: action.content,
        loading: false,
      };
    case "CLOSE_FILE":
      return { ...state, openFilePath: null, fileContent: null };
    case "SET_CONTENT":
      return { ...state, fileContent: action.content };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    default:
      return state;
  }
}

interface ProjectContextValue {
  state: ProjectState;
  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: () => void;
  saveFile: (path: string, content: string) => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (from: string, to: string) => Promise<void>;
  setContent: (content: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, {
    projectId,
    tree: [],
    openFilePath: null,
    fileContent: null,
    loading: false,
    treeLoading: true,
  });

  const refreshTree = useCallback(async () => {
    dispatch({ type: "SET_TREE_LOADING", loading: true });
    try {
      const data = await api.get<{ tree: FileNode[] }>(
        `/api/files/${projectId}/tree`
      );
      dispatch({ type: "SET_TREE", tree: data.tree });
    } catch {
      dispatch({ type: "SET_TREE_LOADING", loading: false });
    }
  }, [projectId]);

  const openFile = useCallback(
    async (path: string) => {
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        const data = await api.get<{ content: string }>(
          `/api/files/${projectId}/read?path=${encodeURIComponent(path)}`
        );
        dispatch({ type: "OPEN_FILE", path, content: data.content });
      } catch {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [projectId]
  );

  const closeFile = useCallback(() => {
    dispatch({ type: "CLOSE_FILE" });
  }, []);

  const saveFile = useCallback(
    async (path: string, content: string) => {
      await api.post(`/api/files/${projectId}/write`, { path, content });
    },
    [projectId]
  );

  const createFile = useCallback(
    async (path: string, content: string = "") => {
      await api.post(`/api/files/${projectId}/write`, { path, content });
      await refreshTree();
    },
    [projectId, refreshTree]
  );

  const createFolder = useCallback(
    async (path: string) => {
      await api.post(`/api/files/${projectId}/mkdir`, { path });
      await refreshTree();
    },
    [projectId, refreshTree]
  );

  const deleteFile = useCallback(
    async (path: string) => {
      await api.del(`/api/files/${projectId}?path=${encodeURIComponent(path)}`);
      if (state.openFilePath === path) {
        dispatch({ type: "CLOSE_FILE" });
      }
      await refreshTree();
    },
    [projectId, state.openFilePath, refreshTree]
  );

  const renameFile = useCallback(
    async (from: string, to: string) => {
      await api.post(`/api/files/${projectId}/rename`, { from, to });
      if (state.openFilePath === from) {
        await openFile(to);
      }
      await refreshTree();
    },
    [projectId, state.openFilePath, openFile, refreshTree]
  );

  const setContent = useCallback((content: string) => {
    dispatch({ type: "SET_CONTENT", content });
  }, []);

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  return (
    <ProjectContext.Provider
      value={{
        state,
        refreshTree,
        openFile,
        closeFile,
        saveFile,
        createFile,
        createFolder,
        deleteFile,
        renameFile,
        setContent,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx)
    throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
