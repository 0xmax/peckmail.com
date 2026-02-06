import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useHighlight,
  useProjectSettings,
} from "../store/StoreContext.js";

interface SourceLine {
  lineNumber: number;
  text: string;
  startChar: number;
  endChar: number;
  isBlank: boolean;
}

interface ParagraphRange {
  startLine: number;
  endLine: number;
}

type MarkdownKind =
  | "plain"
  | "heading"
  | "blockquote"
  | "unordered-list"
  | "ordered-list"
  | "rule";

interface MarkdownLinePresentation {
  kind: MarkdownKind;
  marker: string;
  body: string;
  headingLevel?: number;
}

function buildSourceLines(content: string): SourceLine[] {
  const rawLines = content.split("\n");
  let charCursor = 0;
  return rawLines.map((text, index) => {
    const startChar = charCursor;
    const endChar = startChar + text.length;
    charCursor = endChar + 1;
    return {
      lineNumber: index + 1,
      text,
      startChar,
      endChar,
      isBlank: text.trim().length === 0,
    };
  });
}

function getParagraphRange(
  sourceLines: SourceLine[],
  lineNumber: number
): ParagraphRange | null {
  if (lineNumber < 1 || lineNumber > sourceLines.length) return null;
  const target = sourceLines[lineNumber - 1];
  if (!target) return null;
  if (target.isBlank) {
    return { startLine: lineNumber, endLine: lineNumber };
  }

  let startLine = lineNumber;
  let endLine = lineNumber;

  while (startLine > 1 && !sourceLines[startLine - 2].isBlank) {
    startLine -= 1;
  }
  while (endLine < sourceLines.length && !sourceLines[endLine].isBlank) {
    endLine += 1;
  }

  return { startLine, endLine };
}

function parseMarkdownLine(text: string): MarkdownLinePresentation {
  const headingMatch = text.match(/^(\s{0,3}#{1,6}\s+)(.*)$/);
  if (headingMatch) {
    const marker = headingMatch[1];
    const levelMatch = marker.match(/#{1,6}/);
    return {
      kind: "heading",
      marker,
      body: headingMatch[2] ?? "",
      headingLevel: levelMatch ? levelMatch[0].length : 1,
    };
  }

  const quoteMatch = text.match(/^(\s{0,3}>\s?)(.*)$/);
  if (quoteMatch) {
    return {
      kind: "blockquote",
      marker: quoteMatch[1],
      body: quoteMatch[2] ?? "",
    };
  }

  const trimmed = text.trim();
  if (trimmed.length > 0 && /^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
    return {
      kind: "rule",
      marker: text,
      body: "",
    };
  }

  const unorderedListMatch = text.match(/^(\s*[-+*]\s+)(.*)$/);
  if (unorderedListMatch) {
    return {
      kind: "unordered-list",
      marker: unorderedListMatch[1],
      body: unorderedListMatch[2] ?? "",
    };
  }

  const orderedListMatch = text.match(/^(\s*\d+\.\s+)(.*)$/);
  if (orderedListMatch) {
    return {
      kind: "ordered-list",
      marker: orderedListMatch[1],
      body: orderedListMatch[2] ?? "",
    };
  }

  return {
    kind: "plain",
    marker: "",
    body: text,
  };
}

function markdownClass(markdown: MarkdownLinePresentation): string {
  switch (markdown.kind) {
    case "heading":
      return `preview-line-heading preview-line-heading-${markdown.headingLevel ?? 1}`;
    case "blockquote":
      return "preview-line-blockquote";
    case "unordered-list":
      return "preview-line-list";
    case "ordered-list":
      return "preview-line-list preview-line-list-ordered";
    case "rule":
      return "preview-line-rule";
    default:
      return "";
  }
}

function highlightRangeInElement(
  root: Element,
  fromOffset: number,
  toOffset: number
): HTMLElement | null {
  const fullText = root.textContent || "";
  const safeFrom = Math.max(0, Math.min(fullText.length, fromOffset));
  const safeTo = Math.max(safeFrom, Math.min(fullText.length, toOffset));
  if (safeTo <= safeFrom) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }
  if (textNodes.length === 0) return null;

  let pos = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;

  for (const node of textNodes) {
    const len = node.textContent?.length || 0;
    if (!startNode && pos + len > safeFrom) {
      startNode = node;
      startOffset = safeFrom - pos;
    }
    if (!endNode && pos + len >= safeTo) {
      endNode = node;
      endOffset = safeTo - pos;
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

/** Parse a single CSV line respecting quoted fields */
function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvRow(lines[0]);
  const rows = lines.slice(1).map(parseCsvRow);
  return { headers, rows };
}

function CsvPreview({ content }: { content: string }) {
  const { headers, rows } = useMemo(() => parseCsv(content), [content]);

  if (headers.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-[960px] mx-auto px-6 py-8 text-text-muted">
          Empty CSV file
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-white">
      <div className="max-w-[960px] mx-auto px-6 py-8">
        <table className="csv-table">
          <thead>
            <tr>
              <th className="csv-row-num">#</th>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="csv-row-num">{ri + 1}</td>
                {headers.map((_, ci) => (
                  <td key={ci}>{row[ci] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 text-sm text-text-muted">
          {rows.length} {rows.length === 1 ? "row" : "rows"} · {headers.length}{" "}
          {headers.length === 1 ? "column" : "columns"}
        </div>
      </div>
    </div>
  );
}

export function Preview({
  content,
  filePath,
}: {
  content: string;
  filePath?: string;
}) {
  const isCsv = filePath?.toLowerCase().endsWith(".csv");

  if (isCsv) {
    return <CsvPreview content={content} />;
  }

  return <MarkdownPreview content={content} />;
}

function MarkdownPreview({ content }: { content: string }) {
  const highlight = useHighlight();
  const projectSettings = useProjectSettings();
  const simpleMode = Boolean(projectSettings.tts?.simpleMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastActiveLine = useRef<number | null>(null);
  const sourceLines = useMemo(() => buildSourceLines(content), [content]);
  const markdownLines = useMemo(
    () => sourceLines.map((line) => parseMarkdownLine(line.text)),
    [sourceLines]
  );
  const activeLineNumber = highlight?.fromLine ?? -1;
  const activeLineIndex =
    activeLineNumber >= 1 && activeLineNumber <= markdownLines.length
      ? activeLineNumber - 1
      : -1;
  const paragraphRange = useMemo(() => {
    if (!highlight) return null;
    return getParagraphRange(sourceLines, highlight.fromLine);
  }, [highlight, sourceLines]);
  const fromChar =
    highlight && typeof highlight.fromChar === "number"
      ? highlight.fromChar
      : null;
  const toChar =
    highlight && typeof highlight.toChar === "number" ? highlight.toChar : null;
  const hasCharRange =
    fromChar !== null && toChar !== null && Number.isFinite(fromChar) && Number.isFinite(toChar) && toChar > fromChar;

  useEffect(() => {
    lineRefs.current.length = markdownLines.length;
  }, [markdownLines.length]);

  useLayoutEffect(() => {
    if (containerRef.current) {
      clearSentenceHighlights(containerRef.current);
    }

    if (hasCharRange && fromChar !== null && toChar !== null) {
      for (let i = 0; i < sourceLines.length; i++) {
        const line = sourceLines[i];
        const lineEl = lineRefs.current[i];
        if (!lineEl || line.endChar <= line.startChar) continue;
        const segmentStart = Math.max(fromChar, line.startChar);
        const segmentEnd = Math.min(toChar, line.endChar);
        if (segmentEnd <= segmentStart) continue;
        const localFrom = segmentStart - line.startChar;
        const localTo = segmentEnd - line.startChar;
        highlightRangeInElement(lineEl, localFrom, localTo);
      }
    }
  }, [
    fromChar,
    hasCharRange,
    sourceLines,
    toChar,
  ]);

  // Scroll highlighted line into view only when the active line changes
  useEffect(() => {
    if (activeLineIndex < 0) {
      lastActiveLine.current = null;
      return;
    }
    const nextActiveLine = sourceLines[activeLineIndex]?.lineNumber ?? null;
    if (nextActiveLine === null) return;
    if (lastActiveLine.current === nextActiveLine) return;
    lastActiveLine.current = nextActiveLine;
    const lineEl = lineRefs.current[activeLineIndex];
    if (lineEl) {
      lineEl.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeLineIndex, sourceLines]);

  return (
    <div className="flex-1 overflow-y-auto bg-white" ref={containerRef}>
      <article className="preview-content max-w-[760px] mx-auto px-6 py-8">
        {sourceLines.map((line, i) => {
          const isActive = i === activeLineIndex;
          const isParagraphActive =
            !simpleMode &&
            !!paragraphRange &&
            line.lineNumber >= paragraphRange.startLine &&
            line.lineNumber <= paragraphRange.endLine;
          const markdown = markdownLines[i];

          return (
            <div
              key={line.lineNumber}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              data-active={isActive || undefined}
              className={`preview-line transition-colors duration-200 ${
                isParagraphActive ? "preview-line-paragraph-active" : ""
              } ${isActive && !simpleMode ? "preview-line-active" : ""} ${
                line.isBlank ? "preview-line-blank" : ""
              } ${markdownClass(markdown)}`}
            >
              <span className="preview-line-text">
                {markdown.kind === "plain" ? (
                  line.text
                ) : (
                  <>
                    <span className="preview-md-marker">{markdown.marker}</span>
                    <span className="preview-md-body">{markdown.body}</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </article>
    </div>
  );
}
