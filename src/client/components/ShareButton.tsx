import { useState } from "react";
import { LinkSimple } from "@phosphor-icons/react";
import { api } from "../lib/api.js";

export function ShareButton({
  projectId,
  filePath,
}: {
  projectId: string;
  filePath: string;
}) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    try {
      const data = await api.post<{ link: { token: string } }>(
        `/api/projects/${projectId}/share`,
        { filePath }
      );
      const url = `${window.location.origin}/s/${data.link.token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={loading}
      title={copied ? "Link copied!" : "Share"}
      className={`p-2 rounded-lg transition-colors ${
        copied
          ? "text-accent bg-surface-alt"
          : "text-text-muted hover:text-text hover:bg-surface-alt"
      }`}
    >
      <LinkSimple size={16} />
    </button>
  );
}
