-- 0005: forbid leading/trailing whitespace in credentials, and repair any
-- existing rows that have it.
--
-- Run in the Supabase SQL Editor after 0004.

-- ---------------------------------------------------------------------------
-- WHY THIS IS A CORRECTNESS BUG, NOT TIDINESS
--
-- These credentials travel as HTTP request headers. RFC 7230 defines optional
-- whitespace around a header field value and requires it to be stripped, so
-- `x-session-password: secret ` arrives as `secret`. Verified against a real
-- echo server: a 17-character value with a trailing space arrived as 16
-- characters.
--
-- A session password stored with surrounding whitespace can therefore never be
-- matched by any client, because the space cannot survive the request. The
-- session becomes permanently unjoinable by everyone, including its host, with
-- no error message that explains why. That is exactly what happened to session
-- TKH-ACR, whose password was saved as 'MirkwoodNurturer '.
--
-- The client now trims these before sending or storing. These constraints stop
-- the bad state being reachable by any other path.
-- ---------------------------------------------------------------------------

-- Repair existing sessions.
update public.sessions
set join_password = btrim(join_password)
where join_password <> btrim(join_password);

alter table public.sessions drop constraint if exists sessions_join_password_trimmed;
alter table public.sessions add constraint sessions_join_password_trimmed
  check (join_password = btrim(join_password));

-- Same hazard for the admin password: stored with a trailing space it could
-- never be entered successfully.
update public.app_config
set value = btrim(value)
where value <> btrim(value);

alter table public.app_config drop constraint if exists app_config_value_trimmed;
alter table public.app_config add constraint app_config_value_trimmed
  check (value = btrim(value));

-- Grader names too: a trailing space makes two graders look identical in the
-- UI while remaining distinct rows, and defeats the unique(session_id, name)
-- constraint that is supposed to prevent exactly that.
update public.graders
set name = btrim(name)
where name <> btrim(name);

alter table public.graders drop constraint if exists graders_name_trimmed;
alter table public.graders add constraint graders_name_trimmed
  check (name = btrim(name) and char_length(name) > 0);
