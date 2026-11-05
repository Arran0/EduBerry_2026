#!/usr/bin/env bash
# Checks that a DigitalOcean managed Postgres cluster supports EdZee's multi-tenant
# model: one database per school, shared roles, a login role per school that can
# only open its own database, row-level security as the signed-in user, the auth
# shim, the extensions, cloning a school from a template, and dump/restore.
# It creates throwaway databases and roles named edzee_t_* and removes them at the end.
#
# Usage (on a Mac, with psql from `brew install libpq` on the PATH):
#   read -rs DO_ADMIN_URL && export DO_ADMIN_URL    # doadmin connection string from the DO console
#   bash verify.sh
set -u
: "${DO_ADMIN_URL:?Set DO_ADMIN_URL to the doadmin connection string (see README.md)}"
command -v psql >/dev/null || { echo "psql not found: brew install libpq && brew link --force libpq"; exit 1; }

db_url(){ # db_url <url> <database> [user] [password]
  python3 - "$@" <<'PY'
import sys, urllib.parse as u
url, db = sys.argv[1], sys.argv[2]
p = u.urlsplit(url)
host = p.hostname + (f":{p.port}" if p.port else "")
user = sys.argv[3] if len(sys.argv) > 3 else p.username
pw = sys.argv[4] if len(sys.argv) > 4 else p.password
print(u.urlunsplit((p.scheme, f"{u.quote(user)}:{u.quote(pw)}@{host}", "/" + db, p.query or "sslmode=require", "")))
PY
}
ADMIN(){ psql "$(db_url "$DO_ADMIN_URL" "$1")" -v ON_ERROR_STOP=1 -qtA "${@:2}"; }
ok(){ echo "PASS  $1"; PASS=$((PASS+1)); }; bad(){ echo "FAIL  $1: $2"; FAIL=$((FAIL+1)); }
PASS=0; FAIL=0
PW_A="t$(openssl rand -hex 12)"; PW_B="t$(openssl rand -hex 12)"

cleanup(){
  for d in edzee_t_c edzee_t_a edzee_t_b edzee_t_template; do ADMIN defaultdb -c "drop database if exists $d" >/dev/null 2>&1; done
  ADMIN defaultdb -c "drop role if exists edzee_t_worker_a; drop role if exists edzee_t_worker_b; drop role if exists edzee_t_auth; drop role if exists edzee_t_anon;" >/dev/null 2>&1
}
cleanup; trap cleanup EXIT

echo "doadmin attributes: $(ADMIN defaultdb -c "select 'createrole='||rolcreaterole||' createdb='||rolcreatedb||' bypassrls='||rolbypassrls||' superuser='||rolsuper from pg_roles where rolname=current_user")"
echo "server: $(ADMIN defaultdb -c "show server_version")"

# Real schools use the names anon/authenticated; the test uses prefixed names so it never touches real roles.
ADMIN defaultdb -c "create role edzee_t_anon nologin; create role edzee_t_auth nologin;" && ok "admin creates shared NOLOGIN roles" || bad "roles" "admin cannot create roles"
ADMIN defaultdb -c "create database edzee_t_template" && ok "admin creates a database with SQL" || bad "create database" "use the DO API instead"

ADMIN edzee_t_template <<'SQL' && ok "template: extensions schema, auth shim, RLS, SECURITY DEFINER, trigger" || bad "template" "see the error above"
create schema extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists btree_gist schema extensions;
create schema auth;
create table auth.users (id uuid primary key, email text unique, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text, role text default 'student');
alter table public.profiles enable row level security;
create function public.get_user_role() returns text language sql stable security definer set search_path = public as $$ select role from public.profiles where id = (select auth.uid()) $$;
create policy own_or_staff on public.profiles for select to edzee_t_auth using (id = (select auth.uid()) or (select public.get_user_role()) in ('teacher','admin'));
create function public.receipt_hash(t text) returns text language sql security definer set search_path = public as $$ select encode(extensions.digest(t,'sha256'),'hex') $$;
create table public.leaves (id bigserial primary key, applicant uuid references public.profiles(id), during daterange, exclude using gist (applicant with =, during with &&));
alter table public.leaves enable row level security;
create policy own_leave on public.leaves for all to edzee_t_auth using (applicant = (select auth.uid())) with check (applicant = (select auth.uid()));
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name','User')) on conflict do nothing; return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
grant usage on schema public, auth, extensions to edzee_t_auth, edzee_t_anon;
grant select on public.profiles to edzee_t_auth;
grant select, insert on public.leaves to edzee_t_auth; grant usage on sequence public.leaves_id_seq to edzee_t_auth;
grant execute on function public.receipt_hash(text) to edzee_t_auth;
SQL

for s in a b; do
  t0=$(python3 -c 'import time;print(time.time())')
  ADMIN defaultdb -c "create database edzee_t_$s template edzee_t_template" >/dev/null && ok "new school edzee_t_$s cloned from the template in $(python3 -c "import time;print(round((time.time()-$t0)*1000))") ms" || bad "clone" "CREATE DATABASE ... TEMPLATE not allowed"
  pw=$([ $s = a ] && echo $PW_A || echo $PW_B)
  ADMIN defaultdb -c "create role edzee_t_worker_$s login password '$pw'; grant edzee_t_auth, edzee_t_anon to edzee_t_worker_$s with inherit false; revoke connect on database edzee_t_$s from public; grant connect on database edzee_t_$s to edzee_t_worker_$s;" && ok "login role for school $s, NOINHERIT, CONNECT only to its database" || bad "login role $s" "see the error above"
done

ADMIN edzee_t_a -c "insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-000000000001','s1@x','{\"full_name\":\"S1\"}'),('00000000-0000-0000-0000-000000000002','s2@x','{}'),('00000000-0000-0000-0000-000000000003','t1@x','{}'); update public.profiles set role='teacher' where id='00000000-0000-0000-0000-000000000003';"
[ "$(ADMIN edzee_t_a -c "select count(*) from public.profiles")" = 3 ] && ok "trigger on our auth.users creates profiles" || bad "trigger" "profiles not created"

WURL=$(db_url "$DO_ADMIN_URL" edzee_t_a edzee_t_worker_a "$PW_A")
q(){ printf "begin;\nset local role edzee_t_auth;\nselect set_config('request.jwt.claims','{\"sub\":\"%s\"}',true) is not null;\n%s;\ncommit;\n" "$1" "$2" | psql "$WURL" -qtA 2>&1 | grep -v '^t$' | tail -1; }
S1=00000000-0000-0000-0000-000000000001; T1=00000000-0000-0000-0000-000000000003
[ "$(q $S1 "select count(*) from public.profiles")" = 1 ] && ok "RLS: a student sees only their own profile" || bad "student RLS" "wrong row count"
[ "$(q $T1 "select count(*) from public.profiles")" = 3 ] && ok "RLS: a teacher sees all, through a SECURITY DEFINER helper" || bad "teacher RLS" "wrong row count"
q $S1 "insert into public.leaves(applicant,during) values ('00000000-0000-0000-0000-000000000002','[2026-11-10,2026-11-12)')" | grep -qi "row-level security" && ok "RLS: a student cannot write someone else's row" || bad "RLS write" "insert was allowed"
q $S1 "insert into public.leaves(applicant,during) values ('$S1','[2026-11-10,2026-11-12)')" >/dev/null
q $S1 "insert into public.leaves(applicant,during) values ('$S1','[2026-11-11,2026-11-13)')" | grep -qi "conflict\|exclusion" && ok "btree_gist exclusion constraint works" || bad "exclusion" "overlap was allowed"
[ "$(q $S1 "select length(public.receipt_hash('x'))")" = 64 ] && ok "pgcrypto in the extensions schema" || bad "pgcrypto" "digest failed"
psql "$WURL" -qtAc "select count(*) from public.profiles" 2>&1 | grep -qi "permission denied" && ok "the login role alone reads nothing" || bad "login role" "it could read without switching role"
psql "$(db_url "$DO_ADMIN_URL" edzee_t_b edzee_t_worker_a "$PW_A")" -qtAc "select 1" 2>&1 | grep -qi "permission denied\|CONNECT privilege" && ok "school a's login cannot open school b's database" || bad "isolation" "it could connect"

DUMP=$(mktemp)
pg_dump "$(db_url "$DO_ADMIN_URL" edzee_t_a)" -Fc -f "$DUMP" 2>/dev/null && ADMIN defaultdb -c "create database edzee_t_c" \
  && pg_restore -d "$(db_url "$DO_ADMIN_URL" edzee_t_c)" --no-owner --no-privileges "$DUMP" >/dev/null 2>&1
[ "$(ADMIN edzee_t_c -c "select count(*) from public.profiles" 2>/dev/null)" = 3 ] && ok "pg_dump and pg_restore by doadmin" || bad "dump/restore" "restore incomplete (pg_dump/pg_restore must match the server version)"
rm -f "$DUMP"

echo; echo "$PASS passed, $FAIL failed. Test databases and roles are removed on exit. Paste this output into the chat."
