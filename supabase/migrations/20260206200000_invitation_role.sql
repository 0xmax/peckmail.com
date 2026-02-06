-- Add role column to invitations (defaults to 'editor' for backwards compat)
-- Matches project_members role constraint: owner, editor, viewer
alter table public.invitations
  add column if not exists role text not null default 'editor'
  constraint invitations_role_check check (role in ('owner', 'editor', 'viewer'));
