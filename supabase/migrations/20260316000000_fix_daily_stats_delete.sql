-- Fix DELETE without WHERE clause (blocked by pg_safeupdate)
CREATE OR REPLACE FUNCTION refresh_sender_daily_stats(p_project_id UUID DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_project_id IS NULL THEN
    DELETE FROM sender_daily_stats WHERE true;
  ELSE
    DELETE FROM sender_daily_stats sds
    USING email_senders es
    WHERE sds.sender_id = es.id
      AND es.project_id = p_project_id;
  END IF;

  INSERT INTO sender_daily_stats (sender_id, date, email_count)
  SELECT es.id, ie.created_at::date, COUNT(*)
  FROM incoming_emails ie
  JOIN email_domains ed
    ON ed.domain = ie.from_domain
   AND ed.project_id = ie.project_id
   AND ed.sender_id IS NOT NULL
  JOIN email_senders es
    ON es.id = ed.sender_id
   AND es.deleted_at IS NULL
  WHERE ie.deleted_at IS NULL
    AND ie.created_at >= (CURRENT_DATE - INTERVAL '90 days')
    AND (p_project_id IS NULL OR ie.project_id = p_project_id)
  GROUP BY es.id, ie.created_at::date;
END;
$$;
