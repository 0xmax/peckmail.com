-- Replace parallel enum value/color arrays with validated deterministic enum options.

ALTER TABLE email_extractors
  ADD COLUMN IF NOT EXISTS enum_options jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION normalize_email_enum_token(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(
    regexp_replace(lower(trim(p_value)), '[^a-z0-9]+', '_', 'g'),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION humanize_email_enum_token(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT initcap(replace(normalize_email_enum_token(p_value), '_', ' '));
$$;

CREATE OR REPLACE FUNCTION email_enum_fallback_color(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  WITH palette AS (
    SELECT ARRAY[
      '#ef4444',
      '#f97316',
      '#eab308',
      '#22c55e',
      '#06b6d4',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#94a3b8'
    ]::TEXT[] AS colors
  )
  SELECT colors[
    1 + (
      MOD(
        hashtext(COALESCE(normalize_email_enum_token(p_value), ''))::bigint + 2147483648,
        array_length(colors, 1)::bigint
      )
    )::int
  ]
  FROM palette;
$$;

CREATE OR REPLACE FUNCTION find_email_enum_option(
  p_enum_options jsonb,
  p_value TEXT
)
RETURNS TABLE(value TEXT, color TEXT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT option_row.value, option_row.color
  FROM jsonb_to_recordset(COALESCE(p_enum_options, '[]'::jsonb)) AS option_row(value TEXT, color TEXT)
  WHERE p_value IS NOT NULL
    AND (
      option_row.value = p_value
      OR normalize_email_enum_token(option_row.value) = normalize_email_enum_token(p_value)
    )
  ORDER BY CASE WHEN option_row.value = p_value THEN 0 ELSE 1 END, option_row.value
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION normalize_email_extractor_enum_options()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  option_item jsonb;
  option_value text;
  option_color text;
  normalized_options jsonb := '[]'::jsonb;
  seen_values text[] := ARRAY[]::text[];
  palette text[] := ARRAY[
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#94a3b8'
  ];
  option_index integer := 0;
  requires_enum_options boolean := NEW.kind = 'category' OR NEW.value_type = 'enum';
BEGIN
  IF NEW.kind = 'category' AND NEW.value_type <> 'enum' THEN
    RAISE EXCEPTION 'categories must use enum value_type';
  END IF;

  IF NEW.enum_options IS NULL THEN
    NEW.enum_options := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(NEW.enum_options) <> 'array' THEN
    RAISE EXCEPTION 'enum_options must be a JSON array';
  END IF;

  FOR option_item IN
    SELECT value
    FROM jsonb_array_elements(NEW.enum_options)
  LOOP
    option_index := option_index + 1;

    IF jsonb_typeof(option_item) <> 'object' THEN
      RAISE EXCEPTION 'each enum option must be an object';
    END IF;

    option_value := normalize_email_enum_token(option_item ->> 'value');
    IF option_value IS NULL THEN
      RAISE EXCEPTION 'enum option values must be non-empty slug tokens';
    END IF;

    IF option_value = ANY(seen_values) THEN
      RAISE EXCEPTION 'duplicate enum option value: %', option_value;
    END IF;
    seen_values := array_append(seen_values, option_value);

    option_color := lower(trim(COALESCE(option_item ->> 'color', '')));
    IF option_color = '' THEN
      option_color := palette[1 + MOD(option_index - 1, array_length(palette, 1))];
    ELSIF option_color !~ '^#[0-9a-f]{6}$' THEN
      RAISE EXCEPTION 'enum option colors must be 6-digit hex values';
    END IF;

    normalized_options := normalized_options || jsonb_build_array(
      jsonb_build_object(
        'value', option_value,
        'color', option_color
      )
    );
  END LOOP;

  IF requires_enum_options AND jsonb_array_length(normalized_options) = 0 THEN
    RAISE EXCEPTION 'enum extractors and categories must define at least one enum option';
  END IF;

  IF NOT requires_enum_options AND jsonb_array_length(normalized_options) > 0 THEN
    RAISE EXCEPTION 'only enum extractors and categories can define enum options';
  END IF;

  NEW.enum_options := normalized_options;
  RETURN NEW;
END;
$$;

UPDATE email_extractors ex
SET enum_options = CASE
  WHEN ex.kind = 'category' OR ex.value_type = 'enum' THEN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'value', normalize_email_enum_token(ev.value),
          'color', COALESCE(
            ex.enum_colors[ev.ord::int],
            (ARRAY[
              '#ef4444',
              '#f97316',
              '#eab308',
              '#22c55e',
              '#06b6d4',
              '#3b82f6',
              '#8b5cf6',
              '#ec4899',
              '#94a3b8'
            ]::TEXT[])[1 + MOD((ev.ord - 1)::int, 9)]
          )
        )
        ORDER BY ev.ord
      )
      FROM unnest(COALESCE(ex.enum_values, ARRAY[]::TEXT[])) WITH ORDINALITY AS ev(value, ord)
      WHERE normalize_email_enum_token(ev.value) IS NOT NULL
    ),
    '[]'::jsonb
  )
  ELSE '[]'::jsonb
END;

DROP TRIGGER IF EXISTS normalize_email_extractor_enum_options_before_write ON email_extractors;
CREATE TRIGGER normalize_email_extractor_enum_options_before_write
  BEFORE INSERT OR UPDATE ON email_extractors
  FOR EACH ROW
  EXECUTE FUNCTION normalize_email_extractor_enum_options();

UPDATE email_extractors
SET enum_options = enum_options
WHERE deleted_at IS NULL;

ALTER TABLE email_extractors
  DROP CONSTRAINT IF EXISTS email_extractors_enum_options_array,
  ADD CONSTRAINT email_extractors_enum_options_array CHECK (jsonb_typeof(enum_options) = 'array');

DROP FUNCTION IF EXISTS resolve_email_category_color(TEXT[], TEXT[], TEXT);

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
      ex.enum_options,
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
              matched.value,
              normalize_email_enum_token(resolved.raw_value),
              '_unclassified'
            ) AS value_id,
            COALESCE(
              humanize_email_enum_token(matched.value),
              humanize_email_enum_token(resolved.raw_value),
              'Unclassified'
            ) AS value_label,
            CASE
              WHEN resolved.raw_value IS NULL THEN '#94a3b8'
              ELSE COALESCE(matched.color, email_enum_fallback_color(resolved.raw_value))
            END AS color
          FROM filtered_emails fe
          CROSS JOIN category_extractors ce
          LEFT JOIN email_extractions ee
            ON ee.email_id = fe.id
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              NULLIF(ee.data ->> ce.name, ''),
              CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END
            ) AS raw_value
          ) resolved ON TRUE
          LEFT JOIN LATERAL find_email_enum_option(ce.enum_options, resolved.raw_value) matched
            ON TRUE
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

ALTER TABLE email_extractors
  DROP COLUMN enum_values,
  DROP COLUMN enum_colors;

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
      ex.enum_options,
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
              matched.value,
              normalize_email_enum_token(resolved.raw_value),
              '_unclassified'
            ) AS value_id,
            COALESCE(
              humanize_email_enum_token(matched.value),
              humanize_email_enum_token(resolved.raw_value),
              'Unclassified'
            ) AS value_label,
            CASE
              WHEN resolved.raw_value IS NULL THEN '#94a3b8'
              ELSE COALESCE(matched.color, email_enum_fallback_color(resolved.raw_value))
            END AS color
          FROM sender_emails se
          CROSS JOIN category_extractors ce
          LEFT JOIN email_extractions ee
            ON ee.email_id = se.id
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              NULLIF(ee.data ->> ce.name, ''),
              CASE WHEN ce.is_primary THEN NULLIF(ee.category, '') END
            ) AS raw_value
          ) resolved ON TRUE
          LEFT JOIN LATERAL find_email_enum_option(ce.enum_options, resolved.raw_value) matched
            ON TRUE
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
