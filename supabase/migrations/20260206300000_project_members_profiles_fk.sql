-- Add FK from project_members.user_id to profiles.id so Supabase
-- can resolve the profiles() join in PostgREST queries.
alter table public.project_members
  add constraint project_members_user_id_profiles_fk
  foreign key (user_id) references public.profiles(id) on delete cascade;
