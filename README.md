# Limited Format Grader

Grade every card in a Magic set for Limited, card by card, with one or more
graders. Card images are the focus; grades, build-around flags and per-grader
notes collect into a shared results table that exports to CSV, a print-ready
card sheet, or JSON.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

It works with no configuration at all. Without Supabase credentials the app is
local-only: fully usable, but a session lives in one browser and cannot be
joined from another device.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and production build |
| `npm test` | Unit tests, no network |
| `npm run verify` | Live checks against the real Scryfall API |
| `npm run verify:rls` | Live checks that the access rules hold (needs `ADMIN_PASSWORD`) |
| `npm run verify:sync` | Live two-device sync check (needs `ADMIN_PASSWORD`) |
| `npm run verify:share` | Live check that a share link reads but cannot write (needs `ADMIN_PASSWORD`) |
| `npm run verify:add-grader` | Live check that graders can join mid-session (needs `ADMIN_PASSWORD`) |
| `npm run lint` | oxlint |

## Enabling multi-device sync

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor -> New query** and run each migration in
   [`supabase/migrations/`](supabase/migrations/) in order: `0001`, `0002`,
   `0003`, then `0004`.

   When you run `0004`, change the admin password placeholder **in the SQL
   editor**, not in the file. The file is tracked and this repository is
   public; `npm test` fails if a real password is saved into it.
3. Copy `.env.example` to `.env.local` and fill in the values from
   **Project Settings -> API**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` — the **anon / public** key
4. Restart `npm run dev`. Vite only reads env files at startup.

Use the anon key, never the `service_role` key. This is a static site, so
anything in the bundle is public. The anon key is designed for that; the
service_role key bypasses row level security entirely.

Free-tier projects pause after 7 days of inactivity. If a session sits idle
longer than that, resume it from the Supabase dashboard.

## Roles and access

Three secrets with distinct jobs:

| Secret | Held by | Grants |
| --- | --- | --- |
| Admin password | whoever runs sessions | create sessions, add graders, delete sessions |
| Session password | everyone grading that session | read and grade that one session |
| Grader PIN | one person | which grader you are |
| Share link | anyone you send it to | read the results, and nothing else |

A share link is a read-only URL the host can copy from Settings. It carries a
UUID view token, and the policies split read from write: `can_access_session`
accepts admin, grader or viewer, while `can_write_session` accepts admin or
grader only. Hiding the grading controls would not have been enough, since the
anon key is in the bundle and the REST API is a fetch away, so a viewer is
refused at the database. `npm run verify:share` attempts every write path with
a view token and asserts each one fails.

The link is the only credential it carries, so treat it as one: anyone holding
it can read that session's grades and notes.

Graders can be added after a session has started, from Settings, by the host.
It needs the admin password, matching the policy on inserts into `graders`.
A grader who joins late starts with nothing graded; combined grades ignore
cards they never reached rather than counting those as `F`.

All three are enforced by row level security in Postgres, not in the browser.

**The admin password is the only genuinely secret value.** It lives in
`app_config`, a table with RLS enabled and no policies at all, so the anon role
can never read it; only the `SECURITY DEFINER` `is_admin()` function can. It is
typed by the admin, sent as a request header and compared inside the database,
so it never enters the JavaScript bundle and reading the bundle does not reveal
it. Change it with:

```sql
update public.app_config set value = 'new-password' where key = 'admin_password';
```

**The anon key is public and that is fine.** A deployed static site must ship
it, and it is designed for that. Since migration 0003 it grants nothing on its
own: every policy also requires a session id or code *and* the session
password. `npm run verify:rls` asserts this against the live project, including
that a bare `select` on each table returns zero rows.

**Grader PINs are stored in the clear**, so the admin can read one back to
remind someone. That gives up nothing, because anyone already inside a session
could read that table. The PIN prevents accidental cross-grading, not access.
PINs are stripped from the JSON export.

**Anyone with a session code and its password can grade it, and can pass both
on.** There is no per-person identity. If that matters, the upgrade is Supabase
anonymous sign-in with policies keyed on `auth.uid()`.

## Multi-device sync uses polling, not Realtime

Supabase Realtime evaluates RLS from the connection JWT and never sees the
PostgREST request headers these policies depend on, so a channel reports
`SUBSCRIBED` and then immediately `CLOSED` with no changes delivered. Confirmed
against the live project. Sync therefore polls every 4 seconds using an
`updated_at` cursor on `grades`, skips work while the tab is hidden, and only
emits rows that actually changed so the screen does not re-render on a timer.

Multi-device grading is unaffected; only the latency changes. `npm run
verify:sync` proves it end to end by driving the app's own `subscribe()`: one
client subscribes, a second writes over REST, and the first observes the grade
in about four seconds with its value, note and grader attribution intact.

## How the card pool is built

Cards come from Scryfall at session creation and are then **frozen** into the
session row. Every grader reads that identical snapshot, so a mid-session
Scryfall update cannot desync the pools.

Two things about Scryfall's data drive the implementation:

**`is:booster` is unpopulated on brand-new sets.** `set:sos is:booster` returns
no matches while `set:ecl is:booster` returns 268. Since grading a set at
release is the main use case, the pool builder falls back to the plain set
query and reports which query it used and why.

**Double-faced cards omit the `colors` key entirely** (it is absent, not null)
and carry no top-level `image_uris`; both live per face. Reading `card.colors`
directly buckets every DFC as colourless, so colours are unioned from
`card_faces`. `npm run verify` asserts this against live data.

Bonus sheets are found via `parent_set_code` on masterpiece sets (`sos` -> `soa`,
`stx` -> `sta`). Special Guests (`spg`) has no parent link, so it is added
manually by set code with an optional collector-number range.

Scryfall also rejects the default Node/undici User-Agent. The app never sets
one, because browsers forbid it as a request header and send a real browser UA;
only `scripts/verify-pool.ts` patches it.

## Ordering

Order is a shared setting. Cards sort by section, then by colour and rarity in
whichever order the mode selects, then by collector number or name.

Colour order is typed as a string such as `W U B R G MC C L`. `MC` is read as
one token, and any bucket left out is appended, so no card can fall out of the
queue. All non-basic lands bucket to `L` regardless of colour identity.

A grader's position is stored as a **card id, not an index**, so reordering
mid-session keeps everyone on the card they were looking at.

## Grading

Previous is always available. Next is withheld until you have assigned a grade
to the current card, so the set cannot be skimmed past by accident; once
graded, it stays available on revisit.

Keyboard: `F` `D` `C` `B` `A` set the base grade, `-` and `+` adjust it, arrow
keys navigate. Disabled while typing in the notes box.

Combined grades map `F`=0 through `A+`=12, average across graders who graded
the card, and round half-up. Ungraded is ignored, not counted as `F`.
Build-around grades combine only over graders who flagged the card.
