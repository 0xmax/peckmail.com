-- Credit system: balances, transactions, and holds

-- 1. credit_balances — one row per user
create table credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0,
  lifetime_purchased bigint not null default 0,
  lifetime_used bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table credit_balances enable row level security;

create policy "Users can read own balance"
  on credit_balances for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies for users — service role only

-- 2. credit_transactions — append-only audit log
create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null, -- positive = added, negative = consumed
  balance_after bigint not null,
  type text not null check (type in ('purchase', 'grant', 'usage', 'refund')),
  service text check (service in ('tts', 'tts_enhance', 'chat', 'whisper')),
  project_id uuid references projects(id) on delete set null,
  idempotency_key text,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

create index idx_credit_transactions_user_date on credit_transactions (user_id, created_at desc);
create index idx_credit_transactions_project_date on credit_transactions (project_id, created_at desc);
create unique index idx_credit_transactions_idempotency on credit_transactions (idempotency_key) where idempotency_key is not null;

alter table credit_transactions enable row level security;

create policy "Users can read own transactions"
  on credit_transactions for select
  using (auth.uid() = user_id);

-- 3. credit_holds — temporary reservations for streaming ops
create table credit_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null,
  service text not null,
  project_id uuid references projects(id) on delete set null,
  metadata jsonb default '{}',
  status text not null default 'held' check (status in ('held', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index idx_credit_holds_user_active on credit_holds (user_id) where status = 'held';

alter table credit_holds enable row level security;

create policy "Users can read own holds"
  on credit_holds for select
  using (auth.uid() = user_id);

-- 4. Helper: ensure a balance row exists for a user (lazy init with signup grant)
create or replace function ensure_credit_balance(p_user_id uuid) returns void language plpgsql as $$
declare
  v_grant bigint := 5000;
begin
  insert into credit_balances (user_id, balance, lifetime_purchased, lifetime_used)
    values (p_user_id, v_grant, v_grant, 0)
    on conflict (user_id) do nothing;

  -- If we just created the row, record the grant transaction
  if found then
    insert into credit_transactions (user_id, amount, balance_after, type, service, metadata)
      values (p_user_id, v_grant, v_grant, 'grant', null, '{"reason": "signup_bonus"}'::jsonb);
  end if;
end;
$$;

-- 5. Postgres functions

-- deduct_credits: atomic check-and-deduct (lazy-inits balance row if missing)
create or replace function deduct_credits(
  p_user_id uuid,
  p_amount bigint,
  p_service text,
  p_project_id uuid default null,
  p_metadata jsonb default '{}'
) returns table(success boolean, balance_after bigint) language plpgsql as $$
declare
  v_balance bigint;
  v_held bigint;
  v_available bigint;
  v_new_balance bigint;
begin
  -- Lock the row
  select cb.balance into v_balance
    from credit_balances cb
    where cb.user_id = p_user_id
    for update;

  if not found then
    -- Lazy init: create balance row with signup grant
    perform ensure_credit_balance(p_user_id);
    select cb.balance into v_balance
      from credit_balances cb
      where cb.user_id = p_user_id
      for update;
  end if;

  -- Sum active holds
  select coalesce(sum(ch.amount), 0) into v_held
    from credit_holds ch
    where ch.user_id = p_user_id and ch.status = 'held';

  v_available := v_balance - v_held;

  if v_available < p_amount then
    return query select false, v_available;
    return;
  end if;

  v_new_balance := v_balance - p_amount;

  update credit_balances cb
    set balance = v_new_balance,
        lifetime_used = cb.lifetime_used + p_amount,
        updated_at = now()
    where cb.user_id = p_user_id;

  insert into credit_transactions (user_id, amount, balance_after, type, service, project_id, metadata)
    values (p_user_id, -p_amount, v_new_balance, 'usage', p_service, p_project_id, p_metadata);

  return query select true, v_new_balance;
end;
$$;

-- place_hold: atomic hold placement (lazy-inits balance row if missing)
create or replace function place_hold(
  p_user_id uuid,
  p_amount bigint,
  p_service text,
  p_project_id uuid default null,
  p_metadata jsonb default '{}'
) returns table(success boolean, hold_id uuid) language plpgsql as $$
declare
  v_balance bigint;
  v_held bigint;
  v_available bigint;
  v_hold_id uuid;
begin
  -- Lock the row
  select cb.balance into v_balance
    from credit_balances cb
    where cb.user_id = p_user_id
    for update;

  if not found then
    -- Lazy init: create balance row with signup grant
    perform ensure_credit_balance(p_user_id);
    select cb.balance into v_balance
      from credit_balances cb
      where cb.user_id = p_user_id
      for update;
  end if;

  select coalesce(sum(ch.amount), 0) into v_held
    from credit_holds ch
    where ch.user_id = p_user_id and ch.status = 'held';

  v_available := v_balance - v_held;

  if v_available < p_amount then
    return query select false, null::uuid;
    return;
  end if;

  insert into credit_holds (user_id, amount, service, project_id, metadata)
    values (p_user_id, p_amount, p_service, p_project_id, p_metadata)
    returning id into v_hold_id;

  return query select true, v_hold_id;
end;
$$;

-- settle_hold: convert hold to usage transaction
create or replace function settle_hold(
  p_hold_id uuid,
  p_actual_amount bigint,
  p_metadata jsonb default '{}'
) returns void language plpgsql as $$
declare
  v_hold record;
  v_new_balance bigint;
begin
  select * into v_hold from credit_holds where id = p_hold_id and status = 'held' for update;
  if not found then
    raise exception 'Hold not found or already settled: %', p_hold_id;
  end if;

  -- Lock the balance row
  update credit_balances cb
    set balance = cb.balance - p_actual_amount,
        lifetime_used = cb.lifetime_used + p_actual_amount,
        updated_at = now()
    where cb.user_id = v_hold.user_id
    returning balance into v_new_balance;

  -- Record the transaction
  insert into credit_transactions (user_id, amount, balance_after, type, service, project_id, metadata)
    values (v_hold.user_id, -p_actual_amount, v_new_balance, 'usage', v_hold.service, v_hold.project_id, p_metadata);

  -- Mark hold as settled
  update credit_holds set status = 'settled', settled_at = now() where id = p_hold_id;
end;
$$;

-- release_hold: cancel hold without charging
create or replace function release_hold(p_hold_id uuid) returns void language plpgsql as $$
begin
  update credit_holds
    set status = 'released', settled_at = now()
    where id = p_hold_id and status = 'held';
end;
$$;

-- release_stale_holds: cleanup for crashed streams
create or replace function release_stale_holds(p_max_age_minutes int default 10) returns int language plpgsql as $$
declare
  v_count int;
begin
  update credit_holds
    set status = 'released', settled_at = now()
    where status = 'held'
      and created_at < now() - (p_max_age_minutes || ' minutes')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- add_credits: atomic credit addition with idempotency key support
create or replace function add_credits(
  p_user_id uuid,
  p_amount bigint,
  p_type text,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'
) returns table(success boolean, balance_after bigint) language plpgsql as $$
declare
  v_new_balance bigint;
begin
  -- Idempotency check: if key was already used, return the existing result
  if p_idempotency_key is not null then
    select ct.balance_after into v_new_balance
      from credit_transactions ct
      where ct.idempotency_key = p_idempotency_key;
    if found then
      return query select true, v_new_balance;
      return;
    end if;
  end if;

  -- Ensure balance row exists
  perform ensure_credit_balance(p_user_id);

  -- Lock and update
  update credit_balances cb
    set balance = cb.balance + p_amount,
        lifetime_purchased = case when p_type = 'purchase' then cb.lifetime_purchased + p_amount else cb.lifetime_purchased end,
        updated_at = now()
    where cb.user_id = p_user_id
    returning balance into v_new_balance;

  -- Record transaction
  insert into credit_transactions (user_id, amount, balance_after, type, idempotency_key, metadata)
    values (p_user_id, p_amount, v_new_balance, p_type, p_idempotency_key, p_metadata);

  return query select true, v_new_balance;
end;
$$;

-- 6. Signup trigger: grant 5000 free credits to new users
create or replace function handle_new_user_credits() returns trigger language plpgsql security definer as $$
begin
  perform ensure_credit_balance(new.id);
  return new;
end;
$$;

-- Drop existing trigger if any, then create
drop trigger if exists on_auth_user_created_credits on auth.users;
create trigger on_auth_user_created_credits
  after insert on auth.users
  for each row execute function handle_new_user_credits();

-- 7. Backfill existing users who don't have a balance row yet
insert into credit_balances (user_id, balance, lifetime_purchased, lifetime_used)
  select id, 5000, 5000, 0
    from auth.users
    where id not in (select user_id from credit_balances)
  on conflict (user_id) do nothing;

-- Record grant transactions for backfilled users
insert into credit_transactions (user_id, amount, balance_after, type, metadata)
  select cb.user_id, 5000, 5000, 'grant', '{"reason": "signup_bonus_backfill"}'::jsonb
    from credit_balances cb
    where cb.user_id not in (select user_id from credit_transactions where type = 'grant');
