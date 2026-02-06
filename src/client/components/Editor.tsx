import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, StateEffect, Compartment } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import {
  useOpenFile,
  useStoreDispatch,
  useLoadFileContent,
  useHighlight,
  useProjectSettings,
  useTtsPlayback,
} from "../store/StoreContext.js";
import { Play } from "@phosphor-icons/react";

const LIVE_BROADCAST_DELAY = 30;  // ms — broadcast to other clients
const DISK_WRITE_DELAY = 500;     // ms — persist to disk

// CodeMirror effect + field for AI/TTS highlights (line decoration for full-line highlight)
const setHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();

const highlightLineDeco = Decoration.line({ class: "cm-ai-highlight" });

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
        const doc = tr.state.doc;
        const decos: any[] = [];
        const fromLine = doc.lineAt(effect.value.from).number;
        const toLine = doc.lineAt(effect.value.to).number;
        for (let i = fromLine; i <= toLine; i++) {
          decos.push(highlightLineDeco.range(doc.line(i).from));
        }
        return Decoration.set(decos);
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
  const projectSettings = useProjectSettings();
  const simpleMode = Boolean(projectSettings.tts?.simpleMode);
  const ttsPlayback = useTtsPlayback();
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const playbackRef = useRef(ttsPlayback);
  playbackRef.current = ttsPlayback;
  const wrapCompartment = useRef(new Compartment());
  const [wordWrap, setWordWrap] = useState(true);
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
        wrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
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
            maxWidth: "760px",
            margin: "0 auto",
            padding: "2rem 1.5rem",
            fontFamily: "'Georgia', 'Times New Roman', serif",
            fontSize: "16px",
            lineHeight: "1.75",
          },
          ".cm-line": {
            padding: "0",
          },
          ".cm-ai-highlight": {
            backgroundColor: "rgba(196, 149, 106, 0.1)",
            borderLeft: "3px solid #c4956a",
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

  // Toggle word wrap
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: wrapCompartment.current.reconfigure(
        wordWrap ? EditorView.lineWrapping : []
      ),
    });
  }, [wordWrap]);

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

  // Handle AI / TTS paragraph highlight
  const lastScrolledLine = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (highlight) {
      const doc = view.state.doc;
      const fromLine = Math.max(1, Math.min(highlight.fromLine, doc.lines));
      const toLine = Math.max(fromLine, Math.min(highlight.toLine, doc.lines));
      const from = doc.line(fromLine).from;
      const to = doc.line(toLine).to;

      const effects: any[] = [setHighlightEffect.of({ from, to })];
      if (lastScrolledLine.current !== fromLine) {
        lastScrolledLine.current = fromLine;
        effects.push(EditorView.scrollIntoView(from, { y: "center" }));
      }
      view.dispatch({ effects });
    } else {
      lastScrolledLine.current = null;
      view.dispatch({ effects: setHighlightEffect.of(null) });
    }
  }, [highlight]);

  // Animated TTS cursor
  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    if (simpleMode || !ttsPlayback) {
      cursor.style.opacity = "0";
      return;
    }

    let animId: number;
    const animate = () => {
      const pb = playbackRef.current;
      const view = viewRef.current;
      const wrapper = wrapperRef.current;
      if (!pb || !view || !cursor || !wrapper) return;

      const now = Date.now();
      const elapsed = pb.playing
        ? pb.elapsed + (now - pb.dispatchedAt) / 1000
        : pb.elapsed;
      const progress = Math.min(1, Math.max(0, elapsed / pb.duration));
      const charPos = Math.floor(pb.fromChar + progress * (pb.toChar - pb.fromChar));
      const clampedPos = Math.min(charPos, view.state.doc.length);

      const coords = view.coordsAtPos(clampedPos);
      if (coords) {
        const rect = wrapper.getBoundingClientRect();
        cursor.style.opacity = "1";
        cursor.style.transform = `translate(${coords.left - rect.left}px, ${coords.top - rect.top}px)`;
        cursor.style.height = `${coords.bottom - coords.top}px`;
      } else {
        cursor.style.opacity = "0";
      }

      if (progress < 1 && pb.playing) {
        animId = requestAnimationFrame(animate);
      }
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [simpleMode, ttsPlayback]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-surface border-b border-border text-xs">
        <span className="text-text-muted">{openFilePath}</span>
        <button
          onClick={() => setWordWrap((w) => !w)}
          className={`px-2 py-0.5 rounded transition-colors ${
            wordWrap ? "text-accent" : "text-text-muted hover:text-text"
          }`}
          title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
        >
          Wrap
        </button>
      </div>

      {/* Editor container */}
      <div ref={wrapperRef} className="flex-1 overflow-hidden relative">
        <div ref={containerRef} className="h-full" />
        <div ref={cursorRef} className="tts-cursor" style={{ opacity: 0 }} />
      </div>

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
            <Play size={14} weight="fill" className="shrink-0" />
            Read from line {ctxMenu.line}
          </button>
        </div>
      )}
    </div>
  );
}
