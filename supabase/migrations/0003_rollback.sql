-- Rollback for 0003. Restores the permissive policies from 0001/0002.
--
-- Run this ONLY if 0003 locked the app out of its own data. It puts the
-- database back to "anyone with the anon key can read, write and delete
-- everything", so do not leave the site publicly deployed in this state.

drop policy if exists sessions_read   on public.sessions;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;
drop policy if exists sessions_delete on public.sessions;

create policy sessions_read   on public.sessions for select using (true);
create policy sessions_insert on public.sessions for insert with check (true);
create policy sessions_update on public.sessions for update using (true) with check (true);
create policy sessions_delete on public.sessions for delete using (true);

drop policy if exists graders_read   on public.graders;
drop policy if exists graders_insert on public.graders;
drop policy if exists graders_update on public.graders;
drop policy if exists graders_delete on public.graders;

create policy graders_read   on public.graders for select using (true);
create policy graders_insert on public.graders for insert with check (true);
create policy graders_update on public.graders for update using (true) with check (true);
create policy graders_delete on public.graders for delete using (true);

drop policy if exists grades_read   on public.grades;
drop policy if exists grades_write  on public.grades;
drop policy if exists grades_update on public.grades;
drop policy if exists grades_delete on public.grades;

create policy grades_read   on public.grades for select using (true);
create policy grades_write  on public.grades for insert with check (true);
create policy grades_update on public.grades for update using (true) with check (true);
create policy grades_delete on public.grades for delete using (true);
