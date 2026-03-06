-- Constrain dashboard recent emails to the selected range and add sender overview aggregates.

CREATE OR REPLACE FUNCTION get_dashboard_stats(
  p_project_id UUID,
  p_days INT DEFAULT 30,
  p_countries TEXT[] DEFAULT NULL
)
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
        'unread', COUNT(*) FILTER (WHERE ie.read_at IS NULL),
        'processed', COUNT(*) FILTER (WHERE ie.status = 'processed'),
        'failed', COUNT(*) FILTER (WHERE ie.status = 'failed'),
        'sender_count', COUNT(DISTINCT COALESCE(
          es.id::text,
          NULLIF(ie.from_domain, ''),
          NULLIF(split_part(lower(ie.from_address), '@', 2), ''),
          lower(ie.from_address)
        ))
      )
      FROM incoming_emails ie
      LEFT JOIN email_domains ed ON ed.project_id = ie.project_id AND ed.domain = ie.from_domain
      LEFT JOIN email_senders es ON es.id = ed.sender_id AND es.deleted_at IS NULL
      WHERE ie.project_id = p_project_id
        AND ie.deleted_at IS NULL
        AND ie.created_at >= cutoff
        AND (p_countries IS NULL OR es.country = ANY(p_countries))
    ),
    'tag_daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          d.date,
          et.id::text AS tag_id,
          et.name AS tag_name,
          et.color AS tag_color,
          COUNT(iet.email_id) AS count
        FROM generate_series(cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        CROSS JOIN email_tags et
        LEFT JOIN incoming_emails ie
          ON ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
          AND ie.created_at::date = d.date
        LEFT JOIN incoming_email_tags iet
          ON iet.email_id = ie.id
          AND iet.tag_id = et.id
          AND iet.deleted_at IS NULL
        LEFT JOIN email_domains ed ON ed.project_id = ie.project_id AND ed.domain = ie.from_domain
        LEFT JOIN email_senders es ON es.id = ed.sender_id AND es.deleted_at IS NULL
        WHERE et.project_id = p_project_id
          AND et.enabled = TRUE
          AND et.deleted_at IS NULL
          AND (p_countries IS NULL OR es.country = ANY(p_countries))
        GROUP BY d.date, et.id, et.name, et.color
        HAVING COUNT(iet.tag_id) > 0

        UNION ALL

        SELECT
          ie.created_at::date AS date,
          '_untagged' AS tag_id,
          'Untagged' AS tag_name,
          '#94a3b8' AS tag_color,
          COUNT(*) AS count
        FROM incoming_emails ie
        LEFT JOIN email_domains ed ON ed.project_id = ie.project_id AND ed.domain = ie.from_domain
        LEFT JOIN email_senders es ON es.id = ed.sender_id AND es.deleted_at IS NULL
        WHERE ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
          AND (p_countries IS NULL OR es.country = ANY(p_countries))
          AND NOT EXISTS (
            SELECT 1
            FROM incoming_email_tags iet
            JOIN email_tags et ON et.id = iet.tag_id
            WHERE iet.email_id = ie.id
              AND iet.deleted_at IS NULL
              AND et.deleted_at IS NULL
          )
        GROUP BY ie.created_at::date

        ORDER BY date, tag_name
      ) t
    ),
    'daily_volume', (
      SELECT COALESCE(jsonb_agg(row_to_json(v)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          d.date,
          COUNT(ie.id) FILTER (
            WHERE p_countries IS NULL OR es.country = ANY(p_countries)
          ) AS count
        FROM generate_series(cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN incoming_emails ie
          ON ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
          AND ie.created_at::date = d.date
        LEFT JOIN email_domains ed ON ed.project_id = ie.project_id AND ed.domain = ie.from_domain
        LEFT JOIN email_senders es ON es.id = ed.sender_id AND es.deleted_at IS NULL
        GROUP BY d.date
        ORDER BY d.date
      ) v
    ),
    'top_domains', (
      SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(ie.from_domain, split_part(ie.from_address, '@', 2)) AS domain,
          COUNT(*) AS count,
          MAX(ie.created_at) AS latest_date
        FROM incoming_emails ie
        LEFT JOIN email_domains ed ON ed.project_id = ie.project_id AND ed.domain = ie.from_domain
        LEFT JOIN email_senders es ON es.id = ed.sender_id AND es.deleted_at IS NULL
        WHERE ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
          AND (p_countries IS NULL OR es.country = ANY(p_countries))
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
          COUNT(ie.id) FILTER (
            WHERE p_countries IS NULL OR es.country = ANY(p_countries)
          ) AS count
        FROM generate_series(grid_cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN incoming_emails ie
          ON ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at::date = d.date
        LEFT JOIN email_domains ed ON ed.project_id = ie.project_id AND ed.domain = ie.from_domain
        LEFT JOIN email_senders es ON es.id = ed.sender_id AND es.deleted_at IS NULL
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
              AND iet.deleted_at IS NULL
              AND et.deleted_at IS NULL
          ) AS tags
        FROM incoming_emails ie
        LEFT JOIN email_domains ed ON ed.project_id = ie.project_id AND ed.domain = ie.from_domain
        LEFT JOIN email_senders es ON es.id = ed.sender_id AND es.deleted_at IS NULL
        WHERE ie.project_id = p_project_id
          AND ie.deleted_at IS NULL
          AND ie.created_at >= cutoff
          AND (p_countries IS NULL OR es.country = ANY(p_countries))
        ORDER BY ie.created_at DESC
        LIMIT 5
      ) r
    ),
    'countries', (
      SELECT COALESCE(jsonb_agg(DISTINCT es.country), '[]'::jsonb)
      FROM email_senders es
      WHERE es.project_id = p_project_id
        AND es.country IS NOT NULL
        AND es.deleted_at IS NULL
    )
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION get_sender_overview_stats(
  p_project_id UUID,
  p_sender_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  WITH sender_domains AS (
    SELECT ed.domain
    FROM email_domains ed
    WHERE ed.project_id = p_project_id
      AND ed.sender_id = p_sender_id
  ),
  sender_emails AS (
    SELECT ie.id, ie.created_at
    FROM incoming_emails ie
    JOIN sender_domains sd ON sd.domain = ie.from_domain
    WHERE ie.project_id = p_project_id
      AND ie.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM sender_emails),
    'first_email_at', (SELECT MIN(created_at) FROM sender_emails),
    'latest_email_at', (SELECT MAX(created_at) FROM sender_emails),
    'tag_counts', (
      SELECT COALESCE(
        jsonb_agg(to_jsonb(t) ORDER BY t.count DESC, t.name ASC),
        '[]'::jsonb
      )
      FROM (
        SELECT
          et.id::text AS id,
          et.name,
          et.color,
          COUNT(*)::int AS count
        FROM sender_emails se
        JOIN incoming_email_tags iet
          ON iet.email_id = se.id
         AND iet.deleted_at IS NULL
        JOIN email_tags et
          ON et.id = iet.tag_id
         AND et.deleted_at IS NULL
        GROUP BY et.id, et.name, et.color

        UNION ALL

        SELECT
          '_untagged'::text AS id,
          'Untagged'::text AS name,
          '#94a3b8'::text AS color,
          COUNT(*)::int AS count
        FROM sender_emails se
        WHERE NOT EXISTS (
          SELECT 1
          FROM incoming_email_tags iet
          JOIN email_tags et ON et.id = iet.tag_id
          WHERE iet.email_id = se.id
            AND iet.deleted_at IS NULL
            AND et.deleted_at IS NULL
        )
        HAVING COUNT(*) > 0
      ) t
    )
  );
$$;
