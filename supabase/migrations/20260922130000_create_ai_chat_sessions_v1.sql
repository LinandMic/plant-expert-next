-- ALMEO Conversational Assistant V1 — chat session metadata.
--
-- Stores ONLY what is required to enforce "one AI credit = one chat
-- session" server-side: ownership, lifecycle/status, activity/limit
-- counters, and whether the session's credit has been charged. It does
-- NOT store conversation content (no message text, no assistant replies)
-- — V1 keeps the transcript client/runtime-side only, by product
-- decision. No RAG/vector storage either.
--
-- Concurrency model:
--   - Credit double-charge protection is already provided by the
--     existing consume_ai_credit()/refund_ai_credit() functions (M2),
--     keyed on an idempotent request_key — pages/api/chat.js passes the
--     session id itself as that key, so two concurrent "first messages"
--     for the same session id can never both charge a credit, with no
--     new locking required here.
--   - This migration's three RPCs instead protect THIS table's own
--     invariants (message/token counters, status transitions, ownership)
--     from races, each via `select ... for update` on the one session
--     row before mutating it. Session limit THRESHOLDS are passed in as
--     explicit arguments from lib/chatConfig.js (the single source of
--     truth for those numbers) rather than hardcoded here, so the limits
--     are never defined twice.

create table if not exists public.ai_chat_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  close_reason text,
  credit_charged boolean not null default false,
  credit_source text,
  user_message_count integer not null default 0,
  cumulative_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint ai_chat_sessions_status_check
    check (status in ('active', 'closed')),
  constraint ai_chat_sessions_close_reason_check
    check (
      close_reason is null
      or close_reason in ('message_limit', 'token_limit', 'inactivity_timeout', 'first_call_refunded')
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

-- open_chat_session: called before every Anthropic call (first message or
-- a follow-up). Atomically creates the session row on first use (or
-- fetches+locks the existing one), verifies ownership, and rejects a
-- session that is closed or has just become closed (inactivity timeout,
-- or an already-reached message/token limit discovered late) — closing
-- it in the same statement if so. Returns enough state for the caller to
-- know whether this is the charge-triggering message (credit_charged
-- still false).
create or replace function public.open_chat_session(
  p_session_id uuid,
  p_user_id uuid,
  p_inactivity_timeout_seconds integer,
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
begin
  if p_session_id is null or p_user_id is null then
    raise exception 'open_chat_session: p_session_id and p_user_id are required';
  end if;

  begin
    insert into public.ai_chat_sessions (id, user_id, status, created_at, last_activity_at)
    values (p_session_id, p_user_id, 'active', v_now, v_now)
    returning * into v_row;

    return jsonb_build_object(
      'ok', true,
      'is_new', true,
      'credit_charged', false,
      'user_message_count', 0,
      'cumulative_tokens', 0
    );
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
    -- Should be unreachable (the unique_violation above implies the row
    -- exists), but never leave this function without a row.
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

  if v_row.user_message_count >= p_max_user_messages then
    update public.ai_chat_sessions
    set status = 'closed', close_reason = 'message_limit', closed_at = v_now
    where id = p_session_id;
    return jsonb_build_object('ok', false, 'code', 'SESSION_CLOSED', 'close_reason', 'message_limit');
  end if;

  if v_row.cumulative_tokens >= p_max_cumulative_tokens then
    update public.ai_chat_sessions
    set status = 'closed', close_reason = 'token_limit', closed_at = v_now
    where id = p_session_id;
    return jsonb_build_object('ok', false, 'code', 'SESSION_CLOSED', 'close_reason', 'token_limit');
  end if;

  update public.ai_chat_sessions
  set last_activity_at = v_now
  where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'is_new', false,
    'credit_charged', v_row.credit_charged,
    'user_message_count', v_row.user_message_count,
    'cumulative_tokens', v_row.cumulative_tokens
  );
end;
$$;

-- record_chat_message_result: called after a SUCCESSFUL Anthropic reply.
-- Atomically increments the message/token counters, records the credit
-- charge on the first successful message only, and closes the session if
-- this message just reached a limit (so the NEXT request's
-- open_chat_session call rejects cleanly rather than relying on the
-- client to stop asking).
create or replace function public.record_chat_message_result(
  p_session_id uuid,
  p_user_id uuid,
  p_credit_charged boolean,
  p_credit_source text,
  p_token_count integer,
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
  v_next_status text;
  v_next_close_reason text;
begin
  if p_session_id is null or p_user_id is null then
    raise exception 'record_chat_message_result: p_session_id and p_user_id are required';
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

  v_next_status := 'active';
  v_next_close_reason := null;

  if (v_row.user_message_count + 1) >= p_max_user_messages then
    v_next_status := 'closed';
    v_next_close_reason := 'message_limit';
  elsif (v_row.cumulative_tokens + coalesce(p_token_count, 0)) >= p_max_cumulative_tokens then
    v_next_status := 'closed';
    v_next_close_reason := 'token_limit';
  end if;

  update public.ai_chat_sessions
  set
    user_message_count = user_message_count + 1,
    cumulative_tokens = cumulative_tokens + coalesce(p_token_count, 0),
    last_activity_at = v_now,
    credit_charged = credit_charged or coalesce(p_credit_charged, false),
    credit_source = case
      when not credit_charged and coalesce(p_credit_charged, false) then p_credit_source
      else credit_source
    end,
    status = v_next_status,
    close_reason = v_next_close_reason,
    closed_at = case when v_next_status = 'closed' then v_now else null end
  where id = p_session_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'close_reason', v_row.close_reason,
    'user_message_count', v_row.user_message_count,
    'cumulative_tokens', v_row.cumulative_tokens
  );
end;
$$;

-- close_chat_session: called when the FIRST Anthropic call for a session
-- fails before a usable reply (after the credit has already been
-- refunded via the existing refund_ai_credit()). Permanently closes the
-- session — open_chat_session will reject any future call with this id,
-- so the client must mint a new session id to retry, exactly as the V1
-- spec requires.
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

revoke all on function public.open_chat_session(uuid, uuid, integer, integer, integer) from public;
revoke all on function public.open_chat_session(uuid, uuid, integer, integer, integer) from anon;
revoke all on function public.open_chat_session(uuid, uuid, integer, integer, integer) from authenticated;
grant execute on function public.open_chat_session(uuid, uuid, integer, integer, integer) to service_role;

revoke all on function public.record_chat_message_result(uuid, uuid, boolean, text, integer, integer, integer) from public;
revoke all on function public.record_chat_message_result(uuid, uuid, boolean, text, integer, integer, integer) from anon;
revoke all on function public.record_chat_message_result(uuid, uuid, boolean, text, integer, integer, integer) from authenticated;
grant execute on function public.record_chat_message_result(uuid, uuid, boolean, text, integer, integer, integer) to service_role;

revoke all on function public.close_chat_session(uuid, uuid, text) from public;
revoke all on function public.close_chat_session(uuid, uuid, text) from anon;
revoke all on function public.close_chat_session(uuid, uuid, text) from authenticated;
grant execute on function public.close_chat_session(uuid, uuid, text) to service_role;
