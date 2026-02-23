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
import { useDictation } from "../hooks/useDictation.js";
import { DictationOverlay } from "./DictationOverlay.js";
import { Button } from "@/components/ui/button.js";
import { Separator } from "@/components/ui/separator.js";

interface EditorToolbarProps {
  editorViewRef: RefObject<EditorView | null>;
  showPreview: boolean;
  onTogglePreview: () => void;
  projectId: string;
  filePath: string;
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
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClick} title={title}>
      {children}
    </Button>
  );
}

export function EditorToolbar({
  editorViewRef,
  showPreview,
  onTogglePreview,
  projectId,
  filePath,
}: EditorToolbarProps) {
  const getView = () => editorViewRef.current;
  const toast = useToast();
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

            <Separator orientation="vertical" className="mx-0.5 h-5" />

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

            <Separator orientation="vertical" className="mx-0.5 h-5" />

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

            <Separator orientation="vertical" className="mx-0.5 h-5" />

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

        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${
            isRecording
              ? "text-danger recording-pulse"
              : ""
          }`}
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
        >
          <Microphone size={16} weight={isRecording ? "fill" : "regular"} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleSharePage}
          disabled={shareLoading}
          title="Share this page"
        >
          <LinkSimple size={16} />
        </Button>

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        <Button
          variant={showPreview ? "secondary" : "ghost"}
          size="sm"
          onClick={onTogglePreview}
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
        </Button>
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
