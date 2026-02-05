import { useCallback } from "react";
import { useProject } from "../context/ProjectContext.js";
import { useWsMessage } from "./useWebSocket.js";

export function useFileTree() {
  const { state, refreshTree, openFile } = useProject();

  // Auto-refresh tree when files change via WS
  const handleFileChanged = useCallback(() => {
    refreshTree();
  }, [refreshTree]);

  useWsMessage("file:changed", handleFileChanged);

  return {
    tree: state.tree,
    loading: state.treeLoading,
    refreshTree,
    openFile,
  };
}
