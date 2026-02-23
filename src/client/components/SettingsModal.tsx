import { MembersPanel } from "./MembersPanel.js";
import { InviteForm } from "./InviteModal.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Button } from "@/components/ui/button.js";

export function SettingsModal({
  projectId,
  onClose,
  onLeave,
}: {
  projectId: string;
  onClose: () => void;
  onLeave?: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl p-0 flex flex-col"
        style={{ maxHeight: "80vh" }}
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border">
          <DialogTitle>Share</DialogTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            &times;
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <InviteForm projectId={projectId} />
          <MembersPanel projectId={projectId} onLeave={onLeave} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
