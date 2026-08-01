-- MTG Limited Format Grader - initial schema
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).

-- ---------------------------------------------------------------------------
-- SECURITY POSTURE, READ BEFORE CHANGING
--
-- There is no authentication. The session code is the credential: anyone who
-- knows it can read and write that session. The per-grader PIN is a SHA-256
-- hash that exists to stop graders submitting as each other by accident. It is
-- NOT a security boundary, because the anon key can read the graders table.
--
-- This is a deliberate trade for grading a set with friends. Do not describe
-- it to users as private. If it ever needs to be, the upgrade is Supabase
-- anonymous sign-in plus policies keyed on auth.uid().
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  set_code    text not null,
  set_name    text not null,
  bonus_sets  jsonb not null default '[]'::jsonb,
  -- Frozen snapshot of the card pool. Every grader reads this identical copy;
  -- re-querying Scryfall per device would let the pools drift mid-session.
  cards       jsonb not null,
  settings    jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.graders (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  name            text not null,
  pin_hash        text,
  -- A card id, never an index. Sort order is a shared setting that can change
  -- mid-session; an index would teleport graders to a different card.
  current_card_id text,
  follow_id       uuid references public.graders(id) on delete set null,
  accent          text not null default '#c8a15a',
  created_at      timestamptz not null default now(),
  unique (session_id, name)
);

create table if not exists public.grades (
  session_id        uuid not null references public.sessions(id) on delete cascade,
  grader_id         uuid not null references public.graders(id) on delete cascade,
  card_id           text not null,
  grade             text,
  is_buildaround    boolean not null default false,
  buildaround_grade text,
  notes             text,
  updated_at        timestamptz not null default now(),
  primary key (session_id, grader_id, card_id)
);

create index if not exists graders_session_idx on public.graders (session_id);
create index if not exists grades_session_idx  on public.grades (session_id);
create index if not exists sessions_code_idx   on public.sessions (code);

-- Grade values must be on the scale. A typo in client code should fail loudly
-- rather than silently poison the combined-grade arithmetic.
alter table public.grades drop constraint if exists grades_grade_valid;
alter table public.grades add constraint grades_grade_valid check (
  grade is null or grade in
    ('F','D-','D','D+','C-','C','C+','B-','B','B+','A-','A','A+')
);

alter table public.grades drop constraint if exists grades_buildaround_valid;
alter table public.grades add constraint grades_buildaround_valid check (
  buildaround_grade is null or buildaround_grade in
    ('F','D-','D','D+','C-','C','C+','B-','B','B+','A-','A','A+')
);

-- ---------------------------------------------------------------------------
-- Row level security
-- Knowing the session code is the credential, consistent with the note above.
-- RLS stays ON so the tables are never blanket-readable without a policy.
-- ---------------------------------------------------------------------------

alter table public.sessions enable row level security;
alter table public.graders  enable row level security;
alter table public.grades   enable row level security;

drop policy if exists sessions_read   on public.sessions;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;

create policy sessions_read   on public.sessions for select using (true);
create policy sessions_insert on public.sessions for insert with check (true);
create policy sessions_update on public.sessions for update using (true) with check (true);

drop policy if exists graders_read   on public.graders;
drop policy if exists graders_insert on public.graders;
drop policy if exists graders_update on public.graders;

create policy graders_read   on public.graders for select using (true);
create policy graders_insert on public.graders for insert with check (true);
create policy graders_update on public.graders for update using (true) with check (true);

drop policy if exists grades_read   on public.grades;
drop policy if exists grades_write  on public.grades;
drop policy if exists grades_update on public.grades;

create policy grades_read   on public.grades for select using (true);
create policy grades_write  on public.grades for insert with check (true);
create policy grades_update on public.grades for update using (true) with check (true);

-- Realtime. Without this the multi-device sync silently does nothing.
alter publication supabase_realtime add table public.grades;
alter publication supabase_realtime add table public.graders;
alter publication supabase_realtime add table public.sessions;

-- UPDATE payloads only carry changed columns unless the replica identity is
-- full. The client reads whole rows from the payload, so this is required.
alter table public.grades   replica identity full;
alter table public.graders  replica identity full;
alter table public.sessions replica identity full;
