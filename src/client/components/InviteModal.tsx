import { useState } from "react";
import { api } from "../lib/api.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";

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
      <p className="text-sm text-muted-foreground mb-3">
        Invite a collaborator by email
      </p>
      <Input
        autoFocus
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setSuccess(false);
        }}
        placeholder="friend@example.com"
      />
      <div className="flex gap-2 mt-3">
        {(
          [
            ["viewer", "Read"],
            ["editor", "Read & Write"],
            ["owner", "Admin"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={role === value ? "default" : "outline"}
            size="sm"
            onClick={() => setRole(value)}
            className="flex-1"
          >
            {label}
          </Button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-destructive mt-2">{error}</p>
      )}
      {success && (
        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
          Invitation sent!
        </p>
      )}
      <div className="flex justify-end mt-4">
        <Button
          type="submit"
          disabled={!email.trim() || loading}
        >
          {loading ? "Sending..." : "Send invite"}
        </Button>
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a collaborator</DialogTitle>
        </DialogHeader>
        <InviteForm projectId={projectId} />
      </DialogContent>
    </Dialog>
  );
}
