-- Fix: fully qualify all table/function references with public. schema so
-- SECURITY DEFINER triggers (running as supabase_auth_admin) can resolve them.

create or replace function public.ensure_credit_balance(p_user_id uuid) returns void language plpgsql as $$
declare
  v_grant bigint := 5000;
begin
  insert into public.credit_balances (user_id, balance, lifetime_purchased, lifetime_used)
    values (p_user_id, v_grant, v_grant, 0)
    on conflict (user_id) do nothing;

  if found then
    insert into public.credit_transactions (user_id, amount, balance_after, type, service, metadata)
      values (p_user_id, v_grant, v_grant, 'grant', null, '{"reason": "signup_bonus"}'::jsonb);
  end if;
end;
$$;

create or replace function public.deduct_credits(
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
  select cb.balance into v_balance
    from public.credit_balances cb
    where cb.user_id = p_user_id
    for update;

  if not found then
    perform public.ensure_credit_balance(p_user_id);
    select cb.balance into v_balance
      from public.credit_balances cb
      where cb.user_id = p_user_id
      for update;
  end if;

  select coalesce(sum(ch.amount), 0) into v_held
    from public.credit_holds ch
    where ch.user_id = p_user_id and ch.status = 'held';

  v_available := v_balance - v_held;

  if v_available < p_amount then
    return query select false, v_available;
    return;
  end if;

  v_new_balance := v_balance - p_amount;

  update public.credit_balances cb
    set balance = v_new_balance,
        lifetime_used = cb.lifetime_used + p_amount,
        updated_at = now()
    where cb.user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, balance_after, type, service, project_id, metadata)
    values (p_user_id, -p_amount, v_new_balance, 'usage', p_service, p_project_id, p_metadata);

  return query select true, v_new_balance;
end;
$$;

create or replace function public.place_hold(
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
  select cb.balance into v_balance
    from public.credit_balances cb
    where cb.user_id = p_user_id
    for update;

  if not found then
    perform public.ensure_credit_balance(p_user_id);
    select cb.balance into v_balance
      from public.credit_balances cb
      where cb.user_id = p_user_id
      for update;
  end if;

  select coalesce(sum(ch.amount), 0) into v_held
    from public.credit_holds ch
    where ch.user_id = p_user_id and ch.status = 'held';

  v_available := v_balance - v_held;

  if v_available < p_amount then
    return query select false, null::uuid;
    return;
  end if;

  insert into public.credit_holds (user_id, amount, service, project_id, metadata)
    values (p_user_id, p_amount, p_service, p_project_id, p_metadata)
    returning id into v_hold_id;

  return query select true, v_hold_id;
end;
$$;

create or replace function public.settle_hold(
  p_hold_id uuid,
  p_actual_amount bigint,
  p_metadata jsonb default '{}'
) returns void language plpgsql as $$
declare
  v_hold record;
  v_new_balance bigint;
begin
  select * into v_hold from public.credit_holds where id = p_hold_id and status = 'held' for update;
  if not found then
    raise exception 'Hold not found or already settled: %', p_hold_id;
  end if;

  update public.credit_balances cb
    set balance = cb.balance - p_actual_amount,
        lifetime_used = cb.lifetime_used + p_actual_amount,
        updated_at = now()
    where cb.user_id = v_hold.user_id
    returning balance into v_new_balance;

  insert into public.credit_transactions (user_id, amount, balance_after, type, service, project_id, metadata)
    values (v_hold.user_id, -p_actual_amount, v_new_balance, 'usage', v_hold.service, v_hold.project_id, p_metadata);

  update public.credit_holds set status = 'settled', settled_at = now() where id = p_hold_id;
end;
$$;

create or replace function public.release_hold(p_hold_id uuid) returns void language plpgsql as $$
begin
  update public.credit_holds
    set status = 'released', settled_at = now()
    where id = p_hold_id and status = 'held';
end;
$$;

create or replace function public.release_stale_holds(p_max_age_minutes int default 10) returns int language plpgsql as $$
declare
  v_count int;
begin
  update public.credit_holds
    set status = 'released', settled_at = now()
    where status = 'held'
      and created_at < now() - (p_max_age_minutes || ' minutes')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.add_credits(
  p_user_id uuid,
  p_amount bigint,
  p_type text,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'
) returns table(success boolean, balance_after bigint) language plpgsql as $$
declare
  v_new_balance bigint;
begin
  if p_idempotency_key is not null then
    select ct.balance_after into v_new_balance
      from public.credit_transactions ct
      where ct.idempotency_key = p_idempotency_key;
    if found then
      return query select true, v_new_balance;
      return;
    end if;
  end if;

  perform public.ensure_credit_balance(p_user_id);

  update public.credit_balances cb
    set balance = cb.balance + p_amount,
        lifetime_purchased = case when p_type = 'purchase' then cb.lifetime_purchased + p_amount else cb.lifetime_purchased end,
        updated_at = now()
    where cb.user_id = p_user_id
    returning balance into v_new_balance;

  insert into public.credit_transactions (user_id, amount, balance_after, type, idempotency_key, metadata)
    values (p_user_id, p_amount, v_new_balance, p_type, p_idempotency_key, p_metadata);

  return query select true, v_new_balance;
end;
$$;

create or replace function public.handle_new_user_credits() returns trigger language plpgsql security definer as $$
begin
  perform public.ensure_credit_balance(new.id);
  return new;
end;
$$;
