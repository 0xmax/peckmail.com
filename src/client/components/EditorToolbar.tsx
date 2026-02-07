import { useState, useEffect, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import {
  TextB,
  TextItalic,
  TextStrikethrough,
  TextHOne,
  TextHTwo,
  TextHThree,
  ListBullets,
  ListNumbers,
  Quotes,
  Code,
  Link,
  Minus,
  Eye,
  PencilSimple,
  LinkSimple,
  SpeakerHigh,
  Microphone,
} from "@phosphor-icons/react";
import {
  wrapSelection,
  toggleHeading,
  toggleList,
  toggleBlockquote,
  insertLink,
  insertHorizontalRule,
} from "../lib/editorFormatting.js";
import { api } from "../lib/api.js";
import { useToast } from "../context/ToastContext.js";
import { useStoreDispatch } from "../store/StoreContext.js";
import { useDictation } from "../hooks/useDictation.js";
import { DictationOverlay } from "./DictationOverlay.js";

interface EditorToolbarProps {
  editorViewRef: RefObject<EditorView | null>;
  showPreview: boolean;
  onTogglePreview: () => void;
  projectId: string;
  filePath: string;
  onPlay: () => void;
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-5 bg-border mx-0.5" />;
}

export function EditorToolbar({
  editorViewRef,
  showPreview,
  onTogglePreview,
  projectId,
  filePath,
  onPlay,
}: EditorToolbarProps) {
  const getView = () => editorViewRef.current;
  const toast = useToast();
  const dispatch = useStoreDispatch();
  const [shareLoading, setShareLoading] = useState(false);
  const {
    isRecording,
    elapsed,
    error: dictationError,
    formatMode,
    setFormatMode,
    audioLevelRef,
    startDictation,
    stopDictation,
  } = useDictation();

  // Show dictation errors as toast
  useEffect(() => {
    if (dictationError) toast(dictationError);
  }, [dictationError]);

  // Keyboard shortcut: Ctrl+Shift+D to toggle dictation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        const v = getView();
        if (!v) return;
        if (isRecording) {
          stopDictation();
        } else {
          startDictation(v);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isRecording, startDictation, stopDictation]);

  const handleSharePage = async () => {
    setShareLoading(true);
    try {
      const data = await api.post<{ link: { token: string } }>(
        `/api/projects/${projectId}/share`,
        { filePath }
      );
      const url = `${window.location.origin}/s/${data.link.token}`;
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      // Ignore
    } finally {
      setShareLoading(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center px-3 py-1 bg-surface border-b border-border gap-0.5">
        {!showPreview && (
          <>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) wrapSelection(v, "**", "**"); }}
              title="Bold"
            >
              <TextB size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) wrapSelection(v, "_", "_"); }}
              title="Italic"
            >
              <TextItalic size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) wrapSelection(v, "~~", "~~"); }}
              title="Strikethrough"
            >
              <TextStrikethrough size={16} />
            </ToolbarButton>

            <Separator />

            <ToolbarButton
              onClick={() => { const v = getView(); if (v) toggleHeading(v, 1); }}
              title="Heading 1"
            >
              <TextHOne size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) toggleHeading(v, 2); }}
              title="Heading 2"
            >
              <TextHTwo size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) toggleHeading(v, 3); }}
              title="Heading 3"
            >
              <TextHThree size={16} />
            </ToolbarButton>

            <Separator />

            <ToolbarButton
              onClick={() => { const v = getView(); if (v) toggleList(v, false); }}
              title="Bullet list"
            >
              <ListBullets size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) toggleList(v, true); }}
              title="Numbered list"
            >
              <ListNumbers size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) toggleBlockquote(v); }}
              title="Blockquote"
            >
              <Quotes size={16} />
            </ToolbarButton>

            <Separator />

            <ToolbarButton
              onClick={() => { const v = getView(); if (v) wrapSelection(v, "`", "`"); }}
              title="Inline code"
            >
              <Code size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) insertLink(v); }}
              title="Insert link"
            >
              <Link size={16} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { const v = getView(); if (v) insertHorizontalRule(v); }}
              title="Horizontal rule"
            >
              <Minus size={16} />
            </ToolbarButton>
          </>
        )}

        <div className="flex-1" />

        <button
          onClick={() => {
            onPlay();
            dispatch({ type: "tts:play-from", fromLine: 0 });
          }}
          title="Read aloud"
          className="p-1.5 rounded transition-colors text-text-muted hover:text-text hover:bg-surface-alt"
        >
          <SpeakerHigh size={16} />
        </button>

        <button
          onClick={() => {
            const v = getView();
            if (!v) return;
            if (isRecording) {
              stopDictation();
            } else {
              startDictation(v);
            }
          }}
          title={isRecording ? "Stop dictation (Ctrl+Shift+D)" : "Dictate (Ctrl+Shift+D)"}
          className={`p-1.5 rounded transition-colors ${
            isRecording
              ? "text-danger recording-pulse"
              : "text-text-muted hover:text-text hover:bg-surface-alt"
          }`}
        >
          <Microphone size={16} weight={isRecording ? "fill" : "regular"} />
        </button>

        <button
          onClick={handleSharePage}
          disabled={shareLoading}
          title="Share this page"
          className="p-1.5 rounded transition-colors text-text-muted hover:text-text hover:bg-surface-alt"
        >
          <LinkSimple size={16} />
        </button>

        <Separator />

        <button
          onClick={onTogglePreview}
          className={`flex items-center gap-1.5 text-sm px-3 py-1 rounded-lg transition-colors ${
            showPreview
              ? "bg-surface-alt text-accent"
              : "text-text-muted hover:text-text hover:bg-surface-alt"
          }`}
          title={showPreview ? "Edit mode" : "Preview mode"}
        >
          {showPreview ? (
            <>
              <PencilSimple size={14} /> Edit
            </>
          ) : (
            <>
              <Eye size={14} /> Preview
            </>
          )}
        </button>
      </div>

      {/* Dictation overlay — slides down when recording */}
      {isRecording && (
        <DictationOverlay
          elapsed={elapsed}
          formatMode={formatMode}
          onSetFormatMode={setFormatMode}
          audioLevelRef={audioLevelRef}
          onStop={stopDictation}
        />
      )}
    </div>
  );
}
