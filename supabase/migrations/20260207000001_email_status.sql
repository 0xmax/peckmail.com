-- Replace boolean `processed` with text `status` for richer state tracking
-- Possible values: 'received', 'processing', 'processed', 'failed'

ALTER TABLE incoming_emails ADD COLUMN status text NOT NULL DEFAULT 'received';

-- Backfill from existing processed/error columns
UPDATE incoming_emails SET status = CASE
  WHEN error IS NOT NULL THEN 'failed'
  WHEN processed = true THEN 'processed'
  ELSE 'received'
END;

-- Drop old column and index
DROP INDEX IF EXISTS idx_incoming_emails_processed;
ALTER TABLE incoming_emails DROP COLUMN processed;

-- New index for pending emails
CREATE INDEX idx_incoming_emails_status ON incoming_emails (status) WHERE status NOT IN ('processed', 'failed');
