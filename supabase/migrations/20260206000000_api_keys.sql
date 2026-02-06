-- API keys for MCP server and external integrations
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  key_hash text unique not null,
  name text not null default '',
  created_at timestamptz default now() not null,
  last_used_at timestamptz
);

-- Index for fast auth lookups
create index idx_api_keys_key_hash on api_keys (key_hash);

-- RLS: users can only manage their own keys
alter table api_keys enable row level security;

create policy "Users can view own keys"
  on api_keys for select
  using (auth.uid() = user_id);

create policy "Users can insert own keys"
  on api_keys for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own keys"
  on api_keys for delete
  using (auth.uid() = user_id);
