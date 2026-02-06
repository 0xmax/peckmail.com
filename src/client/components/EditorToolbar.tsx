import type { RefObject } from "react";
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
} from "@phosphor-icons/react";
import {
  wrapSelection,
  toggleHeading,
  toggleList,
  toggleBlockquote,
  insertLink,
  insertHorizontalRule,
} from "../lib/editorFormatting.js";

interface EditorToolbarProps {
  editorViewRef: RefObject<EditorView | null>;
  showPreview: boolean;
  onTogglePreview: () => void;
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
}: EditorToolbarProps) {
  const getView = () => editorViewRef.current;

  return (
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
  );
}
