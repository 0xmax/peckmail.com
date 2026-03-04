-- Validate sender_profiles.profile JSONB structure.
-- Ensures required keys exist and nested types are correct when present.

ALTER TABLE sender_profiles
  ADD CONSTRAINT sender_profiles_profile_schema CHECK (
    jsonb_typeof(profile) = 'object'
    AND profile ? 'company_profile'
    AND (
      NOT profile ? 'pricing_snapshot'
      OR (
        jsonb_typeof(profile -> 'pricing_snapshot') = 'object'
        AND (
          NOT profile -> 'pricing_snapshot' ? 'deepest_discount_pct'
          OR jsonb_typeof(profile -> 'pricing_snapshot' -> 'deepest_discount_pct') = 'number'
        )
      )
    )
    AND (
      NOT profile ? 'top_products'
      OR jsonb_typeof(profile -> 'top_products') = 'array'
    )
    AND (
      NOT profile ? 'tags'
      OR jsonb_typeof(profile -> 'tags') = 'array'
    )
    AND (
      NOT profile ? 'industry'
      OR jsonb_typeof(profile -> 'industry') = 'string'
    )
  );
