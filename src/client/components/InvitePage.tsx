import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.js";
import { LoginPage } from "./LoginPage.js";
import { api } from "../lib/api.js";
import { SpinnerGap } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";

interface InviteInfo {
  id: string;
  projectName: string;
  email: string;
  status: string;
}

type State =
  | { step: "loading" }
  | { step: "error"; message: string }
  | { step: "login"; info: InviteInfo }
  | { step: "confirm"; info: InviteInfo }
  | { step: "accepting" }
  | { step: "declining" }
  | { step: "declined" }
  | { step: "mismatch"; info: InviteInfo };

export function InvitePage({
  invitationId,
  onNavigate,
}: {
  invitationId: string;
  onNavigate: (projectId: string) => void;
}) {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ step: "loading" });

  // Fetch invitation info (public, no auth needed)
  useEffect(() => {
    fetch(`/api/invitations/${invitationId}/info`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((info: InviteInfo) => {
        if (info.status !== "pending") {
          setState({ step: "error", message: "This invitation has already been used." });
        } else if (!user) {
          setState({ step: "login", info });
        } else {
          setState({ step: "confirm", info });
        }
      })
      .catch(() => setState({ step: "error", message: "Invitation not found." }));
  }, [invitationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When user logs in from the login step, transition to confirm
  useEffect(() => {
    if (!user) return;
    if (state.step === "login") {
      setState({ step: "confirm", info: state.info });
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAccept = () => {
    setState({ step: "accepting" });
    api
      .post<{ ok: boolean; project_id: string }>(
        `/api/invitations/${invitationId}/accept`
      )
      .then((res) => {
        onNavigate(res.project_id);
      })
      .catch((err) => {
        if (err.message?.includes("different email")) {
          setState({
            step: "mismatch",
            info: (state as any).info ?? { id: invitationId, projectName: "", email: "", status: "pending" },
          });
        } else {
          setState({ step: "error", message: err.message || "Failed to accept invitation" });
        }
      });
  };

  const handleDecline = () => {
    setState({ step: "declining" });
    api
      .post(`/api/invitations/${invitationId}/decline`)
      .then(() => setState({ step: "declined" }))
      .catch((err) => {
        setState({ step: "error", message: err.message || "Failed to decline invitation" });
      });
  };

  if (state.step === "loading" || state.step === "accepting" || state.step === "declining") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <SpinnerGap size={28} className="text-text-muted animate-spin" />
          {state.step === "accepting" && (
            <div className="text-text-muted text-sm">Joining project...</div>
          )}
          {state.step === "declining" && (
            <div className="text-text-muted text-sm">Declining invitation...</div>
          )}
        </div>
      </div>
    );
  }

  if (state.step === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold text-text mb-3">Invitation Error</h1>
            <p className="text-text-muted mb-6">{state.message}</p>
            <a href="/" className="text-accent hover:underline font-medium">
              Go to Peckmail
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.step === "declined") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold text-text mb-3">Invitation Declined</h1>
            <p className="text-text-muted mb-6">You've declined this invitation.</p>
            <a href="/" className="text-accent hover:underline font-medium">
              Go to Peckmail
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.step === "mismatch") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold text-text mb-3">Email Mismatch</h1>
            <p className="text-text-muted mb-2">
              This invitation was sent to <strong>{state.info.email}</strong>.
            </p>
            <p className="text-text-muted mb-6">
              Please sign in with that email address to accept.
            </p>
            <a href="/" className="text-accent hover:underline font-medium">
              Go to Peckmail
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state.step === "confirm") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold text-text mb-3">You're Invited</h1>
            <p className="text-text-muted mb-6">
              Join <strong>{state.info.projectName}</strong>?
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={handleDecline}>
                Decline
              </Button>
              <Button onClick={handleAccept}>
                Accept & Join
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // state.step === "login"
  const banner = (
    <div className="mb-6 p-4 bg-bg rounded-xl border border-border text-center">
      <p className="text-text text-sm">
        You've been invited to join{" "}
        <strong>{state.info.projectName}</strong>
      </p>
      <p className="text-text-muted text-xs mt-1">
        Sign in or create an account to accept
      </p>
    </div>
  );

  return <LoginPage banner={banner} />;
}
