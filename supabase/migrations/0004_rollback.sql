-- Rollback for 0004. Restores 0003 behaviour: access gated on session id or
-- code only, with no admin role and no session password.
--
-- Run this only if 0004 locked you out. It leaves app_config in place but
-- unused, and leaves sessions.join_password in place but unenforced.

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
        s.id::text = public.req_header('x-session-id')
        or s.code = public.req_header('x-session-code')
      )
  )
$$;

drop policy if exists sessions_read   on public.sessions;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;
drop policy if exists sessions_delete on public.sessions;

create policy sessions_read on public.sessions for select
  using (
    id::text = public.req_header('x-session-id')
    or code = public.req_header('x-session-code')
  );
create policy sessions_insert on public.sessions for insert with check (true);
create policy sessions_update on public.sessions for update
  using (
    id::text = public.req_header('x-session-id')
    or code = public.req_header('x-session-code')
  )
  with check (true);
create policy sessions_delete on public.sessions for delete
  using (
    id::text = public.req_header('x-session-id')
    or code = public.req_header('x-session-code')
  );

drop policy if exists graders_read   on public.graders;
drop policy if exists graders_insert on public.graders;
drop policy if exists graders_update on public.graders;
drop policy if exists graders_delete on public.graders;

create policy graders_read   on public.graders for select using (public.can_access_session(session_id));
create policy graders_insert on public.graders for insert with check (public.can_access_session(session_id));
create policy graders_update on public.graders for update
  using (public.can_access_session(session_id)) with check (public.can_access_session(session_id));
create policy graders_delete on public.graders for delete using (public.can_access_session(session_id));

drop policy if exists grades_read   on public.grades;
drop policy if exists grades_write  on public.grades;
drop policy if exists grades_update on public.grades;
drop policy if exists grades_delete on public.grades;

create policy grades_read   on public.grades for select using (public.can_access_session(session_id));
create policy grades_write  on public.grades for insert with check (public.can_access_session(session_id));
create policy grades_update on public.grades for update
  using (public.can_access_session(session_id)) with check (public.can_access_session(session_id));
create policy grades_delete on public.grades for delete using (public.can_access_session(session_id));
