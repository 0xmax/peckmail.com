-- Add unique handles to profiles (Twitter-style @username)
alter table public.profiles add column if not exists handle text;

-- Unique constraint
create unique index if not exists profiles_handle_unique on public.profiles (handle);

-- Backfill existing users with a handle derived from display_name
update public.profiles
set handle = lower(regexp_replace(
  coalesce(nullif(display_name, ''), id::text),
  '[^a-zA-Z0-9]', '', 'g'
))
where handle is null;

-- Handle collisions: append random suffix where duplicates exist
with dupes as (
  select handle, array_agg(id order by created_at) as ids
  from public.profiles
  where handle is not null
  group by handle
  having count(*) > 1
)
update public.profiles p
set handle = p.handle || substr(md5(p.id::text), 1, 4)
from dupes d
where p.handle = d.handle
  and p.id != d.ids[1];

-- Update the trigger to auto-generate handle on signup
create or replace function public.handle_new_user()
returns trigger as $$
declare
  base_handle text;
  final_handle text;
  suffix int := 0;
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );

  -- Generate handle from name or email
  base_handle := lower(regexp_replace(
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name', ''),
      nullif(new.raw_user_meta_data->>'full_name', ''),
      split_part(new.email, '@', 1)
    ),
    '[^a-z0-9]', '', 'g'
  ));

  -- Ensure uniqueness by appending numbers if needed
  final_handle := base_handle;
  while exists (select 1 from public.profiles where handle = final_handle and id != new.id) loop
    suffix := suffix + 1;
    final_handle := base_handle || suffix::text;
  end loop;

  update public.profiles set handle = final_handle where id = new.id;

  return new;
end;
$$ language plpgsql security definer;
