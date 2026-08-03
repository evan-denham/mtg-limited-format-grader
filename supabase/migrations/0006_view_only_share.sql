-- 0006: a read-only share link for people who should see results but not grade.
--
-- Run in the Supabase SQL Editor after 0005.
-- Rollback: 0006_rollback.sql.

-- ---------------------------------------------------------------------------
-- WHY THIS IS A SEPARATE TOKEN AND NOT A UI FLAG
--
-- Hiding the grading controls from a viewer would not stop them writing: the
-- anon key is in the bundle and the REST API is a fetch away. Read-only has to
-- be enforced where writes actually happen, so this splits the policies in two:
--
--   can_access_session  -> read.  admin, grader, OR viewer
--   can_write_session   -> write. admin or grader ONLY
--
-- A viewer presenting only x-view-token can select and can never insert,
-- update or delete, whatever the client does.
--
-- The token is a UUID, so it is unguessable in a way the 6-character session
-- code is not. It is the sole credential in a share link, so treat the link as
-- the secret: anyone holding it can read that session's grades and notes.
-- ---------------------------------------------------------------------------

alter table public.sessions
  add column if not exists view_token text not null default gen_random_uuid()::text;

-- Existing rows get one too; the default only covers new inserts.
update public.sessions
set view_token = gen_random_uuid()::text
where view_token is null or char_length(view_token) < 16;

create unique index if not exists sessions_view_token_idx on public.sessions (view_token);

create or replace function public.view_unlocked(s_id uuid, s_token text)
returns boolean
language sql
stable
as $$
  select s_token = public.req_header('x-view-token')
     and public.req_header('x-view-token') is not null
$$;

grant execute on function public.view_unlocked(uuid, text) to anon, authenticated;

-- Read access: admin, grader with code+password, or holder of the view token.
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
        or public.view_unlocked(s.id, s.view_token)
      )
  )
$$;

-- Write access: deliberately excludes the view token.
create or replace function public.can_write_session(sid uuid)
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

grant execute on function public.can_write_session(uuid) to anon, authenticated;

-- --- sessions -------------------------------------------------------------

drop policy if exists sessions_read   on public.sessions;
drop policy if exists sessions_update on public.sessions;

create policy sessions_read on public.sessions for select
  using (
    public.is_admin()
    or public.session_unlocked(id, code, join_password)
    or public.view_unlocked(id, view_token)
  );

-- Settings changes are writes, so a viewer cannot make them.
create policy sessions_update on public.sessions for update
  using (public.is_admin() or public.session_unlocked(id, code, join_password))
  with check (public.is_admin() or public.session_unlocked(id, code, join_password));

-- --- graders --------------------------------------------------------------

drop policy if exists graders_read   on public.graders;
drop policy if exists graders_update on public.graders;

create policy graders_read on public.graders for select
  using (public.can_access_session(session_id));

-- Position and follow are writes.
create policy graders_update on public.graders for update
  using (public.can_write_session(session_id))
  with check (public.can_write_session(session_id));

-- --- grades ---------------------------------------------------------------

drop policy if exists grades_read   on public.grades;
drop policy if exists grades_write  on public.grades;
drop policy if exists grades_update on public.grades;
drop policy if exists grades_delete on public.grades;

create policy grades_read on public.grades for select
  using (public.can_access_session(session_id));

create policy grades_write on public.grades for insert
  with check (public.can_write_session(session_id));

create policy grades_update on public.grades for update
  using (public.can_write_session(session_id))
  with check (public.can_write_session(session_id));

create policy grades_delete on public.grades for delete
  using (public.can_write_session(session_id));
