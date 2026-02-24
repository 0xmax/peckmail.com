-- Add soft-delete column to incoming_emails
ALTER TABLE incoming_emails ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
