import { useState } from "react";
import { api } from "../lib/api.js";
import { SpinnerGap } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog.js";
import { Label } from "@/components/ui/label.js";

export function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.post<{
        project: { id: string; name: string };
      }>("/api/projects", { name: name.trim(), mode: "empty" });
      onCreated(data.project);
    } catch (err: any) {
      setError(err.message || "Failed to create workspace");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <div className="px-1 pt-1 pb-2">
          <h2 className="text-lg font-semibold text-foreground">
            New workspace
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Create a new workspace for your newsletter subscriptions.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <Label className="mb-1.5">Workspace name</Label>
          <Input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Tech Newsletters"
          />

          {error && (
            <p className="text-sm text-destructive mt-3">{error}</p>
          )}

          <div className="flex justify-end gap-3 mt-5">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading ? (
                <>
                  <SpinnerGap size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                "Create workspace"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
