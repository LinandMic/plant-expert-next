-- M2 server-side privilege hardening.
-- The service_role is used only inside protected Next.js API routes.
-- Grant the minimum table privileges required by the two SECURITY INVOKER
-- credit RPCs and by server-side AI usage metering.

grant select on table public.user_entitlements to service_role;
grant select, update on table public.ai_credit_balances to service_role;
grant select, insert on table public.ai_credit_ledger to service_role;
grant insert on table public.ai_analysis_usage to service_role;
