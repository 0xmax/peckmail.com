-- Increase signup grant from 5000 to 20000 credits (4x)
create or replace function public.ensure_credit_balance(p_user_id uuid) returns void language plpgsql as $$
declare
  v_grant bigint := 20000;
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
