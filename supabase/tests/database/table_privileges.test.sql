-- Exact table privileges of anon, authenticated and service_role on every
-- public table, matching production (after 20261104120000 hardening), and
-- RLS enabled everywhere. Runs only against the local database, rolled back.
--
-- Privilege letters follow PostgreSQL's ACL notation: a=INSERT r=SELECT
-- w=UPDATE d=DELETE D=TRUNCATE x=REFERENCES t=TRIGGER m=MAINTAIN.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.table_acl(tbl regclass) returns text language sql stable as $$
  with p as (
    select r.rolname::text as grantee, m.letter, m.ord
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    join pg_roles r on r.oid = a.grantee
    join (values
      ('INSERT', 'a', 1), ('SELECT', 'r', 2), ('UPDATE', 'w', 3), ('DELETE', 'd', 4),
      ('TRUNCATE', 'D', 5), ('REFERENCES', 'x', 6), ('TRIGGER', 't', 7), ('MAINTAIN', 'm', 8)
    ) as m(privilege_type, letter, ord) on m.privilege_type = a.privilege_type
    where c.oid = tbl
      and r.rolname in ('anon', 'authenticated', 'service_role')
  ), g as (
    select grantee, string_agg(letter, '' order by ord) as privs
    from p
    group by grantee
  )
  select coalesce(string_agg(grantee || '=' || privs, ',' order by grantee), '') from g;
$$;

create temp table expected_acl (table_name text primary key, acl text) on commit drop;
insert into expected_acl values
  ('ai_analysis_usage',        'service_role=aDxtm'),
  ('ai_chat_sessions',         'authenticated=r,service_role=arwDxtm'),
  ('ai_chat_usage',            'service_role=arDxtm'),
  ('ai_credit_balances',       'authenticated=r,service_role=rwDxtm'),
  ('ai_credit_ledger',         'service_role=arDxtm'),
  ('garden_zones',             'authenticated=arwd,service_role=rDxtm'),
  ('plant_catalog',            'anon=r,authenticated=r,service_role=arwdDxtm'),
  ('plant_common_names',       'anon=r,authenticated=r,service_role=arwdDxtm'),
  ('plant_photos',             'authenticated=arwd,service_role=rDxtm'),
  ('plant_reminders',          'authenticated=arwd,service_role=rDxtm'),
  ('plant_source_records',     'service_role=arwdDxtm'),
  ('plant_taxa',               'anon=r,authenticated=r,service_role=arwdDxtm'),
  ('plant_taxon_names',        'anon=r,authenticated=r,service_role=arwdDxtm'),
  ('plant_trait_observations', 'service_role=arwdDxtm'),
  ('plant_trait_selections',   'service_role=arwdDxtm'),
  ('plants',                   'authenticated=arwd,service_role=rDxtm'),
  ('premium_period_grants',    'service_role=r'),
  ('profiles',                 'authenticated=rw,service_role=rDxtm'),
  ('user_entitlements',        'authenticated=r,service_role=rDxtm');

-- One test per table: exact privileges per role
select is(pg_temp.table_acl(('public.' || table_name)::regclass), acl, 'privileges on public.' || table_name)
from expected_acl
order by table_name;

-- Every public table has an expectation above (a new table must be added here)
select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and c.relname not in (select table_name from expected_acl) $$,
  'every public table has an expected privilege list'
);

-- RLS on every public table
select is_empty(
  $$ select c.relname::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not c.relrowsecurity $$,
  'every public table has RLS enabled'
);

-- Hardening: no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN for anon or authenticated
select is_empty(
  $$ select c.relname::text || ' ' || r.rolname || ' ' || a.privilege_type
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
     join pg_roles r on r.oid = a.grantee
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and r.rolname in ('anon', 'authenticated')
       and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN') $$,
  'anon and authenticated have no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on public tables'
);

select * from finish();
rollback;
