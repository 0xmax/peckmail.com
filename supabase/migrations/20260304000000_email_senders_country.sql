-- Add country column to email_senders (ISO 3166-1 alpha-2)
ALTER TABLE email_senders
  ADD COLUMN country TEXT;

ALTER TABLE email_senders
  ADD CONSTRAINT email_senders_country_check
  CHECK (country IS NULL OR (char_length(country) = 2 AND country = upper(country)));
