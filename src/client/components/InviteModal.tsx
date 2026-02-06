import { useState } from "react";
import { api } from "../lib/api.js";

export function InviteForm({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor" | "owner">("editor");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      await api.post(`/api/projects/${projectId}/invite`, {
        email: email.trim(),
        role,
      });
      setSuccess(true);
      setEmail("");
    } catch (err: any) {
      setError(err.message || "Failed to send invite");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6">
      <p className="text-sm text-text-muted mb-3">
        Invite a collaborator by email
      </p>
      <input
        autoFocus
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setSuccess(false);
        }}
        placeholder="friend@example.com"
        className="w-full py-3 px-4 bg-bg border border-border rounded-xl text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
      />
      <div className="flex gap-2 mt-3">
        {([
          ["viewer", "Read"],
          ["editor", "Read & Write"],
          ["owner", "Admin"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setRole(value)}
            className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg border transition-colors ${
              role === value
                ? "bg-accent text-white border-accent"
                : "bg-bg text-text-muted border-border hover:border-accent/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-danger mt-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-success mt-2">
          Invitation sent!
        </p>
      )}
      <div className="flex justify-end mt-4">
        <button
          type="submit"
          disabled={!email.trim() || loading}
          className="px-4 py-2 bg-accent text-white rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-colors text-sm font-medium"
        >
          {loading ? "Sending..." : "Send invite"}
        </button>
      </div>
    </form>
  );
}

export function InviteModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl p-6 w-full max-w-md border border-border shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text">
            Invite a collaborator
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
        <InviteForm projectId={projectId} />
      </div>
    </div>
  );
}
