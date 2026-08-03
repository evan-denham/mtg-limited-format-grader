-- Rollback for 0006. Removes read-only sharing and restores 0004/0005
-- behaviour, where every reader is also a writer.
--
-- Leaves sessions.view_token in place but unused; any share links already
-- handed out stop working immediately, which is the point of a rollback here.

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

drop policy if exists sessions_read   on public.sessions;
drop policy if exists sessions_update on public.sessions;

create policy sessions_read on public.sessions for select
  using (public.is_admin() or public.session_unlocked(id, code, join_password));

create policy sessions_update on public.sessions for update
  using (public.is_admin() or public.session_unlocked(id, code, join_password))
  with check (public.is_admin() or public.session_unlocked(id, code, join_password));

drop policy if exists graders_read   on public.graders;
drop policy if exists graders_update on public.graders;

create policy graders_read on public.graders for select
  using (public.can_access_session(session_id));
create policy graders_update on public.graders for update
  using (public.can_access_session(session_id))
  with check (public.can_access_session(session_id));

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
