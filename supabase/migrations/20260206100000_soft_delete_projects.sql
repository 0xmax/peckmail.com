-- Add soft delete support to projects
alter table public.projects add column if not exists deleted_at timestamptz;
