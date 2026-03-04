-- Precomputed daily email counts per sender for sparklines and trend analysis.

CREATE TABLE sender_daily_stats (
  sender_id UUID NOT NULL REFERENCES email_senders(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  email_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (sender_id, date)
);

CREATE INDEX idx_sender_daily_stats_date ON sender_daily_stats (date);

-- Refresh: upsert daily counts from incoming_emails joined via email_domains
CREATE OR REPLACE FUNCTION refresh_sender_daily_stats(p_project_id UUID DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sender_daily_stats (sender_id, date, email_count)
  SELECT ed.sender_id, ie.created_at::date, COUNT(*)
  FROM incoming_emails ie
  JOIN email_domains ed ON ed.domain = ie.from_domain AND ed.project_id = ie.project_id
  WHERE ie.deleted_at IS NULL
    AND ed.sender_id IS NOT NULL
    AND ie.created_at >= (CURRENT_DATE - INTERVAL '90 days')
    AND (p_project_id IS NULL OR ie.project_id = p_project_id)
  GROUP BY ed.sender_id, ie.created_at::date
  ON CONFLICT (sender_id, date)
  DO UPDATE SET email_count = EXCLUDED.email_count;

  DELETE FROM sender_daily_stats WHERE date < CURRENT_DATE - INTERVAL '90 days';
END; $$;

-- RLS
ALTER TABLE sender_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view sender daily stats"
  ON sender_daily_stats FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM email_senders es
      JOIN project_members pm ON pm.project_id = es.project_id
      WHERE es.id = sender_daily_stats.sender_id
        AND pm.user_id = auth.uid()
    )
  );
