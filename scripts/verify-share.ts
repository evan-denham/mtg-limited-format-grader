/** Verifies migration 0006: a share token grants read and ONLY read.
 *
 *  The point is that read-only is enforced in Postgres, not by hiding buttons.
 *  So every write path is attempted with the view token and must fail.
 *
 *  Run with:  ADMIN_PASSWORD=your-password npm run verify:share
 */

import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
const ADMIN = process.env.ADMIN_PASSWORD ?? ''
if (!URL_ || !KEY) throw new Error('.env.local is missing the Supabase settings')
if (!ADMIN) {
  console.error('Run as: ADMIN_PASSWORD=your-password npm run verify:share')
  process.exit(1)
}

const CODE = 'ZZSHR-4'
const PW = 'share-test-password'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

type H = Record<string, string>

async function rest(path: string, init: RequestInit & { headers?: H } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* leave as text */
  }
  return { status: res.status, body }
}

const rows = (b: unknown): unknown[] => (Array.isArray(b) ? b : [])

async function main() {
  const admin: H = { 'x-admin-password': ADMIN }

  console.log('\n=== setup ===')
  const created = await rest('sessions', {
    method: 'POST',
    headers: { ...admin, Prefer: 'return=representation', 'x-session-code': CODE },
    body: JSON.stringify({
      code: CODE,
      name: 'share test',
      set_code: 'ecl',
      set_name: 'T',
      cards: [],
      settings: {},
      join_password: PW,
    }),
  })
  const session = rows(created.body)[0] as { id: string; view_token: string } | undefined
  if (!session) {
    console.error('  create failed:', JSON.stringify(created.body).slice(0, 300))
    console.error('  Check that migration 0006 has been run.')
    process.exit(1)
  }
  const SID = session.id
  const TOKEN = session.view_token
  check('session row carries a view token', Boolean(TOKEN) && TOKEN.length >= 16, TOKEN?.slice(0, 8) + '...')

  const grader = rows(
    (
      await rest('graders', {
        method: 'POST',
        headers: { ...admin, Prefer: 'return=representation', 'x-session-id': SID },
        body: JSON.stringify({ session_id: SID, name: 'Tester', pin: '1122' }),
      })
    ).body,
  )[0] as { id: string } | undefined
  const GID = grader?.id ?? ''

  const grader_: H = { 'x-session-id': SID, 'x-session-password': PW }
  await rest('grades', {
    method: 'POST',
    headers: grader_,
    body: JSON.stringify({ session_id: SID, grader_id: GID, card_id: 'c1', grade: 'B' }),
  })

  const viewer: H = { 'x-view-token': TOKEN }

  console.log('\n=== a viewer can READ ===')
  check(
    'viewer sees the session',
    rows((await rest('sessions?select=id,name', { headers: viewer })).body).length === 1,
  )
  check(
    'viewer sees the graders',
    rows((await rest('graders?select=id,name', { headers: viewer })).body).length === 1,
  )
  const seenGrades = rows((await rest('grades?select=card_id,grade', { headers: viewer })).body)
  check('viewer sees the grades', seenGrades.length === 1, JSON.stringify(seenGrades))

  console.log('\n=== a viewer can NOT write ===')
  const insert = await rest('grades', {
    method: 'POST',
    headers: viewer,
    body: JSON.stringify({ session_id: SID, grader_id: GID, card_id: 'c2', grade: 'A' }),
  })
  check('viewer cannot insert a grade', insert.status >= 400, `HTTP ${insert.status}`)

  await rest(`grades?session_id=eq.${SID}&card_id=eq.c1`, {
    method: 'PATCH',
    headers: viewer,
    body: JSON.stringify({ grade: 'F' }),
  })
  const afterPatch = rows(
    (await rest(`grades?card_id=eq.c1&select=grade`, { headers: grader_ })).body,
  ) as { grade: string }[]
  check(
    'viewer cannot change an existing grade',
    afterPatch[0]?.grade === 'B',
    `grade is now ${afterPatch[0]?.grade}`,
  )

  await rest(`grades?session_id=eq.${SID}`, { method: 'DELETE', headers: viewer })
  check(
    'viewer cannot delete grades',
    rows((await rest('grades?select=card_id', { headers: grader_ })).body).length === 1,
  )

  await rest(`sessions?id=eq.${SID}`, {
    method: 'PATCH',
    headers: viewer,
    body: JSON.stringify({ name: 'renamed by viewer' }),
  })
  const afterRename = rows(
    (await rest('sessions?select=name', { headers: grader_ })).body,
  ) as { name: string }[]
  check(
    'viewer cannot rename the session',
    afterRename[0]?.name === 'share test',
    `name is now ${afterRename[0]?.name}`,
  )

  await rest(`graders?id=eq.${GID}`, {
    method: 'PATCH',
    headers: viewer,
    body: JSON.stringify({ current_card_id: 'moved-by-viewer' }),
  })
  const afterMove = rows(
    (await rest('graders?select=current_card_id', { headers: grader_ })).body,
  ) as { current_card_id: string | null }[]
  check('viewer cannot move a grader', afterMove[0]?.current_card_id !== 'moved-by-viewer')

  await rest(`sessions?id=eq.${SID}`, { method: 'DELETE', headers: viewer })
  check(
    'viewer cannot delete the session',
    rows((await rest('sessions?select=id', { headers: grader_ })).body).length === 1,
  )

  console.log('\n=== a wrong token grants nothing ===')
  const wrong = await rest('sessions?select=id', {
    headers: { 'x-view-token': '00000000-0000-0000-0000-000000000000' },
  })
  check('a wrong view token returns no rows', rows(wrong.body).length === 0)

  console.log('\n=== graders keep full access ===')
  const stillWrites = await rest('grades', {
    method: 'POST',
    headers: grader_,
    body: JSON.stringify({ session_id: SID, grader_id: GID, card_id: 'c3', grade: 'C' }),
  })
  check('a grader can still write', stillWrites.status < 400, `HTTP ${stillWrites.status}`)

  console.log('\n=== cleanup ===')
  await rest(`sessions?id=eq.${SID}`, { method: 'DELETE', headers: { ...admin, 'x-session-id': SID } })
  check(
    'session removed',
    rows((await rest(`sessions?code=eq.${CODE}&select=id`, { headers: { ...admin, 'x-session-code': CODE } })).body).length === 0,
  )

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
