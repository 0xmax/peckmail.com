-- Add category breakdowns to dashboard and sender overview aggregates, and avoid fake tag stats when no tags exist.

ALTER TABLE email_extractors
  ADD COLUMN IF NOT EXISTS enum_colors text[] NOT NULL DEFAULT '{}';

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

  WITH active_tags AS (
    SELECT et.id, et.name, et.color
    FROM email_tags et
    WHERE et.project_id = p_project_id
      AND et.enabled = TRUE
      AND et.deleted_at IS NULL
  ),
  filtered_emails AS (
    SELECT
      ie.id,
      ie.from_address,
      ie.from_domain,
      ie.subject,
      ie.status,
      ie.created_at,
      ie.read_at,
      ie.summary,
      COALESCE(
        es.id::text,
        NULLIF(ie.from_domain, ''),
        NULLIF(split_part(lower(ie.from_address), '@', 2), ''),
        lower(ie.from_address)
      ) AS sender_key
    FROM incoming_emails ie
    LEFT JOIN email_domains ed
      ON ed.project_id = ie.project_id
     AND ed.domain = ie.from_domain
    LEFT JOIN email_senders es
      ON es.id = ed.sender_id
     AND es.deleted_at IS NULL
    WHERE ie.project_id = p_project_id
      AND ie.deleted_at IS NULL
      AND ie.created_at >= cutoff
      AND (p_countries IS NULL OR es.country = ANY(p_countries))
  ),
  grid_emails AS (
    SELECT
      ie.id,
      ie.created_at
    FROM incoming_emails ie
    LEFT JOIN email_domains ed
      ON ed.project_id = ie.project_id
     AND ed.domain = ie.from_domain
    LEFT JOIN email_senders es
      ON es.id = ed.sender_id
     AND es.deleted_at IS NULL
    WHERE ie.project_id = p_project_id
      AND ie.deleted_at IS NULL
      AND ie.created_at >= grid_cutoff
      AND (p_countries IS NULL OR es.country = ANY(p_countries))
  ),
  category_extractors AS (
    SELECT
      ex.id,
      ex.name,
      ex.label,
      ex.sort_order,
      ex.enum_values,
      ex.enum_colors,
      ROW_NUMBER() OVER (ORDER BY ex.sort_order, ex.created_at, ex.id) = 1 AS is_primary
    FROM email_extractors ex
    WHERE ex.project_id = p_project_id
      AND ex.kind = 'category'
      AND ex.enabled = TRUE
      AND ex.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'kpis', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'unread', COUNT(*) FILTER (WHERE fe.read_at IS NULL),
        'processed', COUNT(*) FILTER (WHERE fe.status = 'processed'),
        'failed', COUNT(*) FILTER (WHERE fe.status = 'failed'),
        'sender_count', COUNT(DISTINCT fe.sender_key)
      )
      FROM filtered_emails fe
    ),
    'tag_daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          d.date,
          at.id::text AS tag_id,
          at.name AS tag_name,
          at.color AS tag_color,
          COUNT(iet.email_id)::int AS count
        FROM generate_series(cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        JOIN active_tags at ON TRUE
        LEFT JOIN filtered_emails fe
          ON fe.created_at::date = d.date
        LEFT JOIN incoming_email_tags iet
          ON iet.email_id = fe.id
         AND iet.tag_id = at.id
         AND iet.deleted_at IS NULL
        GROUP BY d.date, at.id, at.name, at.color
        HAVING COUNT(iet.email_id) > 0

        UNION ALL

        SELECT
          fe.created_at::date AS date,
          '_untagged' AS tag_id,
          'Untagged' AS tag_name,
          '#94a3b8' AS tag_color,
          COUNT(*)::int AS count
        FROM filtered_emails fe
        WHERE EXISTS (SELECT 1 FROM active_tags)
          AND NOT EXISTS (
            SELECT 1
            FROM incoming_email_tags iet
            JOIN active_tags at ON at.id = iet.tag_id
            WHERE iet.email_id = fe.id
              AND iet.deleted_at IS NULL
          )
        GROUP BY fe.created_at::date

        ORDER BY date, tag_name
      ) t
    ),
    'category_breakdowns', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'category_id', c.category_id,
            'category_name', c.category_name,
            'category_label', c.category_label,
            'category_order', c.category_order,
            'value_id', c.value_id,
            'value_label', c.value_label,
            'color', c.color,
            'count', c.count
          )
          ORDER BY c.category_order, c.sort_bucket, c.count DESC, c.value_label ASC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          raw.category_id,
          raw.category_name,
          raw.category_label,
          raw.category_order,
          raw.value_id,
          raw.value_label,
          raw.color,
          COUNT(*)::int AS count,
          CASE WHEN raw.value_id = '_unclassified' THEN 1 ELSE 0 END AS sort_bucket
        FROM (
          SELECT
            ce.id::text AS category_id,
            ce.name AS category_name,
            ce.label AS category_label,
            ce.sort_order AS category_order,
            COALESCE(
              NULLIF(ee.data ->> ce.name, ''),
              CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END,
              '_unclassified'
            ) AS value_id,
            COALESCE(
              NULLIF(ee.data ->> ce.name, ''),
              CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END,
              'Unclassified'
            ) AS value_label,
            CASE
              WHEN COALESCE(
                NULLIF(ee.data ->> ce.name, ''),
                CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END
              ) IS NULL THEN '#94a3b8'
              ELSE COALESCE(
                ce.enum_colors[
                  array_position(
                    ce.enum_values,
                    COALESCE(
                      NULLIF(ee.data ->> ce.name, ''),
                      CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END
                    )
                  )
                ],
                '#c4956a'
              )
            END AS color
          FROM filtered_emails fe
          CROSS JOIN category_extractors ce
          LEFT JOIN email_extractions ee
            ON ee.email_id = fe.id
        ) raw
        GROUP BY
          raw.category_id,
          raw.category_name,
          raw.category_label,
          raw.category_order,
          raw.value_id,
          raw.value_label,
          raw.color
      ) c
    ),
    'daily_volume', (
      SELECT COALESCE(jsonb_agg(row_to_json(v)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          d.date,
          COUNT(fe.id)::int AS count
        FROM generate_series(cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN filtered_emails fe
          ON fe.created_at::date = d.date
        GROUP BY d.date
        ORDER BY d.date
      ) v
    ),
    'top_domains', (
      SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(fe.from_domain, split_part(fe.from_address, '@', 2)) AS domain,
          COUNT(*)::int AS count,
          MAX(fe.created_at) AS latest_date
        FROM filtered_emails fe
        GROUP BY COALESCE(fe.from_domain, split_part(fe.from_address, '@', 2))
        ORDER BY count DESC
        LIMIT 8
      ) d
    ),
    'activity_grid', (
      SELECT COALESCE(jsonb_agg(row_to_json(a)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          d.date,
          COUNT(ge.id)::int AS count
        FROM generate_series(grid_cutoff::date, CURRENT_DATE, '1 day') AS d(date)
        LEFT JOIN grid_emails ge
          ON ge.created_at::date = d.date
        GROUP BY d.date
        ORDER BY d.date
      ) a
    ),
    'recent_emails', (
      SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
      FROM (
        SELECT
          fe.id,
          fe.from_address,
          fe.from_domain,
          fe.subject,
          fe.status,
          fe.created_at,
          fe.read_at,
          fe.summary,
          (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', et.id,
              'name', et.name,
              'color', et.color
            )), '[]'::jsonb)
            FROM incoming_email_tags iet
            JOIN email_tags et ON et.id = iet.tag_id
            WHERE iet.email_id = fe.id
              AND iet.deleted_at IS NULL
              AND et.deleted_at IS NULL
              AND et.enabled = TRUE
          ) AS tags
        FROM filtered_emails fe
        ORDER BY fe.created_at DESC
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
    SELECT DISTINCT ie.id, ie.created_at
    FROM incoming_emails ie
    JOIN sender_domains sd ON sd.domain = ie.from_domain
    WHERE ie.project_id = p_project_id
      AND ie.deleted_at IS NULL
  ),
  active_tags AS (
    SELECT et.id, et.name, et.color
    FROM email_tags et
    WHERE et.project_id = p_project_id
      AND et.enabled = TRUE
      AND et.deleted_at IS NULL
  ),
  category_extractors AS (
    SELECT
      ex.id,
      ex.name,
      ex.label,
      ex.sort_order,
      ex.enum_values,
      ex.enum_colors,
      ROW_NUMBER() OVER (ORDER BY ex.sort_order, ex.created_at, ex.id) = 1 AS is_primary
    FROM email_extractors ex
    WHERE ex.project_id = p_project_id
      AND ex.kind = 'category'
      AND ex.enabled = TRUE
      AND ex.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM sender_emails),
    'first_email_at', (SELECT MIN(created_at) FROM sender_emails),
    'latest_email_at', (SELECT MAX(created_at) FROM sender_emails),
    'tag_counts', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'color', t.color,
            'count', t.count
          )
          ORDER BY t.sort_bucket, t.count DESC, t.name ASC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          at.id::text AS id,
          at.name,
          at.color,
          COUNT(*)::int AS count,
          0 AS sort_bucket
        FROM sender_emails se
        JOIN incoming_email_tags iet
          ON iet.email_id = se.id
         AND iet.deleted_at IS NULL
        JOIN active_tags at
          ON at.id = iet.tag_id
        GROUP BY at.id, at.name, at.color

        UNION ALL

        SELECT
          '_untagged'::text AS id,
          'Untagged'::text AS name,
          '#94a3b8'::text AS color,
          COUNT(*)::int AS count,
          1 AS sort_bucket
        FROM sender_emails se
        WHERE EXISTS (SELECT 1 FROM active_tags)
          AND NOT EXISTS (
            SELECT 1
            FROM incoming_email_tags iet
            JOIN active_tags at ON at.id = iet.tag_id
            WHERE iet.email_id = se.id
              AND iet.deleted_at IS NULL
          )
        HAVING COUNT(*) > 0
      ) t
    ),
    'category_breakdowns', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'category_id', c.category_id,
            'category_name', c.category_name,
            'category_label', c.category_label,
            'category_order', c.category_order,
            'value_id', c.value_id,
            'value_label', c.value_label,
            'color', c.color,
            'count', c.count
          )
          ORDER BY c.category_order, c.sort_bucket, c.count DESC, c.value_label ASC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT
          raw.category_id,
          raw.category_name,
          raw.category_label,
          raw.category_order,
          raw.value_id,
          raw.value_label,
          raw.color,
          COUNT(*)::int AS count,
          CASE WHEN raw.value_id = '_unclassified' THEN 1 ELSE 0 END AS sort_bucket
        FROM (
          SELECT
            ce.id::text AS category_id,
            ce.name AS category_name,
            ce.label AS category_label,
            ce.sort_order AS category_order,
            COALESCE(
              NULLIF(ee.data ->> ce.name, ''),
              CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END,
              '_unclassified'
            ) AS value_id,
            COALESCE(
              NULLIF(ee.data ->> ce.name, ''),
              CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END,
              'Unclassified'
            ) AS value_label,
            CASE
              WHEN COALESCE(
                NULLIF(ee.data ->> ce.name, ''),
                CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END
              ) IS NULL THEN '#94a3b8'
              ELSE COALESCE(
                ce.enum_colors[
                  array_position(
                    ce.enum_values,
                    COALESCE(
                      NULLIF(ee.data ->> ce.name, ''),
                      CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END
                    )
                  )
                ],
                '#c4956a'
              )
            END AS color
          FROM sender_emails se
          CROSS JOIN category_extractors ce
          LEFT JOIN email_extractions ee
            ON ee.email_id = se.id
        ) raw
        GROUP BY
          raw.category_id,
          raw.category_name,
          raw.category_label,
          raw.category_order,
          raw.value_id,
          raw.value_label,
          raw.color
      ) c
    )
  );
$$;
