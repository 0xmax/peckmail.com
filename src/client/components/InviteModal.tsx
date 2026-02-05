import { useState } from "react";
import { api } from "../lib/api.js";

export function InviteModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
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
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl p-6 w-full max-w-md border border-border shadow-xl">
        <h2 className="text-lg font-semibold text-text mb-4">
          Invite a collaborator
        </h2>
        <form onSubmit={handleSubmit}>
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
          {error && (
            <p className="text-sm text-danger mt-2">{error}</p>
          )}
          {success && (
            <p className="text-sm text-success mt-2">
              Invitation sent!
            </p>
          )}
          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
            >
              {success ? "Done" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={!email.trim() || loading}
              className="px-4 py-2 bg-accent text-white rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-colors text-sm font-medium"
            >
              {loading ? "Sending..." : "Send invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
