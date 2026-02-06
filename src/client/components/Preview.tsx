import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { marked } from "marked";
import {
  useHighlight,
  useProjectSettings,
  useTtsPlayback,
} from "../store/StoreContext.js";

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface Block {
  html: string;
  startLine: number;
  endLine: number;
}

interface ReadLineMetrics {
  top: number;
  height: number;
}

function lineMetricsFromRect(
  blockEl: HTMLElement,
  rect: DOMRect | null | undefined
): ReadLineMetrics | null {
  if (!rect) return null;
  const hostRect = blockEl.getBoundingClientRect();
  if (hostRect.height <= 0 || rect.height <= 0) return null;

  const computed = window.getComputedStyle(blockEl);
  const lineHeight = Number.parseFloat(computed.lineHeight);
  const effectiveHeight = Number.isFinite(lineHeight)
    ? Math.max(rect.height, lineHeight)
    : Math.max(rect.height, 18);
  const top = Math.max(
    0,
    Math.min(hostRect.height - effectiveHeight, rect.top - hostRect.top)
  );

  return {
    top,
    height: effectiveHeight,
  };
}

function lineMetricsFromTextOffset(
  blockEl: HTMLElement,
  targetOffset: number
): ReadLineMetrics | null {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let totalChars = 0;
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (textNode.data.length > 0) {
      textNodes.push(textNode);
      totalChars += textNode.data.length;
    }
    node = walker.nextNode();
  }

  if (textNodes.length === 0 || totalChars === 0) return null;

  let remaining = Math.max(0, Math.min(totalChars - 1, targetOffset));
  let targetNode = textNodes[textNodes.length - 1];
  let offset = Math.max(0, targetNode.data.length - 1);

  for (const textNode of textNodes) {
    if (remaining < textNode.data.length) {
      targetNode = textNode;
      offset = remaining;
      break;
    }
    remaining -= textNode.data.length;
  }

  const range = document.createRange();
  range.setStart(targetNode, offset);
  range.setEnd(targetNode, Math.min(targetNode.data.length, offset + 1));
  let rect = range.getClientRects()[0] || range.getBoundingClientRect();

  if ((rect.width <= 0 && rect.height <= 0) || !Number.isFinite(rect.top)) {
    const start = Math.max(0, offset - 1);
    range.setStart(targetNode, start);
    range.setEnd(targetNode, Math.max(start + 1, offset));
    rect = range.getClientRects()[0] || range.getBoundingClientRect();
  }

  return lineMetricsFromRect(blockEl, rect);
}

function lineSearchCandidates(line: string): string[] {
  const raw = line.replace(/\s+/g, " ").trim();
  const light = raw
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const plain = light
    .replace(/[#>*_\-\[\]\(\)`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [raw, light, plain]) {
    if (!candidate || candidate.length < 3) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function findCandidateOffset(blockText: string, candidates: string[]): number | null {
  const lowerBlock = blockText.toLowerCase();
  for (const candidate of candidates) {
    const idx = lowerBlock.indexOf(candidate.toLowerCase());
    if (idx >= 0) return idx;
  }
  return null;
}

function sentenceSearchCandidates(sentence: string): string[] {
  const raw = sentence.replace(/\s+/g, " ").trim();
  const clean = raw
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [raw, clean]) {
    if (!candidate || candidate.length < 2) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function highlightTextInElement(root: Element, text: string): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let accumulated = "";

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    textNodes.push(node);
    accumulated += node.textContent || "";
  }

  const idx = accumulated.toLowerCase().indexOf(text.toLowerCase());
  if (idx === -1) return null;

  let pos = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;

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

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const fragment = range.extractContents();
    const mark = document.createElement("span");
    mark.className = "sentence-hl";
    mark.appendChild(fragment);
    range.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
}

function clearSentenceHighlights(root: ParentNode) {
  root.querySelectorAll(".sentence-hl").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
}

function clearReadStyles(el: HTMLDivElement) {
  el.style.removeProperty("--read-line-top");
  el.style.removeProperty("--read-line-height");
  delete el.dataset.readLineReady;
}

function parseBlocks(content: string): Block[] {
  if (!content) return [];
  const tokens = marked.lexer(content);
  const blocks: Block[] = [];
  let line = 1;

  for (const token of tokens) {
    const raw = token.raw || "";
    if (token.type === "space") {
      line += (raw.match(/\n/g) || []).length;
      continue;
    }

    const startLine = line;
    const newlines = (raw.match(/\n/g) || []).length;
    const endLine = line + newlines;
    const html = marked.parser([token] as any) as string;

    if (html.trim()) {
      blocks.push({ html, startLine, endLine });
    }

    line = endLine;
  }

  return blocks;
}

export function Preview({ content }: { content: string }) {
  const highlight = useHighlight();
  const projectSettings = useProjectSettings();
  const simpleMode = Boolean(projectSettings.tts?.simpleMode);
  const ttsPlayback = useTtsPlayback();
  const containerRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastActiveIndex = useRef<number | null>(null);
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const contentLines = useMemo(() => content.split("\n"), [content]);
  const sentenceText = useMemo(() => {
    if (!highlight) return null;
    if (
      typeof highlight.fromChar !== "number" ||
      typeof highlight.toChar !== "number" ||
      highlight.toChar <= highlight.fromChar
    ) {
      return null;
    }
    const raw = content.slice(highlight.fromChar, highlight.toChar);
    if (!raw.trim()) return null;
    const candidates = sentenceSearchCandidates(raw);
    return candidates[0] ?? null;
  }, [content, highlight]);

  const activeIndex = highlight
    ? blocks.findIndex((b) => highlight.fromLine >= b.startLine && highlight.fromLine <= b.endLine)
    : -1;

  useLayoutEffect(() => {
    if (containerRef.current) {
      clearSentenceHighlights(containerRef.current);
    }

    for (let i = 0; i < blockRefs.current.length; i++) {
      const el = blockRefs.current[i];
      if (!el || i === activeIndex) continue;
      clearReadStyles(el);
    }

    if (activeIndex < 0 || !highlight) return;
    const block = blocks[activeIndex];
    const blockEl = blockRefs.current[activeIndex];
    if (!block || !blockEl) return;

    let metrics: ReadLineMetrics | null = null;
    if (sentenceText) {
      const marker = highlightTextInElement(blockEl, sentenceText);
      if (marker) {
        metrics = lineMetricsFromRect(blockEl, marker.getBoundingClientRect());
      }
    }
    if (simpleMode) {
      clearReadStyles(blockEl);
      return;
    }
    if (!metrics) {
      const sourceLine = contentLines[Math.max(0, highlight.fromLine - 1)] ?? "";
      const candidates = lineSearchCandidates(sourceLine);
      const blockText = blockEl.textContent || "";
      const offset = candidates.length > 0
        ? findCandidateOffset(blockText, candidates)
        : null;
      metrics = lineMetricsFromTextOffset(blockEl, offset ?? 0);
    }

    if (!metrics) {
      blockEl.dataset.readLineReady = "false";
      return;
    }

    blockEl.style.setProperty("--read-line-top", `${metrics.top.toFixed(2)}px`);
    blockEl.style.setProperty(
      "--read-line-height",
      `${metrics.height.toFixed(2)}px`
    );
    blockEl.dataset.readLineReady = "true";
  }, [activeIndex, blocks, contentLines, highlight, sentenceText, simpleMode]);

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

  return (
    <div className="flex-1 overflow-y-auto bg-white" ref={containerRef}>
      <article className="preview-content max-w-[760px] mx-auto px-8 py-10">
        {blocks.map((block, i) => {
          const isActive = i === activeIndex;
          const isPlaybackActive =
            !simpleMode && isActive && Boolean(ttsPlayback?.playing);
          const showBlockHighlight = isActive && !simpleMode;

          return (
            <div
              key={i}
              ref={(el) => {
                blockRefs.current[i] = el;
              }}
              data-active={isActive || undefined}
              className={`preview-block transition-colors duration-200 ${
                showBlockHighlight ? "preview-block-active" : ""
              } ${isPlaybackActive ? "preview-block-reading" : ""}`}
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          );
        })}
      </article>
    </div>
  );
}
