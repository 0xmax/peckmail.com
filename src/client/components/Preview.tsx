import { useMemo, useEffect, useRef } from "react";
import { marked } from "marked";
import { useHighlight } from "../store/StoreContext.js";

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface Block {
  html: string;
  startLine: number;
  endLine: number;
}

function parseBlocks(content: string): Block[] {
  if (!content) return [];
  const tokens = marked.lexer(content);
  const blocks: Block[] = [];
  let line = 1;

  for (const token of tokens) {
    if (token.type === "space") {
      line += (token.raw.match(/\n/g) || []).length;
      continue;
    }
    const startLine = line;
    const newlines = (token.raw.match(/\n/g) || []).length;
    const endLine = line + newlines;
    const html = marked.parser([token] as any) as string;
    if (html.trim()) {
      blocks.push({ html, startLine, endLine });
    }
    line = endLine;
  }

  return blocks;
}

/** Find a text substring inside a DOM element and wrap it in a <span> */
function highlightTextInElement(root: Element, text: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let accumulated = "";

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
    accumulated += (walker.currentNode as Text).textContent || "";
  }

  const accLower = accumulated.toLowerCase();
  const searchLower = text.toLowerCase();
  const idx = accLower.indexOf(searchLower);
  if (idx === -1) return;

  // Find which text nodes contain the range
  let pos = 0;
  let startNode: Text | null = null, startOffset = 0;
  let endNode: Text | null = null, endOffset = 0;

  for (const node of textNodes) {
    const len = node.textContent?.length || 0;
    if (!startNode && pos + len > idx) {
      startNode = node;
      startOffset = idx - pos;
    }
    if (!endNode && pos + len >= idx + text.length) {
      endNode = node;
      endOffset = idx + text.length - pos;
      break;
    }
    pos += len;
  }

  if (!startNode || !endNode) return;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const fragment = range.extractContents();
    const mark = document.createElement("span");
    mark.className = "sentence-hl";
    mark.appendChild(fragment);
    range.insertNode(mark);
  } catch {
    // Range spanning complex elements — skip gracefully
  }
}

export function Preview({ content }: { content: string }) {
  const highlight = useHighlight();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActiveIndex = useRef<number | null>(null);
  const blocks = useMemo(() => parseBlocks(content), [content]);

  const activeIndex = highlight
    ? blocks.findIndex((b) => highlight.fromLine >= b.startLine && highlight.fromLine <= b.endLine)
    : -1;

  // Extract the sentence text from the raw content using character offsets
  const sentenceText = useMemo(() => {
    if (!highlight?.fromChar || !highlight?.toChar) return null;
    return content.slice(highlight.fromChar, highlight.toChar)
      .replace(/[*_`#\[\]]/g, "")
      .trim();
  }, [content, highlight?.fromChar, highlight?.toChar]);

  // Scroll highlighted block into view only when the active block changes
  useEffect(() => {
    if (activeIndex < 0 || !containerRef.current) return;
    if (lastActiveIndex.current === activeIndex) return;
    lastActiveIndex.current = activeIndex;
    const el = containerRef.current.querySelector("[data-active='true']");
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeIndex]);

  // Sentence-level highlight via DOM manipulation
  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous sentence highlights
    containerRef.current.querySelectorAll(".sentence-hl").forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
      }
    });

    if (activeIndex < 0 || !sentenceText) return;

    const blockEl = containerRef.current.querySelector("[data-active='true']");
    if (blockEl) {
      highlightTextInElement(blockEl, sentenceText);
    }
  }, [activeIndex, sentenceText]);

  return (
    <div className="flex-1 overflow-y-auto bg-white" ref={containerRef}>
      <article className="preview-content max-w-[760px] mx-auto px-8 py-10">
        {blocks.map((block, i) => {
          const isActive = i === activeIndex;
          return (
            <div
              key={i}
              data-active={isActive || undefined}
              className={`preview-block transition-colors duration-200 ${
                isActive ? "preview-block-active" : ""
              }`}
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          );
        })}
      </article>
    </div>
  );
}
