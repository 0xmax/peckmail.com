-- Owners can update member roles
create policy "Owners can update members"
  on public.project_members for update
  using (
    exists (
      select 1 from public.project_members as pm
      where pm.project_id = project_members.project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    )
  );

-- Users can update their own API keys (for last_used_at)
create policy "Users can update own keys"
  on api_keys for update
  using (auth.uid() = user_id);

-- Owners can delete invitations
create policy "Owners can delete invitations"
  on public.invitations for delete
  using (
    exists (
      select 1 from public.project_members
      where project_members.project_id = invitations.project_id
        and project_members.user_id = auth.uid()
        and project_members.role = 'owner'
    )
  );
