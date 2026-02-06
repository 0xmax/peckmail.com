import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../context/AuthContext.js";

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
        <div className="text-text-muted text-lg">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="bg-surface rounded-xl border border-border p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold text-text mb-2">Authorization Error</h1>
          <p className="text-sm text-text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="bg-surface rounded-xl border border-border p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-text mb-1">Perchpad</div>
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
            wants to access your Perchpad account as <strong>{user?.email}</strong>
          </p>
          {details?.scopes && details.scopes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-xs font-medium text-text-muted mb-1">Requested access:</div>
              <div className="flex flex-wrap gap-1">
                {details.scopes.map((s) => (
                  <span key={s} className="text-xs bg-bg px-2 py-0.5 rounded text-text-muted">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDeny}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 bg-surface-alt text-text-muted rounded-xl hover:bg-border transition-colors text-sm font-medium disabled:opacity-50"
          >
            Deny
          </button>
          <button
            onClick={handleApprove}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 bg-accent text-white rounded-xl hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "Authorizing..." : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
