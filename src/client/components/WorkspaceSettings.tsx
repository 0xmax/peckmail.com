import { useProjectId } from "../store/StoreContext.js";
import { MembersPanel } from "./MembersPanel.js";
import { InviteForm } from "./InviteModal.js";
import { Card, CardContent } from "@/components/ui/card.js";

export function WorkspaceSettings() {
  const projectId = useProjectId();

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-8 space-y-8">
        <section>
          <h2 className="text-base font-semibold text-foreground mb-4">
            Invite
          </h2>
          <Card>
            <CardContent className="p-0">
              <InviteForm projectId={projectId} />
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground mb-4">
            Members
          </h2>
          <Card>
            <CardContent className="p-0">
              <MembersPanel projectId={projectId} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
