import { useRef, useEffect } from "react";
import { useTheme } from "../context/ThemeContext.js";

export function EmailIframe({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Inject a script that posts its body height to the parent via postMessage.
  // The sandbox includes allow-scripts so this runs, but NOT allow-same-origin
  // so the iframe still can't touch the parent DOM or cookies.
  const resizeScript = `
<script>
function postHeight() {
  var h = document.documentElement.scrollHeight;
  window.parent.postMessage({ __emailHeight: h }, "*");
}
new ResizeObserver(postHeight).observe(document.body);
window.addEventListener("load", postHeight);
postHeight();
</script>`;

  const srcDoc = `<!DOCTYPE html>
<html>
<head>
<style>
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
    ${isDark ? "color-scheme: dark; color: #e4e4e7; background: transparent;" : "color: #18181b; background: transparent;"}
  }
  a { color: ${isDark ? "#60a5fa" : "#2563eb"}; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>${html}${resizeScript}</body>
</html>`;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      const h = e.data?.__emailHeight;
      if (typeof h === "number" && h > 0) {
        iframe.style.height = h + "px";
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      style={{ width: "100%", border: "none", minHeight: 200, display: "block" }}
    />
  );
}
