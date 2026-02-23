-- Multiple email addresses per project with deduplication + type.
CREATE TABLE project_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  type text NOT NULL CHECK (type IN ('peckmail', 'imap')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Keep stored emails normalized for predictable matching.
ALTER TABLE project_emails
  ADD CONSTRAINT project_emails_email_lowercase CHECK (email = lower(email));

CREATE UNIQUE INDEX project_emails_email_unique ON project_emails (email);
CREATE INDEX idx_project_emails_project ON project_emails (project_id);
CREATE INDEX idx_project_emails_project_type ON project_emails (project_id, type);

-- Backfill existing project email addresses.
INSERT INTO project_emails (project_id, email, type)
SELECT id, lower(email), 'peckmail'
FROM projects
WHERE email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- RLS
ALTER TABLE project_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view project emails"
  ON project_emails FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = project_emails.project_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage project emails"
  ON project_emails FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = project_emails.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = project_emails.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role = 'owner'
    )
  );
