-- Add per-option conditions to enum/category options and require them for categories.

CREATE OR REPLACE FUNCTION default_email_enum_option_condition(
  p_kind TEXT,
  p_extractor_name TEXT,
  p_value TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalized AS (
    SELECT
      normalize_email_enum_token(p_kind) AS kind_token,
      normalize_email_enum_token(p_extractor_name) AS extractor_token,
      normalize_email_enum_token(p_value) AS value_token
  )
  SELECT CASE
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'welcome'
      THEN 'Use for onboarding, welcome, sign-up confirmation, or first-purchase introduction emails.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'promotional'
      THEN 'Use for broad sales, discounts, product pushes, or limited-time offers whose main goal is conversion.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'newsletter'
      THEN 'Use for recurring editorial or content-led emails focused on updates, stories, or curated reading rather than a direct sale.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'cart_abandon'
      THEN 'Use for reminders about an incomplete checkout, saved cart, or products left behind.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'winback'
      THEN 'Use for re-engagement emails aimed at inactive, lapsed, or dormant subscribers or customers.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'transactional'
      THEN 'Use for operational emails triggered by an account or order event, such as receipts, shipping, password resets, or confirmations.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'announcement'
      THEN 'Use for product launches, major updates, news, or one-off announcements where informing is primary.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'survey'
      THEN 'Use for feedback requests, NPS surveys, review asks, polls, or research outreach.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'loyalty'
      THEN 'Use for rewards, points, membership perks, VIP benefits, or retention-program communications.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'seasonal'
      THEN 'Use for holiday, seasonal, event-driven, or calendar-based campaigns like Black Friday, summer, or Valentine''s Day.'
    WHEN kind_token = 'category' AND extractor_token = 'email_type' AND value_token = 'other'
      THEN 'Use only when none of the other category definitions fit clearly.'
    WHEN kind_token = 'category' AND extractor_token = 'mail_type' AND value_token = 'transactional'
      THEN 'Use when the email is triggered by a specific user or system event and is primarily operational or informational.'
    WHEN kind_token = 'category' AND extractor_token = 'mail_type' AND value_token = 'marketing'
      THEN 'Use when the email is primarily intended to persuade, promote, nurture, or drive engagement or sales.'
    WHEN kind_token = 'category'
      THEN 'Use when the email is best classified as ' || lower(humanize_email_enum_token(p_value)) || '.'
    ELSE ''
  END
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION normalize_email_extractor_enum_options()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  option_item jsonb;
  option_value text;
  option_color text;
  option_condition text;
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

    option_condition := trim(COALESCE(option_item ->> 'condition', ''));
    IF NEW.kind = 'category' AND option_condition = '' THEN
      RAISE EXCEPTION 'category enum options must define a condition';
    END IF;

    normalized_options := normalized_options || jsonb_build_array(
      jsonb_build_object(
        'value', option_value,
        'color', option_color,
        'condition', option_condition
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
SET enum_options = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'value', normalized.option_value,
        'color', normalized.option_color,
        'condition', normalized.option_condition
      )
      ORDER BY normalized.ord
    )
    FROM (
      SELECT
        option.ord,
        normalize_email_enum_token(option.item ->> 'value') AS option_value,
        CASE
          WHEN lower(trim(COALESCE(option.item ->> 'color', ''))) ~ '^#[0-9a-f]{6}$'
            THEN lower(trim(option.item ->> 'color'))
          ELSE email_enum_fallback_color(option.item ->> 'value')
        END AS option_color,
        CASE
          WHEN ex.kind = 'category'
            THEN COALESCE(
              NULLIF(trim(COALESCE(option.item ->> 'condition', '')), ''),
              default_email_enum_option_condition(ex.kind, ex.name, option.item ->> 'value')
            )
          ELSE trim(COALESCE(option.item ->> 'condition', ''))
        END AS option_condition
      FROM jsonb_array_elements(COALESCE(ex.enum_options, '[]'::jsonb)) WITH ORDINALITY AS option(item, ord)
      WHERE normalize_email_enum_token(option.item ->> 'value') IS NOT NULL
    ) AS normalized
  ),
  '[]'::jsonb
);

UPDATE email_extractors
SET enum_options = enum_options
WHERE deleted_at IS NULL;
