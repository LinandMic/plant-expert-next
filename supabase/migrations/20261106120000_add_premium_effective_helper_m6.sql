-- ALMEO Monetization M6
-- Single definition of "effective Premium", shared by the Free limits (M7)
-- and the credit functions of the next migrations. It takes the entitlement
-- values rather than a user id so that callers keep their own row lock
-- (select ... for update) and pass what they read.
--
-- Fails closed: anything other than a premium tier with a covered status and
-- a period end strictly in the future (including a null end) is not Premium.

create or replace function public.is_premium_effective(
  p_tier text,
  p_status text,
  p_period_end timestamptz,
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_tier = 'premium'
    and p_status in ('active', 'grace_period', 'canceled')
    and p_period_end > p_at,
    false
  );
$$;

comment on function public.is_premium_effective(text, text, timestamptz, timestamptz) is
  'Effective Premium: tier = premium AND subscription_status in (active, grace_period, canceled) AND current_period_end_at > p_at. grace_period keeps Premium, past_due does not (decision 5). A refund or revocation ends Premium like an expiry, through status expired (decision 7). A canceled but paid subscription stays Premium until current_period_end_at (decision 11). A null period end is never Premium. Billing must therefore keep current_period_end_at up to date, including during the grace period.';

revoke all on function public.is_premium_effective(text, text, timestamptz, timestamptz) from public;
revoke all on function public.is_premium_effective(text, text, timestamptz, timestamptz) from anon;
grant execute on function public.is_premium_effective(text, text, timestamptz, timestamptz) to authenticated, service_role;
