-- 30_payout_lock.sql
-- ============================================================================
-- FIX: payout double-spend race.
--
-- request_payout checked the balance and then inserted the hold as two steps.
-- Two concurrent requests could BOTH read the same balance before either hold
-- landed, letting a helper cash out more than they have. A per-user advisory
-- lock serialises payout requests for the same account; different helpers are
-- unaffected. Same behaviour otherwise.
-- ============================================================================

create or replace function request_payout(
  p_amount_paise bigint,
  p_method       text,
  p_upi          text default null,
  p_account_name text default null,
  p_account_number text default null,
  p_ifsc         text default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  bal bigint;
  new_id bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_amount_paise < 10000 then raise exception 'Minimum payout is ₹100'; end if;
  if p_method not in ('upi','bank') then raise exception 'invalid method'; end if;
  if p_method = 'upi' and coalesce(p_upi,'') = '' then raise exception 'UPI ID required'; end if;
  if p_method = 'bank' and (coalesce(p_account_number,'') = '' or coalesce(p_ifsc,'') = '')
    then raise exception 'Bank account and IFSC required'; end if;

  -- One payout request at a time per user (released at transaction end).
  perform pg_advisory_xact_lock(hashtext(uid::text));

  select coalesce(sum(amount_paise),0) into bal from helper_earnings where user_id = uid;
  if p_amount_paise > bal then raise exception 'Amount exceeds your balance'; end if;

  insert into payout_requests(user_id, amount_paise, method, upi_id, account_name, account_number, ifsc)
    values (uid, p_amount_paise, p_method, p_upi, p_account_name, p_account_number, p_ifsc)
    returning id into new_id;
  insert into helper_earnings(user_id, amount_paise, reason)
    values (uid, -p_amount_paise, 'Payout requested #' || new_id);
  return new_id;
end $$;
revoke all on function request_payout(bigint,text,text,text,text,text) from public, anon;
grant execute on function request_payout(bigint,text,text,text,text,text) to authenticated;
