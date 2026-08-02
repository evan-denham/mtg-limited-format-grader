/** Verifies migrations 0003 and 0004 against the live project.
 *
 *  Claims under test:
 *    - The anon key alone grants nothing.
 *    - Only an admin may create or delete a session.
 *    - A grader needs BOTH the session code (or id) AND the session password.
 *    - The admin password itself is unreadable through the API.
 *    - Realtime still delivers under gated policies (the likeliest breakage).
 *
 *  Run with:  ADMIN_PASSWORD=your-password npm run verify:rls
 *  Creates a throwaway session and removes it again.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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
if (!URL_ || !KEY) throw new Error('.env.local is missing the Supabase settings')

// The admin password is deliberately not stored anywhere in the app.
const ADMIN = process.env.ADMIN_PASSWORD ?? ''
if (!ADMIN) {
  console.error('Set ADMIN_PASSWORD to the value you put in migration 0004, for example:')
  console.error('  ADMIN_PASSWORD=your-password npm run verify:rls')
  process.exit(1)
}

const CODE = 'ZZRLS-7'
const PW = 'session-pw-test'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

type Headers_ = Record<string, string>

async function rest(
  path: string,
  init: RequestInit & { headers?: Headers_ } = {},
): Promise<{ status: number; body: unknown }> {
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

const sessionBody = (name: string) => ({
  code: CODE,
  name,
  set_code: 'ecl',
  set_name: 'T',
  cards: [],
  settings: {},
  join_password: PW,
})

async function main() {
  console.log('\n=== only an admin may create a session ===')
  const noAdmin = await rest('sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation', 'x-session-code': CODE },
    body: JSON.stringify(sessionBody('should not exist')),
  })
  check('create without the admin password is refused', noAdmin.status >= 400, `HTTP ${noAdmin.status}`)

  const badAdmin = await rest('sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation', 'x-admin-password': 'not-the-password' },
    body: JSON.stringify(sessionBody('should not exist')),
  })
  check('create with a wrong admin password is refused', badAdmin.status >= 400, `HTTP ${badAdmin.status}`)

  console.log('\n=== setup: create a throwaway session as admin ===')
  const created = await rest('sessions', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
      'x-admin-password': ADMIN,
      'x-session-code': CODE,
    },
    body: JSON.stringify(sessionBody('rls test')),
  })
  const session = rows(created.body)[0] as { id: string } | undefined
  if (!session) {
    console.error('  admin create failed:', JSON.stringify(created.body).slice(0, 400))
    console.error('  Check that migration 0004 ran and ADMIN_PASSWORD matches it.')
    process.exit(1)
  }
  const SID = session.id
  console.log(`  session ${SID}`)

  const grader = rows(
    (
      await rest('graders', {
        method: 'POST',
        headers: {
          Prefer: 'return=representation',
          'x-admin-password': ADMIN,
          'x-session-id': SID,
        },
        body: JSON.stringify({ session_id: SID, name: 'Tester', pin: '4321' }),
      })
    ).body,
  )[0] as { id: string } | undefined
  check('admin can add a grader', Boolean(grader))
  const GID = grader?.id ?? ''

  const unlocked: Headers_ = { 'x-session-id': SID, 'x-session-password': PW }

  console.log('\n=== the anon key ALONE grants nothing ===')
  for (const table of ['sessions', 'graders', 'grades']) {
    const r = await rest(`${table}?select=*`)
    check(`bare select on ${table} returns no rows`, rows(r.body).length === 0, `${rows(r.body).length} rows`)
  }

  console.log('\n=== naming a session is not enough without the password ===')
  const codeOnly = await rest('sessions?select=id', { headers: { 'x-session-code': CODE } })
  check('code without password returns no rows', rows(codeOnly.body).length === 0)

  const idOnly = await rest('sessions?select=id', { headers: { 'x-session-id': SID } })
  check('id without password returns no rows', rows(idOnly.body).length === 0)

  const wrongPw = await rest('sessions?select=id', {
    headers: { 'x-session-code': CODE, 'x-session-password': 'wrong' },
  })
  check('wrong password returns no rows', rows(wrongPw.body).length === 0)

  console.log('\n=== code plus password grants access to that session ===')
  const byCode = await rest('sessions?select=id,code', {
    headers: { 'x-session-code': CODE, 'x-session-password': PW },
  })
  check('select by code and password returns the one session', rows(byCode.body).length === 1)

  const byId = await rest('sessions?select=id', { headers: unlocked })
  check('select by id and password returns the one session', rows(byId.body).length === 1)

  const gradersSeen = await rest('graders?select=id,name', { headers: unlocked })
  check('graders visible when unlocked', rows(gradersSeen.body).length === 1)

  const wrote = await rest('grades', {
    method: 'POST',
    headers: unlocked,
    body: JSON.stringify({ session_id: SID, grader_id: GID, card_id: 'w1', grade: 'A' }),
  })
  check('an unlocked grader can write a grade', wrote.status < 400, `HTTP ${wrote.status}`)

  console.log('\n=== deletion is admin-only ===')
  await rest(`sessions?id=eq.${SID}`, { method: 'DELETE' })
  check(
    'delete with no credentials leaves the session',
    rows((await rest('sessions?select=id', { headers: unlocked })).body).length === 1,
  )

  await rest(`sessions?id=eq.${SID}`, { method: 'DELETE', headers: unlocked })
  check(
    'a grader holding code and password still cannot delete',
    rows((await rest('sessions?select=id', { headers: unlocked })).body).length === 1,
  )

  console.log('\n=== the admin password must be unreadable ===')
  const cfg = await rest('app_config?select=*', { headers: { 'x-admin-password': ADMIN } })
  check(
    'app_config is not readable through the API at all',
    rows(cfg.body).length === 0,
    `HTTP ${cfg.status}`,
  )

  console.log('\n=== realtime under gated policies ===')
  const realtimeOk = await testRealtime(SID, GID)
  check(
    'realtime delivers a grade insert to a subscribed client',
    realtimeOk,
    realtimeOk ? '' : 'RLS blocks realtime; sync must fall back to polling',
  )

  console.log('\n=== cleanup ===')
  await rest(`sessions?id=eq.${SID}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': ADMIN, 'x-session-id': SID },
  })
  const left = rows(
    (
      await rest(`sessions?code=eq.${CODE}&select=id`, {
        headers: { 'x-admin-password': ADMIN, 'x-session-code': CODE },
      })
    ).body,
  )
  check('an admin can delete the session', left.length === 0)

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

/** Subscribes with the session headers, writes a grade, waits for the event. */
async function testRealtime(sessionId: string, graderId: string): Promise<boolean> {
  const client = createClient(URL_, KEY, {
    auth: { persistSession: false },
    global: { headers: { 'x-session-id': sessionId, 'x-session-password': PW } },
  })

  return new Promise<boolean>((resolve) => {
    let settled = false
    const done = (v: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void client.removeAllChannels()
      resolve(v)
    }
    const timer = setTimeout(() => done(false), 12_000)

    client
      .channel(`rlstest:${sessionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'grades', filter: `session_id=eq.${sessionId}` },
        () => done(true),
      )
      .subscribe((status) => {
        console.log(`    channel status: ${status}`)
        if (status === 'SUBSCRIBED') {
          void rest('grades', {
            method: 'POST',
            headers: { 'x-session-id': sessionId, 'x-session-password': PW },
            body: JSON.stringify({
              session_id: sessionId,
              grader_id: graderId,
              card_id: 'rt-probe',
              grade: 'B',
            }),
          })
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') done(false)
      })
  })
}

main().catch((err) => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
