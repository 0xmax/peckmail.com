import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, StateEffect } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { useOpenFile, useStoreDispatch, useLoadFileContent, useHighlight } from "../store/StoreContext.js";

const LIVE_BROADCAST_DELAY = 30;  // ms — broadcast to other clients
const DISK_WRITE_DELAY = 500;     // ms — persist to disk

// CodeMirror effect + field for AI highlights
const setHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();

const highlightMark = Decoration.mark({ class: "cm-ai-highlight" });

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlightEffect)) {
        if (effect.value === null) {
          return Decoration.none;
        }
        return Decoration.set([
          highlightMark.range(effect.value.from, effect.value.to),
        ]);
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function Editor() {
  const { path: openFilePath, content: fileContent } = useOpenFile();
  const dispatch = useStoreDispatch();
  const loadFileContent = useLoadFileContent();
  const highlight = useHighlight();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  const lastWrittenContent = useRef<string>("");
  const lastBroadcastContent = useRef<string>("");
  const diskWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveBroadcastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLocalEdit = useRef(false);

  // Create/destroy editor
  useEffect(() => {
    if (!containerRef.current || fileContent === null) return;

    lastWrittenContent.current = fileContent;
    lastBroadcastContent.current = fileContent;

    const startState = EditorState.create({
      doc: fileContent,
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
        highlightField,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            dispatch({ type: "file:cursor", line: line.number, col: pos - line.from + 1 });
          }
          if (update.docChanged) {
            const content = update.state.doc.toString();
            dispatch({ type: "file:content", content });
            isLocalEdit.current = true;

            // Live broadcast to other clients (very fast)
            if (liveBroadcastTimer.current) clearTimeout(liveBroadcastTimer.current);
            liveBroadcastTimer.current = setTimeout(() => {
              if (!openFilePath) return;
              const latest = viewRef.current?.state.doc.toString();
              if (latest !== undefined && latest !== lastBroadcastContent.current) {
                lastBroadcastContent.current = latest;
                dispatch({ type: "file:live", path: openFilePath, content: latest });
              }
            }, LIVE_BROADCAST_DELAY);

            // Debounced disk write (less frequent)
            if (diskWriteTimer.current) clearTimeout(diskWriteTimer.current);
            diskWriteTimer.current = setTimeout(() => {
              if (!openFilePath) return;
              const latest = viewRef.current?.state.doc.toString();
              if (latest !== undefined && latest !== lastWrittenContent.current) {
                lastWrittenContent.current = latest;
                dispatch({ type: "file:write", path: openFilePath, content: latest });
              }
            }, DISK_WRITE_DELAY);
          }
        }),
        EditorView.domEventHandlers({
          contextmenu(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            const line = view.state.doc.lineAt(pos);
            event.preventDefault();
            setCtxMenu({ x: event.clientX, y: event.clientY, line: line.number });
            return true;
          },
        }),
        EditorView.theme({
          "&": {
            backgroundColor: "#ffffff",
          },
          ".cm-content": {
            caretColor: "#c4956a",
          },
          ".cm-ai-highlight": {
            backgroundColor: "#f0e6d3",
            borderRadius: "2px",
            transition: "background-color 0.3s ease",
          },
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      // Flush pending timers
      if (liveBroadcastTimer.current) clearTimeout(liveBroadcastTimer.current);
      if (diskWriteTimer.current) clearTimeout(diskWriteTimer.current);
      liveBroadcastTimer.current = null;
      diskWriteTimer.current = null;
      // Final disk write if needed
      if (viewRef.current && openFilePath) {
        const content = viewRef.current.state.doc.toString();
        if (content !== lastWrittenContent.current) {
          dispatch({ type: "file:write", path: openFilePath, content });
        }
      }
      view.destroy();
      viewRef.current = null;
    };
  }, [openFilePath, fileContent === null]); // Only recreate on file change

  // Handle external content updates (file:live / file:updated from other clients)
  useEffect(() => {
    if (!viewRef.current || fileContent === null || !openFilePath) return;

    // Skip if this was triggered by our own local edit
    if (isLocalEdit.current) {
      isLocalEdit.current = false;
      return;
    }

    const currentContent = viewRef.current.state.doc.toString();
    if (fileContent === currentContent) return;

    // Apply remote changes into the editor
    const view = viewRef.current;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: fileContent,
      },
    });
    lastWrittenContent.current = fileContent;
    lastBroadcastContent.current = fileContent;
  }, [fileContent]);

  // Close context menu on click outside / escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onClick = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // Handle AI highlight
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (highlight) {
      const doc = view.state.doc;
      const fromLine = Math.max(1, Math.min(highlight.fromLine, doc.lines));
      const toLine = Math.max(fromLine, Math.min(highlight.toLine, doc.lines));
      const from = doc.line(fromLine).from;
      const to = doc.line(toLine).to;

      view.dispatch({
        effects: [
          setHighlightEffect.of({ from, to }),
          EditorView.scrollIntoView(from, { y: "center" }),
        ],
      });
    } else {
      view.dispatch({
        effects: setHighlightEffect.of(null),
      });
    }
  }, [highlight]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Status bar */}
      <div className="flex items-center px-4 py-1.5 bg-surface border-b border-border text-xs">
        <span className="text-text-muted">{openFilePath}</span>
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
                if (openFilePath) loadFileContent(openFilePath);
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

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-text hover:bg-surface-alt transition-colors flex items-center gap-2"
            onClick={() => {
              dispatch({ type: "tts:play-from", fromLine: ctxMenu.line });
              setCtxMenu(null);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
              <path d="M4.5 2v12l9-6z" />
            </svg>
            Read from line {ctxMenu.line}
          </button>
        </div>
      )}
    </div>
  );
}
