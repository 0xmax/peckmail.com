-- Flexible, workspace-configurable email extraction system.
-- Replaces hardcoded email_classifications with configurable extractors + JSONB results.

-- 1. email_extractors: per-project configuration for extraction fields
CREATE TABLE email_extractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'extractor' CHECK (kind IN ('category', 'extractor')),
  name text NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  value_type text NOT NULL CHECK (value_type IN ('text', 'text_array', 'number', 'boolean', 'enum')),
  enum_values text[] NOT NULL DEFAULT '{}',
  required boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT name_slug CHECK (name ~ '^[a-z][a-z0-9_]*$')
);

-- One category per project (soft-delete aware)
CREATE UNIQUE INDEX idx_email_extractors_category
  ON email_extractors (project_id) WHERE kind = 'category' AND deleted_at IS NULL;

-- Unique name per project (soft-delete aware)
CREATE UNIQUE INDEX idx_email_extractors_name
  ON email_extractors (project_id, name) WHERE deleted_at IS NULL;

CREATE INDEX idx_email_extractors_project
  ON email_extractors (project_id, sort_order) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_email_extractors_updated_at ON email_extractors;
CREATE TRIGGER set_email_extractors_updated_at
  BEFORE UPDATE ON email_extractors
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE email_extractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view email extractors"
  ON email_extractors FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_extractors.project_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and editors can manage email extractors"
  ON email_extractors FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_extractors.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_extractors.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  );

-- 2. email_extractions: per-email extraction results (replaces email_classifications)
CREATE TABLE email_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES incoming_emails(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES email_senders(id) ON DELETE SET NULL,
  category text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text NOT NULL,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_email_extractions_email ON email_extractions (email_id);
CREATE INDEX idx_email_extractions_sender ON email_extractions (sender_id, extracted_at DESC);
CREATE INDEX idx_email_extractions_project_category ON email_extractions (project_id, category);

ALTER TABLE email_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view email extractions"
  ON email_extractions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_extractions.project_id
        AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and editors can manage email extractions"
  ON email_extractions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_extractions.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = email_extractions.project_id
        AND project_members.user_id = auth.uid()
        AND project_members.role IN ('owner', 'editor')
    )
  );

-- 3. RPC: list unextracted sender emails (replaces list_unclassified_sender_emails)
CREATE OR REPLACE FUNCTION list_unextracted_sender_emails(
  p_project_id uuid,
  p_sender_id uuid,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id uuid,
  subject text,
  body_text text,
  from_address text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT ie.id, ie.subject, ie.body_text, ie.from_address, ie.created_at
  FROM incoming_emails ie
  INNER JOIN email_domains ed ON ed.domain = ie.from_domain AND ed.project_id = ie.project_id
  LEFT JOIN email_extractions ee ON ee.email_id = ie.id
  WHERE ie.project_id = p_project_id
    AND ed.sender_id = p_sender_id
    AND ie.deleted_at IS NULL
    AND ee.id IS NULL
  ORDER BY ie.created_at DESC
  LIMIT p_limit;
$$;

-- 4. Migrate existing classification data into email_extractions
INSERT INTO email_extractions (email_id, project_id, sender_id, category, data, model, extracted_at, created_at)
SELECT
  ec.email_id,
  ec.project_id,
  ec.sender_id,
  ec.email_type,
  jsonb_build_object(
    'offer', ec.offer,
    'discount_pct', ec.discount_pct,
    'urgency', ec.urgency,
    'cta', ec.cta,
    'products_mentioned', to_jsonb(ec.products_mentioned),
    'tone', ec.tone,
    'discount_codes', '[]'::jsonb
  ),
  ec.model,
  ec.classified_at,
  ec.created_at
FROM email_classifications ec
ON CONFLICT (email_id) DO NOTHING;

-- 5. Seed default extractors for all existing projects
INSERT INTO email_extractors (project_id, kind, name, label, description, value_type, enum_values, required, sort_order)
SELECT
  p.id,
  'category',
  'email_type',
  'Email Type',
  'Classify the email into one of the provided categories based on its content and purpose.',
  'enum',
  ARRAY['welcome', 'promotional', 'newsletter', 'cart_abandon', 'winback', 'transactional', 'announcement', 'survey', 'loyalty', 'seasonal', 'other'],
  true,
  0
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM email_extractors ee
  WHERE ee.project_id = p.id AND ee.kind = 'category' AND ee.deleted_at IS NULL
);

-- Default extractors
DO $$
DECLARE
  proj RECORD;
BEGIN
  FOR proj IN SELECT id FROM projects LOOP
    INSERT INTO email_extractors (project_id, kind, name, label, description, value_type, enum_values, required, sort_order)
    VALUES
      (proj.id, 'extractor', 'offer', 'Offer', 'Brief description of the offer/promotion. null if none.', 'text', '{}', false, 1),
      (proj.id, 'extractor', 'discount_pct', 'Discount %', 'Discount percentage (0-100). null if none.', 'number', '{}', false, 2),
      (proj.id, 'extractor', 'discount_codes', 'Discount Codes', 'Promo/discount codes mentioned in the email.', 'text_array', '{}', false, 3),
      (proj.id, 'extractor', 'products_mentioned', 'Products', 'Specific product names mentioned.', 'text_array', '{}', false, 4),
      (proj.id, 'extractor', 'urgency', 'Urgency', 'Urgency level of the email.', 'enum', ARRAY['none', 'soft', 'hard'], false, 5),
      (proj.id, 'extractor', 'cta', 'CTA', 'Primary call-to-action text. null if none.', 'text', '{}', false, 6),
      (proj.id, 'extractor', 'tone', 'Tone', 'Overall tone of the email.', 'enum', ARRAY['formal', 'casual', 'urgent', 'friendly', 'luxury'], false, 7)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 6. Drop old table, RPC, and policies
DROP FUNCTION IF EXISTS list_unclassified_sender_emails(uuid, uuid, integer);
DROP TABLE IF EXISTS email_classifications CASCADE;
