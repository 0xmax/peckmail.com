-- Perchpad schema
create extension if not exists pgcrypto with schema extensions;

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view any profile"
  on public.profiles for select using (true);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Project members
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table public.project_members enable row level security;

-- Projects: members can see their projects
create policy "Members can view their projects"
  on public.projects for select
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = projects.id
        and project_members.user_id = auth.uid()
    )
  );

-- Projects: any authenticated user can create
create policy "Authenticated users can create projects"
  on public.projects for insert
  with check (auth.uid() is not null);

-- Projects: owners can update
create policy "Owners can update projects"
  on public.projects for update
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = projects.id
        and project_members.user_id = auth.uid()
        and project_members.role = 'owner'
    )
  );

-- Projects: owners can delete
create policy "Owners can delete projects"
  on public.projects for delete
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = projects.id
        and project_members.user_id = auth.uid()
        and project_members.role = 'owner'
    )
  );

-- Project members: members can see other members
create policy "Members can view project members"
  on public.project_members for select
  using (
    exists (
      select 1 from public.project_members as pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
    )
  );

-- Project members: owners can add members
create policy "Owners can add members"
  on public.project_members for insert
  with check (
    exists (
      select 1 from public.project_members as pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
    -- Also allow inserting yourself as owner (project creation)
    or (user_id = auth.uid() and role = 'owner')
  );

-- Project members: owners can remove members
create policy "Owners can remove members"
  on public.project_members for delete
  using (
    exists (
      select 1 from public.project_members as pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
  );

-- Invitations
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;

create policy "Members can view project invitations"
  on public.invitations for select
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = invitations.project_id
        and project_members.user_id = auth.uid()
    )
    or email = (select email from auth.users where id = auth.uid())
  );

create policy "Owners can create invitations"
  on public.invitations for insert
  with check (
    exists (
      select 1 from public.project_members
      where project_members.project_id = invitations.project_id
        and project_members.user_id = auth.uid()
        and project_members.role = 'owner'
    )
  );

create policy "Owners and invitees can update invitations"
  on public.invitations for update
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = invitations.project_id
        and project_members.user_id = auth.uid()
        and project_members.role = 'owner'
    )
    or email = (select email from auth.users where id = auth.uid())
  );

-- Share links
create table if not exists public.share_links (
  token text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_path text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.share_links enable row level security;

create policy "Members can view share links"
  on public.share_links for select
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = share_links.project_id
        and project_members.user_id = auth.uid()
    )
  );

create policy "Editors and owners can create share links"
  on public.share_links for insert
  with check (
    exists (
      select 1 from public.project_members
      where project_members.project_id = share_links.project_id
        and project_members.user_id = auth.uid()
        and project_members.role in ('owner', 'editor')
    )
  );

create policy "Anyone can read share link by token"
  on public.share_links for select
  using (true);

create policy "Owners can delete share links"
  on public.share_links for delete
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = share_links.project_id
        and project_members.user_id = auth.uid()
        and project_members.role = 'owner'
    )
  );
