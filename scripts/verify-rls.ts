/** Verifies migration 0003: the anon key alone must grant nothing, and a
 *  caller presenting a session id or code must get full access to that session
 *  only. Also checks whether Realtime still delivers under the gated policies,
 *  which is the part most likely to break.
 *
 *  Run with `npm run verify:rls`. Creates a throwaway session and removes it.
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

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

async function rest(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
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

async function main() {
  const CODE = 'ZZRLS-7'

  console.log('\n=== setup: create a throwaway session ===')
  const created = await rest('sessions', {
    method: 'POST',
    headers: { Prefer: 'return=representation', 'x-session-code': CODE },
    body: JSON.stringify({
      code: CODE,
      name: 'rls test',
      set_code: 'ecl',
      set_name: 'T',
      cards: [],
      settings: {},
    }),
  })
  const session = rows(created.body)[0] as { id: string } | undefined
  if (!session) {
    console.error('  could not create test session:', JSON.stringify(created.body).slice(0, 300))
    process.exit(1)
  }
  const SID = session.id
  console.log(`  session ${SID}`)

  const grader = rows(
    (
      await rest('graders', {
        method: 'POST',
        headers: { Prefer: 'return=representation', 'x-session-id': SID },
        body: JSON.stringify({ session_id: SID, name: 'Tester', pin: '4321' }),
      })
    ).body,
  )[0] as { id: string } | undefined
  check('can add a grader when presenting the session id', Boolean(grader))
  const GID = grader?.id ?? ''

  console.log('\n=== the anon key ALONE must grant nothing ===')
  const bareSessions = await rest('sessions?select=id,code')
  check(
    'bare select on sessions returns no rows',
    rows(bareSessions.body).length === 0,
    `${rows(bareSessions.body).length} rows`,
  )

  const bareGraders = await rest('graders?select=id,name,pin')
  check(
    'bare select on graders returns no rows (PINs not harvestable)',
    rows(bareGraders.body).length === 0,
    `${rows(bareGraders.body).length} rows`,
  )

  const bareGrades = await rest('grades?select=card_id')
  check(
    'bare select on grades returns no rows',
    rows(bareGrades.body).length === 0,
    `${rows(bareGrades.body).length} rows`,
  )

  await rest(`sessions?id=eq.${SID}`, { method: 'DELETE' })
  const survived = rows((await rest(`sessions?code=eq.${CODE}&select=id`, {
    headers: { 'x-session-code': CODE },
  })).body)
  check('delete without a header does not remove the session', survived.length === 1)

  console.log('\n=== presenting the session code grants access ===')
  const byCode = await rest(`sessions?select=id,code`, { headers: { 'x-session-code': CODE } })
  check('select by code returns exactly the one session', rows(byCode.body).length === 1)

  console.log('\n=== presenting the session id grants access ===')
  const byId = await rest(`sessions?select=id`, { headers: { 'x-session-id': SID } })
  check('select by id returns exactly the one session', rows(byId.body).length === 1)

  const gradersById = await rest(`graders?select=id,name`, { headers: { 'x-session-id': SID } })
  check('graders visible when presenting the id', rows(gradersById.body).length === 1)

  console.log('\n=== a wrong code must not grant access ===')
  const wrong = await rest(`sessions?select=id`, { headers: { 'x-session-code': 'AAA-999' } })
  check('a wrong code returns no rows', rows(wrong.body).length === 0)

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
    headers: { 'x-session-id': SID },
  })
  const left = rows(
    (await rest(`sessions?code=eq.${CODE}&select=id`, { headers: { 'x-session-code': CODE } }))
      .body,
  )
  check('delete WITH the header removes the session', left.length === 0)

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

/** Subscribes with the session headers, writes a grade, waits for the event. */
async function testRealtime(sessionId: string, graderId: string): Promise<boolean> {
  const client = createClient(URL_, KEY, {
    auth: { persistSession: false },
    global: { headers: { 'x-session-id': sessionId } },
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

    const channel = client
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
            headers: { 'x-session-id': sessionId },
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

    void channel
  })
}

main().catch((err) => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
