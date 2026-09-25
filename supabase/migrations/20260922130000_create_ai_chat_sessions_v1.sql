-- ALMEO Conversational Assistant V1 — chat session metadata + usage
-- telemetry. Not yet applied to any remote environment as of this
-- revision; represents the final intended schema/RPC state for first
-- application (see the security/logic review this revision addresses).
--
-- Stores ONLY what is required to enforce "one AI credit = one chat
-- session" server-side (ai_chat_sessions: ownership, lifecycle/status,
-- activity/limit counters, whether the session's credit has been
-- charged) and to measure real AI cost (ai_chat_usage: one row per
-- Anthropic call attempt, tokens/model/status only). Neither table
-- stores conversation content (no message text, no assistant replies,
-- no prompt text) — V1 keeps the transcript client/runtime-side only, by
-- product decision. No RAG/vector storage either.
--
-- Concurrency model:
--   - Credit double-charge protection is already provided by the
--     existing consume_ai_credit()/refund_ai_credit() functions (M2),
--     keyed on an idempotent request_key — pages/api/chat.js passes the
--     session id itself as that key, so two concurrent "first messages"
--     for the same session id can never both charge a credit, with no
--     new locking required here.
--   - The message-count and cumulative-token LIMITS are a different
--     problem: a plain "check, then later increment" (across the
--     Anthropic network call) cannot be made race-safe by locking alone,
--     because the check and the increment are necessarily in different
--     database transactions with a slow external call between them. This
--     revision closes that gap with an explicit reserve/reconcile
--     protocol:
--       1. reserve_chat_message — BEFORE calling Anthropic, atomically
--          (single `select ... for update`-locked transaction) validates
--          the session AND reserves capacity: increments
--          user_message_count by 1 and cumulative_tokens by a
--          conservative fixed estimate, in the SAME statement as the
--          limit check. Two concurrent reservations for the same session
--          therefore genuinely serialize on that row lock — the second
--          caller only proceeds once the first's reservation has
--          committed, and sees the already-incremented counts.
--       2. reconcile_chat_message — AFTER a successful Anthropic reply,
--          atomically replaces the reserved estimate with the real
--          token usage, records the credit charge, and re-evaluates
--          whether the session should now close. Idempotent: a retried
--          call for the same reservation id that has already been
--          finalized returns the current state without reapplying the
--          delta.
--       3. release_chat_message_reservation — used only for a LATER
--          (non-credit-charging) message whose Anthropic call failed:
--          gives the reserved message slot and token estimate back, so
--          a failed attempt never permanently costs the user part of
--          their 10-message/20k-token budget. Also idempotent.
--     A first-message Anthropic failure does not call release — the
--     session is refunded and permanently closed instead (see
--     close_chat_session below), so the reservation's effect on a now-
--     dead row is moot.

create table if not exists public.ai_chat_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  close_reason text,
  credit_charged boolean not null default false,
  credit_source text,
  user_message_count integer not null default 0,
  cumulative_tokens integer not null default 0,
  -- The currently outstanding (or most recent) reservation, written by
  -- reserve_chat_message and consumed by exactly one of
  -- reconcile_chat_message / release_chat_message_reservation.
  -- last_reservation_finalized=false means a reservation was taken but
  -- neither finalize step has completed for it yet (normal, brief, mid-
  -- request state — never read/acted on by anything except those two
  -- functions' own idempotency checks).
  last_reservation_id uuid,
  last_reservation_estimated_tokens integer,
  last_reservation_finalized boolean not null default true,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint ai_chat_sessions_status_check
    check (status in ('active', 'closed')),
  constraint ai_chat_sessions_close_reason_check
    check (
      close_reason is null
      or close_reason in (
        'message_limit', 'token_limit', 'inactivity_timeout',
        'first_call_refunded', 'first_call_refund_failed'
      )
    ),
  constraint ai_chat_sessions_close_reason_requires_closed
    check (close_reason is null or status = 'closed'),
  constraint ai_chat_sessions_credit_source_check
    check (credit_source is null or credit_source in ('included', 'purchased')),
  constraint ai_chat_sessions_user_message_count_nonnegative
    check (user_message_count >= 0),
  constraint ai_chat_sessions_cumulative_tokens_nonnegative
    check (cumulative_tokens >= 0)
);

create index if not exists ai_chat_sessions_user_id_idx
  on public.ai_chat_sessions(user_id, created_at desc);

alter table public.ai_chat_sessions enable row level security;

-- No client write path (INSERT/UPDATE/DELETE) is granted at all — every
-- mutation goes through the SECURITY INVOKER RPCs below, callable only by
-- service_role, exactly like consume_ai_credit/refund_ai_credit (M2).
-- Authenticated users get a narrow read-only policy so the client could
-- in principle inspect its own session rows for debugging, but V1's
-- client never queries this table directly (lib/chatApi.js tracks the
-- session id and server-reported counters from pages/api/chat.js's own
-- responses) — this exists for completeness/defence-in-depth only, not a
-- read path the app relies on.
drop policy if exists ai_chat_sessions_select_own on public.ai_chat_sessions;
create policy ai_chat_sessions_select_own
on public.ai_chat_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.ai_chat_sessions from anon, authenticated;
grant select on table public.ai_chat_sessions to authenticated;
grant select, insert, update on table public.ai_chat_sessions to service_role;

-- ai_chat_usage: one append-only row per Anthropic call ATTEMPT (never
-- per rejection that never reached Anthropic — NO_CREDITS/FORBIDDEN/
-- SESSION_CLOSED/invalid-body rows are not logged here, since no cost
-- was incurred and nothing needs reconciling for them). Column set is
-- deliberately the smallest that answers "cost per API call / session /
-- user / model" without ever holding conversation content.
create table if not exists public.ai_chat_usage (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null,
  session_id uuid not null references public.ai_chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  -- 'refunded'/'refund_failed' self-describe the refund outcome for a
  -- first-message failure — see the close_reason comment above for why
  -- a distinct 'refund_failed' state matters. 'reconcile_failed' means
  -- Anthropic replied successfully (the user got their answer) but
  -- reconcile_chat_message itself errored — this row IS the durable
  -- trace FIX 2 requires in place of a bare console.error, carrying
  -- enough (reservation_id, actual tokens) for a later manual/automated
  -- reconciliation pass to use, without this migration building that
  -- pass itself.
  status text not null
    check (status in ('succeeded', 'upstream_failed', 'refunded', 'refund_failed', 'reconcile_failed')),
  upstream_status integer,
  input_tokens integer,
  output_tokens integer,
  cache_creation_input_tokens integer,
  cache_read_input_tokens integer,
  is_first_message boolean not null,
  credit_source text
    check (credit_source is null or credit_source in ('included', 'purchased')),
  created_at timestamptz not null default now(),
  constraint ai_chat_usage_input_tokens_nonnegative check (input_tokens is null or input_tokens >= 0),
  constraint ai_chat_usage_output_tokens_nonnegative check (output_tokens is null or output_tokens >= 0),
  constraint ai_chat_usage_cache_creation_nonnegative check (cache_creation_input_tokens is null or cache_creation_input_tokens >= 0),
  constraint ai_chat_usage_cache_read_nonnegative check (cache_read_input_tokens is null or cache_read_input_tokens >= 0)
);

create index if not exists ai_chat_usage_user_created_at_idx
  on public.ai_chat_usage(user_id, created_at desc);
create index if not exists ai_chat_usage_session_id_idx
  on public.ai_chat_usage(session_id);

alter table public.ai_chat_usage enable row level security;

-- No policy at all is intentionally defined for any role — RLS with zero
-- policies denies every row to every role it applies to (authenticated,
-- anon). Combined with the grants below (authenticated gets none at all,
-- matching "default to no access unless product requires it" — V1 has no
-- "view my AI usage" feature), this table is reachable only by
-- service_role from pages/api/chat.js, never by any client.
revoke all on table public.ai_chat_usage from anon, authenticated;
grant select, insert on table public.ai_chat_usage to service_role;

-- reserve_chat_message: called BEFORE every Anthropic call (first
-- message or a follow-up). Atomically creates the session row on first
-- use (or fetches+locks the existing one), verifies ownership, rejects a
-- session that is closed or has just become closed (inactivity timeout —
-- closing it in the same statement if so), and then — still under the
-- same row lock — checks AND reserves message/token capacity together,
-- which is what actually prevents two concurrent requests from both
-- passing the limit check before either's usage is recorded.
create or replace function public.reserve_chat_message(
  p_session_id uuid,
  p_user_id uuid,
  p_inactivity_timeout_seconds integer,
  p_max_user_messages integer,
  p_max_cumulative_tokens integer,
  p_estimated_tokens integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.ai_chat_sessions%rowtype;
  v_now timestamptz := now();
  v_reservation_id uuid := gen_random_uuid();
begin
  if p_session_id is null or p_user_id is null then
    raise exception 'reserve_chat_message: p_session_id and p_user_id are required';
  end if;

  begin
    insert into public.ai_chat_sessions (id, user_id, status, created_at, last_activity_at)
    values (p_session_id, p_user_id, 'active', v_now, v_now);
  exception when unique_violation then
    -- Row already exists (a retry of the same session id, or a
    -- concurrent request racing to create it) — fall through and use the
    -- existing row instead.
    null;
  end;

  select * into v_row
  from public.ai_chat_sessions
  where id = p_session_id
  for update;

  if not found then
    -- Unreachable in practice (the unique_violation branch implies the
    -- row exists), but never leave this function without a row.
    return jsonb_build_object('ok', false, 'code', 'SESSION_STATE_MISSING');
  end if;

  if v_row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if v_row.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CLOSED', 'close_reason', v_row.close_reason);
  end if;

  if v_now - v_row.last_activity_at > make_interval(secs => p_inactivity_timeout_seconds) then
    update public.ai_chat_sessions
    set status = 'closed', close_reason = 'inactivity_timeout', closed_at = v_now
    where id = p_session_id;
    return jsonb_build_object('ok', false, 'code', 'SESSION_CLOSED', 'close_reason', 'inactivity_timeout');
  end if;

  -- Atomic capacity check-and-reserve. The row lock held since the
  -- SELECT ... FOR UPDATE above means no concurrent reserve_chat_message
  -- call for this same session id can be evaluating this check at the
  -- same time — a second caller blocks until this transaction commits,
  -- then sees the incremented counts below. This is what a separate
  -- check-then-later-increment (the previous revision's design) could
  -- not guarantee.
  if v_row.user_message_count >= p_max_user_messages then
    update public.ai_chat_sessions
    set status = 'closed', close_reason = 'message_limit', closed_at = v_now
    where id = p_session_id;
    return jsonb_build_object('ok', false, 'code', 'SESSION_CLOSED', 'close_reason', 'message_limit');
  end if;

  if v_row.cumulative_tokens + coalesce(p_estimated_tokens, 0) > p_max_cumulative_tokens then
    update public.ai_chat_sessions
    set status = 'closed', close_reason = 'token_limit', closed_at = v_now
    where id = p_session_id;
    return jsonb_build_object('ok', false, 'code', 'SESSION_CLOSED', 'close_reason', 'token_limit');
  end if;

  update public.ai_chat_sessions
  set
    user_message_count = user_message_count + 1,
    cumulative_tokens = cumulative_tokens + coalesce(p_estimated_tokens, 0),
    last_activity_at = v_now,
    last_reservation_id = v_reservation_id,
    last_reservation_estimated_tokens = coalesce(p_estimated_tokens, 0),
    last_reservation_finalized = false
  where id = p_session_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'credit_charged', v_row.credit_charged,
    'user_message_count', v_row.user_message_count,
    'cumulative_tokens', v_row.cumulative_tokens
  );
end;
$$;

-- reconcile_chat_message: called after a SUCCESSFUL Anthropic reply.
-- Atomically replaces the reservation's conservative token estimate with
-- the real usage, records the credit charge on the first successful
-- message only, and closes the session if the now-final counts have
-- reached a limit. Idempotent on (session, reservation_id): a retried
-- call for a reservation that was already finalized returns the current
-- state without reapplying the token delta or double-counting anything.
create or replace function public.reconcile_chat_message(
  p_session_id uuid,
  p_user_id uuid,
  p_reservation_id uuid,
  p_actual_tokens integer,
  p_credit_charged boolean,
  p_credit_source text,
  p_max_user_messages integer,
  p_max_cumulative_tokens integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.ai_chat_sessions%rowtype;
  v_now timestamptz := now();
  v_new_cumulative integer;
  v_next_status text;
  v_next_close_reason text;
begin
  if p_session_id is null or p_user_id is null or p_reservation_id is null then
    raise exception 'reconcile_chat_message: p_session_id, p_user_id and p_reservation_id are required';
  end if;

  select * into v_row
  from public.ai_chat_sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SESSION_STATE_MISSING');
  end if;

  if v_row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if v_row.last_reservation_id is distinct from p_reservation_id then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_MISMATCH');
  end if;

  if v_row.last_reservation_finalized then
    return jsonb_build_object(
      'ok', true,
      'already_reconciled', true,
      'status', v_row.status,
      'close_reason', v_row.close_reason,
      'user_message_count', v_row.user_message_count,
      'cumulative_tokens', v_row.cumulative_tokens
    );
  end if;

  v_new_cumulative := v_row.cumulative_tokens - coalesce(v_row.last_reservation_estimated_tokens, 0) + coalesce(p_actual_tokens, 0);
  if v_new_cumulative < 0 then
    v_new_cumulative := 0;
  end if;

  v_next_status := 'active';
  v_next_close_reason := null;

  if v_row.user_message_count >= p_max_user_messages then
    v_next_status := 'closed';
    v_next_close_reason := 'message_limit';
  elsif v_new_cumulative >= p_max_cumulative_tokens then
    v_next_status := 'closed';
    v_next_close_reason := 'token_limit';
  end if;

  update public.ai_chat_sessions
  set
    cumulative_tokens = v_new_cumulative,
    last_activity_at = v_now,
    credit_charged = credit_charged or coalesce(p_credit_charged, false),
    credit_source = case
      when not credit_charged and coalesce(p_credit_charged, false) then p_credit_source
      else credit_source
    end,
    last_reservation_finalized = true,
    status = v_next_status,
    close_reason = v_next_close_reason,
    closed_at = case when v_next_status = 'closed' then v_now else null end
  where id = p_session_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'already_reconciled', false,
    'status', v_row.status,
    'close_reason', v_row.close_reason,
    'user_message_count', v_row.user_message_count,
    'cumulative_tokens', v_row.cumulative_tokens
  );
end;
$$;

-- release_chat_message_reservation: used only when a LATER (non-credit-
-- charging) message's Anthropic call fails. Gives the reserved message
-- slot and token estimate back atomically, so a failed attempt never
-- permanently costs part of the session's 10-message/20k-token budget.
-- Also idempotent on (session, reservation_id).
create or replace function public.release_chat_message_reservation(
  p_session_id uuid,
  p_user_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.ai_chat_sessions%rowtype;
begin
  if p_session_id is null or p_user_id is null or p_reservation_id is null then
    raise exception 'release_chat_message_reservation: p_session_id, p_user_id and p_reservation_id are required';
  end if;

  select * into v_row
  from public.ai_chat_sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SESSION_STATE_MISSING');
  end if;

  if v_row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  if v_row.last_reservation_id is distinct from p_reservation_id then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_MISMATCH');
  end if;

  if v_row.last_reservation_finalized then
    return jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'user_message_count', v_row.user_message_count,
      'cumulative_tokens', v_row.cumulative_tokens
    );
  end if;

  update public.ai_chat_sessions
  set
    user_message_count = greatest(user_message_count - 1, 0),
    cumulative_tokens = greatest(cumulative_tokens - coalesce(last_reservation_estimated_tokens, 0), 0),
    last_reservation_finalized = true
  where id = p_session_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'already_finalized', false,
    'user_message_count', v_row.user_message_count,
    'cumulative_tokens', v_row.cumulative_tokens
  );
end;
$$;

-- close_chat_session: called when the FIRST Anthropic call for a session
-- fails before a usable reply, AFTER a refund_ai_credit attempt (whether
-- or not that refund itself succeeded — see FIX 4: the caller passes
-- close_reason='first_call_refunded' when the refund succeeded, or
-- 'first_call_refund_failed' when it did not, so a lost credit is a
-- durable, queryable fact rather than only a server log line).
-- Permanently closes the session either way — reserve_chat_message will
-- reject any future call with this id, so the client must mint a new
-- session id to retry.
create or replace function public.close_chat_session(
  p_session_id uuid,
  p_user_id uuid,
  p_close_reason text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.ai_chat_sessions%rowtype;
begin
  if p_session_id is null or p_user_id is null then
    raise exception 'close_chat_session: p_session_id and p_user_id are required';
  end if;

  select * into v_row
  from public.ai_chat_sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'SESSION_STATE_MISSING');
  end if;

  if v_row.user_id <> p_user_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  update public.ai_chat_sessions
  set status = 'closed', close_reason = p_close_reason, closed_at = now()
  where id = p_session_id;

  return jsonb_build_object('ok', true, 'status', 'closed', 'close_reason', p_close_reason);
end;
$$;

revoke all on function public.reserve_chat_message(uuid, uuid, integer, integer, integer, integer) from public;
revoke all on function public.reserve_chat_message(uuid, uuid, integer, integer, integer, integer) from anon;
revoke all on function public.reserve_chat_message(uuid, uuid, integer, integer, integer, integer) from authenticated;
grant execute on function public.reserve_chat_message(uuid, uuid, integer, integer, integer, integer) to service_role;

revoke all on function public.reconcile_chat_message(uuid, uuid, uuid, integer, boolean, text, integer, integer) from public;
revoke all on function public.reconcile_chat_message(uuid, uuid, uuid, integer, boolean, text, integer, integer) from anon;
revoke all on function public.reconcile_chat_message(uuid, uuid, uuid, integer, boolean, text, integer, integer) from authenticated;
grant execute on function public.reconcile_chat_message(uuid, uuid, uuid, integer, boolean, text, integer, integer) to service_role;

revoke all on function public.release_chat_message_reservation(uuid, uuid, uuid) from public;
revoke all on function public.release_chat_message_reservation(uuid, uuid, uuid) from anon;
revoke all on function public.release_chat_message_reservation(uuid, uuid, uuid) from authenticated;
grant execute on function public.release_chat_message_reservation(uuid, uuid, uuid) to service_role;

revoke all on function public.close_chat_session(uuid, uuid, text) from public;
revoke all on function public.close_chat_session(uuid, uuid, text) from anon;
revoke all on function public.close_chat_session(uuid, uuid, text) from authenticated;
grant execute on function public.close_chat_session(uuid, uuid, text) to service_role;
