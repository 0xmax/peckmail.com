ALTER TABLE incoming_emails
ADD COLUMN IF NOT EXISTS raw_email text;
