-- 0003: gate every row behind knowledge of a session id or session code.
--
-- Run this in the Supabase SQL Editor after 0002.
-- If anything goes wrong, run 0003_rollback.sql to restore 0002 behaviour.

-- ---------------------------------------------------------------------------
-- WHY
--
-- A deployed static site must ship the anon key in its JavaScript bundle;
-- that is what the key is for and it cannot be hidden. Under 0002 every
-- policy was `using (true)`, so anyone holding that key could list every
-- session and delete all of them.
--
-- The key is not the problem. These policies make the key useless on its own:
-- a caller must also present a session id or session code as a request header,
-- checked here in Postgres where the browser cannot bypass it.
--
-- The session id is a 122-bit random UUID. The session code is ~30 bits, so
-- it is guessable in bulk; it exists for humans to type. Treat the id as the
-- real secret and the code as a convenience.
-- ---------------------------------------------------------------------------

-- Reads one request header. PostgREST publishes them as a JSON GUC.
-- Returns null rather than throwing when the GUC is absent, which is the case
-- outside a PostgREST request (the SQL editor, and possibly Realtime).
create or replace function public.req_header(name text)
returns text
language sql
stable
as $$
  select nullif(current_setting('request.headers', true)::json ->> name, '')
$$;

-- SECURITY DEFINER so the lookup inside is not itself filtered by the policy
-- on `sessions`, which would recurse.
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

grant execute on function public.req_header(text) to anon, authenticated;
grant execute on function public.can_access_session(uuid) to anon, authenticated;

-- --- sessions -------------------------------------------------------------

drop policy if exists sessions_read   on public.sessions;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;
drop policy if exists sessions_delete on public.sessions;

-- Reading requires naming the session. A bare select returns zero rows.
create policy sessions_read on public.sessions for select
  using (
    id::text = public.req_header('x-session-id')
    or code = public.req_header('x-session-code')
  );

-- Creating stays open: a new session has no secret to present yet. The client
-- sets x-session-code to the code it just generated so the INSERT can return
-- the new row, which requires the select policy above to pass.
create policy sessions_insert on public.sessions for insert
  with check (true);

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

-- --- graders --------------------------------------------------------------

drop policy if exists graders_read   on public.graders;
drop policy if exists graders_insert on public.graders;
drop policy if exists graders_update on public.graders;
drop policy if exists graders_delete on public.graders;

create policy graders_read on public.graders for select
  using (public.can_access_session(session_id));

create policy graders_insert on public.graders for insert
  with check (public.can_access_session(session_id));

create policy graders_update on public.graders for update
  using (public.can_access_session(session_id))
  with check (public.can_access_session(session_id));

create policy graders_delete on public.graders for delete
  using (public.can_access_session(session_id));

-- --- grades ---------------------------------------------------------------

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
