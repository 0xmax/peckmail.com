import { useRef, useEffect } from "react";
import { useTheme } from "../context/ThemeContext.js";

export function EmailIframe({ html }: { html: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (!shadowRef.current) {
      shadowRef.current = host.attachShadow({ mode: "open" });
    }
    const shadow = shadowRef.current;

    shadow.innerHTML = `<style>
  :host { display: block; }
  *, *::before, *::after { box-sizing: border-box; }
  body, div, p, span, h1, h2, h3, h4, h5, h6, table, td, th {
    margin: 0;
    padding: 0;
  }
  :host {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
    ${isDark ? "color-scheme: dark; color: #e4e4e7;" : "color: #18181b;"}
  }
  a { color: ${isDark ? "#60a5fa" : "#2563eb"}; }
  img { max-width: 100%; height: auto; }
</style>
<div id="email-content">${html}</div>`;

    // Make all links open in new tabs
    shadow.querySelectorAll("a[href]").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  }, [html, isDark]);

  return <div ref={hostRef} />;
}
