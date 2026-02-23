-- Move legacy peckmail workspace addresses from chirp.peckmail.com to inbox.peckmail.com.
-- This keeps local parts where possible and adds a short row-id suffix on collisions.
WITH candidates AS (
  SELECT
    pe.id,
    lower(split_part(pe.email, '@', 1) || '@inbox.peckmail.com') AS preferred_email,
    lower(split_part(pe.email, '@', 1) || '-' || left(pe.id::text, 8) || '@inbox.peckmail.com') AS fallback_email
  FROM project_emails pe
  WHERE pe.type = 'peckmail'
    AND pe.email LIKE '%@chirp.peckmail.com'
),
resolved AS (
  SELECT
    c.id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM project_emails other
        WHERE other.email = c.preferred_email
          AND other.id <> c.id
      )
      THEN c.fallback_email
      ELSE c.preferred_email
    END AS new_email
  FROM candidates c
)
UPDATE project_emails pe
SET email = r.new_email
FROM resolved r
WHERE pe.id = r.id;

-- Keep legacy projects.email in sync with the primary peckmail address.
WITH primary_project_email AS (
  SELECT DISTINCT ON (project_id)
    project_id,
    email
  FROM project_emails
  WHERE type = 'peckmail'
  ORDER BY project_id, created_at ASC
)
UPDATE projects p
SET email = ppe.email
FROM primary_project_email ppe
WHERE p.id = ppe.project_id
  AND p.email IS DISTINCT FROM ppe.email;
