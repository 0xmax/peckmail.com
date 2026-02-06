-- Add description column to projects (auto-generated summary)
alter table public.projects add column if not exists description text;
