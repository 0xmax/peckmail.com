-- Composite index for efficient cursor-based pagination on incoming_emails
CREATE INDEX IF NOT EXISTS idx_incoming_emails_project_created_id
  ON incoming_emails (project_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Dashboard aggregate function
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_project_id UUID, p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
  cutoff TIMESTAMPTZ;
  grid_cutoff TIMESTAMPTZ;
BEGIN
  cutoff := NOW() - (p_days || ' days')::INTERVAL;
  grid_cutoff := NOW() - INTERVAL '49 days';

  SELECT jsonb_build_object(
    'kpis', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'unread', COUNT(*) FILTER (WHERE ie.status = 'received'),
        'processed', COUNT(*) FILTER (WHERE ie.status = 'processed'),
        'failed', COUNT(*) FILTER (WHERE ie.status = 'failed')
      )
      FROM incoming_emails ie
      WHERE ie.project_id = p_project_id
        AND ie.deleted_at IS NULL
        AND ie.created_at >= cutoff
    ),
    'tag_daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      FROM (
        -- Tagged emails
        SELECT
          d.date,
          et.id::text AS tag_id,
          et.name AS tag_name,
          et.color AS tag_color,
          COUNT(ie.id) AS count
        FROM generate_series(cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        CROSS JOIN email_tags et
        LEFT JOIN incoming_emails ie
          ON ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
          AND (ie.created_at::date) = d.date
        LEFT JOIN incoming_email_tags iet
          ON iet.email_id = ie.id
          AND iet.tag_id = et.id
        WHERE et.project_id = p_project_id
          AND et.enabled = TRUE
        GROUP BY d.date, et.id, et.name, et.color
        HAVING COUNT(iet.tag_id) > 0

        UNION ALL

        -- Untagged emails
        SELECT
          (ie.created_at::date) AS date,
          '_untagged' AS tag_id,
          'Untagged' AS tag_name,
          '#94a3b8' AS tag_color,
          COUNT(*) AS count
        FROM incoming_emails ie
        WHERE ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
          AND NOT EXISTS (
            SELECT 1 FROM incoming_email_tags iet WHERE iet.email_id = ie.id
          )
        GROUP BY ie.created_at::date

        ORDER BY date, tag_name
      ) t
    ),
    'top_domains', (
      SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(ie.from_domain, split_part(ie.from_address, '@', 2)) AS domain,
          COUNT(*) AS count,
          MAX(ie.created_at) AS latest_date
        FROM incoming_emails ie
        WHERE ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
        GROUP BY COALESCE(ie.from_domain, split_part(ie.from_address, '@', 2))
        ORDER BY count DESC
        LIMIT 8
      ) d
    ),
    'activity_grid', (
      SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          d.date,
          COUNT(ie.id) AS count
        FROM generate_series(grid_cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN incoming_emails ie
          ON ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND (ie.created_at::date) = d.date
        GROUP BY d.date
        ORDER BY d.date
      ) a
    ),
    'recent_emails', (
      SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          ie.id,
          ie.from_address,
          ie.from_domain,
          ie.subject,
          ie.status,
          ie.created_at,
          ie.read_at,
          ie.summary,
          (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', et.id,
              'name', et.name,
              'color', et.color
            )), '[]'::jsonb)
            FROM incoming_email_tags iet
            JOIN email_tags et ON et.id = iet.tag_id
            WHERE iet.email_id = ie.id
          ) AS tags
        FROM incoming_emails ie
        WHERE ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
        ORDER BY ie.created_at DESC
        LIMIT 5
      ) r
    )
  ) INTO result;

  RETURN result;
END;
$$;
