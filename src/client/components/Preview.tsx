import { useEffect, useMemo, useRef } from "react";
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

export function Preview({ content }: { content: string }) {
  const highlight = useHighlight();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActiveIndex = useRef<number | null>(null);
  const blocks = useMemo(() => parseBlocks(content), [content]);

  const activeIndex = highlight
    ? blocks.findIndex((b) => highlight.fromLine >= b.startLine && highlight.fromLine <= b.endLine)
    : -1;

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
