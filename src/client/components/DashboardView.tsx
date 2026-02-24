import { Tray, EnvelopeSimple, ChartLine } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card.js";
import { useIncomingEmails } from "../store/StoreContext.js";

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function DashboardView() {
  const emails = useIncomingEmails();
  const unread = emails.filter((e) => e.status === "received").length;
  const recent = emails.slice(0, 5);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Subscriptions</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {emails.length}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <EnvelopeSimple size={18} className="text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Unread</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {unread}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Tray size={18} className="text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Recent Activity</p>
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {recent.length}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <ChartLine size={18} className="text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent emails */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Recent emails
          </h2>
          {recent.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <Tray size={32} weight="duotone" className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No emails yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Forward newsletters to your workspace email to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {recent.map((e) => (
                <Card key={e.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="mt-0.5 shrink-0">
                      {e.status === "received" ? (
                        <span className="block w-2 h-2 rounded-full bg-blue-400" />
                      ) : e.status === "processing" ? (
                        <span className="block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      ) : e.status === "failed" ? (
                        <span className="block w-2 h-2 rounded-full bg-red-400" />
                      ) : (
                        <span className="block w-2 h-2 rounded-full bg-green-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">
                        {e.subject || "(no subject)"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {e.from_address}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDate(e.created_at)}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
