-- Domain catalog per project + configurable email tags + email/tag assignments.

-- Keep an explicit sender-domain catalog for filtering and management.
CREATE TABLE email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_domains_domain_lowercase CHECK (domain = lower(domain)),
  CONSTRAINT email_domains_domain_not_blank CHECK (length(trim(domain)) > 0)
);

CREATE UNIQUE INDEX email_domains_project_domain_unique
  ON email_domains (project_id, domain);
CREATE INDEX idx_email_domains_project
  ON email_domains (project_id);
CREATE INDEX idx_email_domains_project_enabled
  ON email_domains (project_id, enabled);

-- Tags are project-scoped rules that can be evaluated against inbound emails.
CREATE TABLE email_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#94a3b8',
  enabled boolean NOT NULL DEFAULT true,
  condition text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT email_tags_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT email_tags_condition_not_blank CHECK (length(trim(condition)) > 0),
  CONSTRAINT email_tags_color_hex CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE UNIQUE INDEX email_tags_project_name_unique
  ON email_tags (project_id, lower(name))
  WHERE deleted_at IS NULL;
CREATE INDEX idx_email_tags_project
  ON email_tags (project_id);
CREATE INDEX idx_email_tags_project_enabled
  ON email_tags (project_id, enabled)
  WHERE deleted_at IS NULL;

-- Join table storing all applied tags for each inbound email.
CREATE TABLE incoming_email_tags (
  email_id uuid NOT NULL REFERENCES incoming_emails(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES email_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (email_id, tag_id)
);

CREATE INDEX idx_incoming_email_tags_tag
  ON incoming_email_tags (tag_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_incoming_email_tags_email
  ON incoming_email_tags (email_id)
  WHERE deleted_at IS NULL;

-- Persist parsed sender domain on each inbound email for faster filtering.
ALTER TABLE incoming_emails
  ADD COLUMN IF NOT EXISTS from_domain text;
ALTER TABLE incoming_emails
  ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE incoming_emails
  ADD COLUMN IF NOT EXISTS summary text;

CREATE INDEX IF NOT EXISTS idx_incoming_emails_project_from_domain
  ON incoming_emails (project_id, from_domain);
CREATE INDEX IF NOT EXISTS idx_incoming_emails_project_read_at
  ON incoming_emails (project_id, read_at);

-- Keep updated_at/modified timestamps current.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_email_domains_updated_at ON email_domains;
CREATE TRIGGER set_email_domains_updated_at
  BEFORE UPDATE ON email_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS set_email_tags_updated_at ON email_tags;
CREATE TRIGGER set_email_tags_updated_at
  BEFORE UPDATE ON email_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS set_incoming_email_tags_updated_at ON incoming_email_tags;
CREATE TRIGGER set_incoming_email_tags_updated_at
  BEFORE UPDATE ON incoming_email_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- Ensure tags and emails in the join table always belong to the same project.
CREATE OR REPLACE FUNCTION public.validate_incoming_email_tag_project()
RETURNS trigger AS $$
DECLARE
  email_project_id uuid;
  tag_project_id uuid;
BEGIN
  SELECT project_id INTO email_project_id
  FROM incoming_emails
  WHERE id = NEW.email_id;

  SELECT project_id INTO tag_project_id
  FROM email_tags
  WHERE id = NEW.tag_id;

  IF email_project_id IS NULL OR tag_project_id IS NULL OR email_project_id <> tag_project_id THEN
    RAISE EXCEPTION 'incoming_email_tags project mismatch';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_incoming_email_tag_project ON incoming_email_tags;
CREATE TRIGGER check_incoming_email_tag_project
  BEFORE INSERT OR UPDATE ON incoming_email_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_incoming_email_tag_project();

-- Backfill from_domain for existing emails.
UPDATE incoming_emails
SET from_domain = lower(
  split_part(
    regexp_replace(
      regexp_replace(from_address, '^.*<([^>]+)>.*$', '\1'),
      '\s',
      '',
      'g'
    ),
    '@',
    2
  )
)
WHERE from_domain IS NULL
  AND from_address LIKE '%@%';

-- Backfill email_domains based on known inbound sender domains.
INSERT INTO email_domains (project_id, domain, last_seen_at)
SELECT
  project_id,
  from_domain,
  max(created_at) AS last_seen_at
FROM incoming_emails
WHERE from_domain IS NOT NULL
  AND length(trim(from_domain)) > 0
GROUP BY project_id, from_domain
ON CONFLICT (project_id, domain) DO UPDATE
SET
  last_seen_at = GREATEST(email_domains.last_seen_at, EXCLUDED.last_seen_at),
  updated_at = now();

-- RLS
ALTER TABLE email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_email_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view email domains"
  ON email_domains FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_domains.project_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and editors can manage email domains"
  ON email_domains FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_domains.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_domains.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  );

CREATE POLICY "Members can view email tags"
  ON email_tags FOR SELECT
  USING (
    deleted_at IS NULL
    AND
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_tags.project_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and editors can manage email tags"
  ON email_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_tags.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_tags.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  );

CREATE POLICY "Members can view incoming email tags"
  ON incoming_email_tags FOR SELECT
  USING (
    deleted_at IS NULL
    AND
    EXISTS (
      SELECT 1
      FROM incoming_emails
      JOIN project_members
        ON project_members.project_id = incoming_emails.project_id
      WHERE incoming_emails.id = incoming_email_tags.email_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and editors can manage incoming email tags"
  ON incoming_email_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM incoming_emails
      JOIN project_members
        ON project_members.project_id = incoming_emails.project_id
      WHERE incoming_emails.id = incoming_email_tags.email_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM incoming_emails
      JOIN project_members
        ON project_members.project_id = incoming_emails.project_id
      WHERE incoming_emails.id = incoming_email_tags.email_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  );
