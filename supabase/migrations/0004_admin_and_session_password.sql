-- 0004: an admin password that gates session creation, and a per-session
-- password that gates grading access.
--
-- Run in the Supabase SQL Editor after 0003.
-- Rollback: 0004_rollback.sql restores 0003 behaviour.

-- ###########################################################################
-- EDIT THE PASSWORD ON THE NEXT LINE BEFORE RUNNING THIS FILE.
-- Anyone who knows it can create and delete sessions.
-- ###########################################################################

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

insert into public.app_config (key, value)
values ('admin_password', 'CHANGE-ME-BEFORE-RUNNING')
on conflict (key) do update set value = excluded.value;

-- RLS on with NO policies at all: the anon role can never read this table.
-- The admin password therefore never reaches the browser. Only the
-- SECURITY DEFINER function below can see it.
alter table public.app_config enable row level security;

-- ---------------------------------------------------------------------------
-- Admin check.
--
-- This is the one secret in the system that is genuinely secret: it is typed
-- by the admin, sent as a request header, and compared inside Postgres. It is
-- never part of the JavaScript bundle, so reading the bundle does not reveal
-- it.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.req_header('x-admin-password') is not null
     and exists (
       select 1 from public.app_config
       where key = 'admin_password'
         and value = public.req_header('x-admin-password')
     )
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-session password.
-- ---------------------------------------------------------------------------
alter table public.sessions add column if not exists join_password text;

-- Sessions created before this migration have no password. Seed it to the
-- session code so they stay reachable; change it from the app afterwards.
update public.sessions set join_password = code where join_password is null;

alter table public.sessions alter column join_password set not null;

alter table public.sessions drop constraint if exists sessions_join_password_len;
alter table public.sessions add constraint sessions_join_password_len
  check (char_length(join_password) >= 4);

-- Access to a session requires naming it (id or code) AND the password.
create or replace function public.session_unlocked(s_id uuid, s_code text, s_pw text)
returns boolean
language sql
stable
as $$
  select
    (
      s_id::text = public.req_header('x-session-id')
      or s_code  = public.req_header('x-session-code')
    )
    and s_pw = public.req_header('x-session-password')
$$;

grant execute on function public.session_unlocked(uuid, text, text) to anon, authenticated;

create or replace function public.can_access_session(sid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = sid
      and (
        public.is_admin()
        or public.session_unlocked(s.id, s.code, s.join_password)
      )
  )
$$;

-- --- sessions -------------------------------------------------------------

drop policy if exists sessions_read   on public.sessions;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;
drop policy if exists sessions_delete on public.sessions;

create policy sessions_read on public.sessions for select
  using (public.is_admin() or public.session_unlocked(id, code, join_password));

-- Only an admin may create a session. This is the role split.
create policy sessions_insert on public.sessions for insert
  with check (public.is_admin());

create policy sessions_update on public.sessions for update
  using (public.is_admin() or public.session_unlocked(id, code, join_password))
  with check (public.is_admin() or public.session_unlocked(id, code, join_password));

-- Only an admin may destroy a session.
create policy sessions_delete on public.sessions for delete
  using (public.is_admin());

-- --- graders --------------------------------------------------------------

drop policy if exists graders_read   on public.graders;
drop policy if exists graders_insert on public.graders;
drop policy if exists graders_update on public.graders;
drop policy if exists graders_delete on public.graders;

create policy graders_read on public.graders for select
  using (public.can_access_session(session_id));

-- Adding graders is session setup, so it is admin-only.
create policy graders_insert on public.graders for insert
  with check (public.is_admin());

create policy graders_update on public.graders for update
  using (public.can_access_session(session_id))
  with check (public.can_access_session(session_id));

create policy graders_delete on public.graders for delete
  using (public.is_admin());

-- --- grades ---------------------------------------------------------------
-- Graders write here, so these stay open to anyone holding code + password.

drop policy if exists grades_read   on public.grades;
drop policy if exists grades_write  on public.grades;
drop policy if exists grades_update on public.grades;
drop policy if exists grades_delete on public.grades;

create policy grades_read on public.grades for select
  using (public.can_access_session(session_id));

create policy grades_write on public.grades for insert
  with check (public.can_access_session(session_id));

create policy grades_update on public.grades for update
  using (public.can_access_session(session_id))
  with check (public.can_access_session(session_id));

create policy grades_delete on public.grades for delete
  using (public.can_access_session(session_id));

-- ---------------------------------------------------------------------------
-- To change the admin password later:
--   update public.app_config set value = 'new-password' where key = 'admin_password';
-- Everyone who creates sessions must then use the new one.
-- ---------------------------------------------------------------------------
