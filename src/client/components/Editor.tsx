import { useEffect, useRef, useCallback, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { useProject } from "../context/ProjectContext.js";
import { useWsMessage } from "../hooks/useWebSocket.js";

export function Editor() {
  const { state, saveFile, openFile, setContent } = useProject();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const lastSavedContent = useRef<string>("");

  // Save handler
  const handleSave = useCallback(async () => {
    if (!state.openFilePath || !viewRef.current) return;
    const content = viewRef.current.state.doc.toString();
    setSaving(true);
    try {
      await saveFile(state.openFilePath, content);
      lastSavedContent.current = content;
      setDirty(false);
    } catch {
      setToast("Failed to save — try again");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [state.openFilePath, saveFile]);

  // Create/destroy editor
  useEffect(() => {
    if (!containerRef.current || state.fileContent === null) return;

    lastSavedContent.current = state.fileContent;

    const startState = EditorState.create({
      doc: state.fileContent,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        highlightSelectionMatches(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle),
        markdown({ codeLanguages: languages }),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              handleSave();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const content = update.state.doc.toString();
            setContent(content);
            setDirty(content !== lastSavedContent.current);
          }
        }),
        EditorView.theme({
          "&": {
            backgroundColor: "#ffffff",
          },
          ".cm-content": {
            caretColor: "#b48ead",
          },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;
    setDirty(false);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [state.openFilePath, state.fileContent === null]); // Only recreate on file change

  // Handle external file changes
  const handleFileChanged = useCallback(
    (msg: { path: string }) => {
      if (msg.path !== state.openFilePath) return;
      if (!dirty) {
        // Clean editor — silently reload
        openFile(msg.path);
      } else {
        // Dirty editor — show toast
        setToast("This page was updated — reload to see changes");
      }
    },
    [state.openFilePath, dirty, openFile]
  );

  useWsMessage("file:changed", handleFileChanged);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-surface border-b border-border text-xs">
        <div className="flex items-center gap-2 text-text-muted">
          <span>{state.openFilePath}</span>
          {dirty && (
            <span className="text-accent font-medium">· Unsaved</span>
          )}
          {saving && <span className="text-text-muted">Saving...</span>}
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-3 py-1 bg-accent text-white rounded-md text-xs hover:bg-accent-hover disabled:opacity-40 transition-colors"
        >
          Save
        </button>
      </div>

      {/* Editor container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-text text-surface px-4 py-2 rounded-xl text-sm shadow-lg toast-enter flex items-center gap-3">
          <span>{toast}</span>
          {toast.includes("reload") && (
            <button
              onClick={() => {
                if (state.openFilePath) openFile(state.openFilePath);
                setToast(null);
              }}
              className="text-accent font-medium hover:underline"
            >
              Reload
            </button>
          )}
          <button
            onClick={() => setToast(null)}
            className="text-text-muted hover:text-surface ml-1"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
