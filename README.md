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
| `npm run lint` | oxlint |

## Enabling multi-device sync

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor -> New query** and run each migration in
   [`supabase/migrations/`](supabase/migrations/) in order:
   `0001_init.sql`, then `0002_pins_and_delete.sql`.
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

## Security posture

There is no authentication. **The session code is the credential:** anyone with
it can read and write that session.

The host assigns each grader a four-digit PIN when creating the session and can
look them up again under Settings. PINs are stored **in the clear**, because a
host who cannot read a PIN back cannot remind anyone what theirs is. That gives
up nothing: the anon key could always read the graders table, so hashing was
never protecting anything here. The PIN's only job is stopping graders from
entering grades as each other by accident. Do not reuse a PIN that means
anything elsewhere.

PINs are stripped from the JSON export, since that file gets mailed around.

That is a deliberate trade for grading a set with friends. If it ever needs to
be genuinely private, the upgrade is Supabase anonymous sign-in with policies
keyed on `auth.uid()`.

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
