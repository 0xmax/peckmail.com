-- Add unique email address to projects (nullable for existing projects)
ALTER TABLE projects ADD COLUMN email text UNIQUE;
CREATE INDEX idx_projects_email ON projects (email) WHERE email IS NOT NULL;

-- Incoming emails table
CREATE TABLE incoming_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resend_email_id text UNIQUE NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  body_text text,
  body_html text,
  headers jsonb DEFAULT '{}',
  attachments jsonb DEFAULT '[]',
  processed boolean DEFAULT false,
  agent_session_id text,
  error text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_incoming_emails_project ON incoming_emails (project_id);
CREATE INDEX idx_incoming_emails_processed ON incoming_emails (processed) WHERE NOT processed;

-- RLS
ALTER TABLE incoming_emails ENABLE ROW LEVEL SECURITY;

-- Members can read their project's emails
CREATE POLICY "Members can view incoming emails"
  ON incoming_emails FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = incoming_emails.project_id
        AND project_members.user_id = auth.uid()
    )
  );

-- Service role (supabaseAdmin) handles INSERT/UPDATE — no user-facing policies needed
