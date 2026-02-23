import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../context/AuthContext.js";
import { SpinnerGap } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";

interface AuthorizationDetails {
  client: { name: string; description?: string };
  scopes: string[];
}

export function OAuthConsent() {
  const { user, loading: authLoading } = useAuth();
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const authorizationId = params.get("authorization_id");

  useEffect(() => {
    if (authLoading) return;
    if (!authorizationId) {
      setError("Missing authorization_id");
      setLoading(false);
      return;
    }
    if (!user) {
      // Redirect to login, preserving the authorization_id
      const returnUrl = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
      window.location.href = `/?redirect=${encodeURIComponent(returnUrl)}`;
      return;
    }

    supabase.auth.oauth
      .getAuthorizationDetails(authorizationId)
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError(err?.message || "Failed to load authorization details");
        } else {
          setDetails(data as any);
        }
        setLoading(false);
      });
  }, [authorizationId, user, authLoading]);

  const handleApprove = async () => {
    if (!authorizationId) return;
    setSubmitting(true);
    const { error: err } = await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (err) {
      setError(err.message);
      setSubmitting(false);
    }
    // Supabase handles the redirect automatically
  };

  const handleDeny = async () => {
    if (!authorizationId) return;
    setSubmitting(true);
    const { error: err } = await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (err) {
      setError(err.message);
      setSubmitting(false);
    }
    // Supabase handles the redirect automatically
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <SpinnerGap size={28} className="text-text-muted animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <h1 className="text-lg font-semibold text-text mb-2">Authorization Error</h1>
            <p className="text-sm text-text-muted">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <Card className="max-w-md w-full">
        <CardContent className="p-8">
          <div className="text-center mb-6">
            <div className="text-2xl font-bold text-text mb-1">Peckmail</div>
            <p className="text-sm text-text-muted">Authorize access to your account</p>
          </div>

          <div className="bg-surface-alt rounded-lg p-4 mb-6">
            <div className="text-sm font-medium text-text mb-1">
              {details?.client?.name || "An application"}
            </div>
            {details?.client?.description && (
              <p className="text-xs text-text-muted">{details.client.description}</p>
            )}
            <p className="text-xs text-text-muted mt-2">
              wants to access your Peckmail account as <strong>{user?.email}</strong>
            </p>
            {details?.scopes && details.scopes.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="text-xs font-medium text-text-muted mb-1">Requested access:</div>
                <div className="flex flex-wrap gap-1">
                  {details.scopes.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleDeny}
              disabled={submitting}
            >
              Deny
            </Button>
            <Button
              className="flex-1"
              onClick={handleApprove}
              disabled={submitting}
            >
              {submitting ? "Authorizing..." : "Approve"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
