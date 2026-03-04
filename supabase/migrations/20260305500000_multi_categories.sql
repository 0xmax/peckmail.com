-- Allow multiple category extractors per project.
-- Previously limited to one via a unique index.

DROP INDEX IF EXISTS idx_email_extractors_category;

-- Non-unique index for query performance
CREATE INDEX idx_email_extractors_category
  ON email_extractors (project_id, sort_order) WHERE kind = 'category' AND deleted_at IS NULL;

-- Per-enum-value colors (parallel array to enum_values)
ALTER TABLE email_extractors ADD COLUMN enum_colors text[] NOT NULL DEFAULT '{}';
