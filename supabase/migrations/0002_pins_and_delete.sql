-- 0002: host-assigned PINs, a host grader, and the missing DELETE policies.
-- Run this in the Supabase SQL Editor after 0001.

-- ---------------------------------------------------------------------------
-- WHY PINS ARE NOW PLAINTEXT
--
-- 0001 stored a salted SHA-256 hash. The host now needs to read PINs back to
-- tell a grader what theirs is, and a hash cannot be read back. So the PIN is
-- stored as-is.
--
-- This does not lower the security of the app, because the PIN was never
-- providing any. The session code has always been the real credential, and the
-- anon key could always read the graders table. The PIN's only job is stopping
-- graders from submitting as each other by accident, and it still does that.
-- Do not reuse a PIN here that means anything anywhere else.
-- ---------------------------------------------------------------------------

alter table public.graders add column if not exists pin text;
alter table public.graders drop column if exists pin_hash;

alter table public.graders drop constraint if exists graders_pin_format;
alter table public.graders add constraint graders_pin_format check (
  pin is null or pin ~ '^[0-9]{4}$'
);

-- The grader who created the session. Used to decide who sees the PIN list.
-- This is a UI convenience, not an access control: anyone with the session
-- code can read this table directly.
alter table public.sessions add column if not exists host_grader_id uuid;

-- ---------------------------------------------------------------------------
-- DELETE policies.
--
-- 0001 enabled RLS but only created SELECT, INSERT and UPDATE policies. With
-- RLS on and no DELETE policy, a DELETE matches zero rows and still returns
-- 204, so deletes silently did nothing and sessions could never be removed
-- from the server. Verified against the live project before writing this.
-- ---------------------------------------------------------------------------

drop policy if exists sessions_delete on public.sessions;
drop policy if exists graders_delete  on public.graders;
drop policy if exists grades_delete   on public.grades;

create policy sessions_delete on public.sessions for delete using (true);
create policy graders_delete  on public.graders  for delete using (true);
create policy grades_delete   on public.grades   for delete using (true);

-- Remove the row left behind by the connectivity test that discovered the gap.
delete from public.sessions where code = 'ZZTEST-1';
