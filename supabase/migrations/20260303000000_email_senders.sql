-- Sender entities: brand/company that owns one or more sending domains.

CREATE TABLE email_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  website text,
  description text,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT email_senders_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX email_senders_project_name_unique
  ON email_senders (project_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX idx_email_senders_project
  ON email_senders (project_id)
  WHERE deleted_at IS NULL;

-- Link domains to senders + track resolver state.
ALTER TABLE email_domains
  ADD COLUMN IF NOT EXISTS sender_id uuid REFERENCES email_senders(id) ON DELETE SET NULL;
ALTER TABLE email_domains
  ADD COLUMN IF NOT EXISTS resolver_status text NOT NULL DEFAULT 'pending';
ALTER TABLE email_domains
  ADD COLUMN IF NOT EXISTS resolver_error text;

CREATE INDEX idx_email_domains_sender
  ON email_domains (sender_id)
  WHERE sender_id IS NOT NULL;
CREATE INDEX idx_email_domains_project_resolver_status
  ON email_domains (project_id, resolver_status);

-- Trigger for updated_at on email_senders.
DROP TRIGGER IF EXISTS set_email_senders_updated_at ON email_senders;
CREATE TRIGGER set_email_senders_updated_at
  BEFORE UPDATE ON email_senders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE email_senders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view email senders"
  ON email_senders FOR SELECT
  USING (
    deleted_at IS NULL
    AND
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_senders.project_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and editors can manage email senders"
  ON email_senders FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_senders.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_senders.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  );
