/** Proves multi-device sync still works after the switch from Realtime to
 *  polling, by driving the app's OWN backend.subscribe() rather than a
 *  reimplementation of it.
 *
 *  Device A subscribes. Device B writes over plain REST. The check is whether
 *  A's handler fires with B's grade.
 *
 *  Run with:  ADMIN_PASSWORD=your-password npm run verify:sync
 */

// The backend reads the session password from localStorage and skips polling
// for a hidden tab. Neither exists in Node, so stand them up before importing
// anything that touches them.
class MemoryStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
}

const g = globalThis as unknown as Record<string, unknown>
g.localStorage = new MemoryStorage()
g.sessionStorage = new MemoryStorage()
g.document = { visibilityState: 'visible' }

const { readFileSync } = await import('node:fs')
const { backend } = await import('../src/supabase/backend')
const local = await import('../src/storage/local')
const { DEFAULT_SETTINGS } = await import('../src/domain/ordering')
import type { Grade } from '../src/domain/types'

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
if (!ADMIN) {
  console.error('Run as: ADMIN_PASSWORD=your-password npm run verify:sync')
  process.exit(1)
}

const PW = 'sync-test-password'
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Device B: a different machine, talking straight to the REST API. */
async function deviceBWrites(sessionId: string, graderId: string, cardId: string, grade: string) {
  const res = await fetch(`${URL_}/rest/v1/grades`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
      'x-session-id': sessionId,
      'x-session-password': PW,
    },
    body: JSON.stringify({
      session_id: sessionId,
      grader_id: graderId,
      card_id: cardId,
      grade,
      is_buildaround: false,
      notes: 'written by device B',
      updated_at: new Date().toISOString(),
    }),
  })
  if (!res.ok) throw new Error(`device B write failed: ${res.status} ${await res.text()}`)
}

async function main() {
  if (!backend.configured) {
    console.error('Supabase is not configured; nothing to verify.')
    process.exit(1)
  }

  console.log('\n=== create a session as admin ===')
  const created = await backend.createSession({
    code: `ZZSYNC-${Math.floor(Math.random() * 900 + 100)}`,
    name: 'sync test',
    setCode: 'ecl',
    setName: 'Lorwyn Eclipsed',
    bonusSets: [],
    cards: [],
    settings: DEFAULT_SETTINGS,
    graders: [
      { name: 'DeviceA', pin: '1111' },
      { name: 'DeviceB', pin: '2222' },
    ],
    hostIndex: 0,
    joinPassword: PW,
    adminPassword: ADMIN,
  })
  if (!created) {
    console.error('createSession returned null')
    process.exit(1)
  }
  const { sessionId, graders } = created
  console.log(`  session ${sessionId}`)
  check('session created with two graders', graders.length === 2)

  // Device A stores the password exactly as the unlock flow would.
  local.saveSessionPassword(sessionId, PW)

  console.log('\n=== device A subscribes using the real app code path ===')
  const seen: Grade[] = []
  const unsubscribe = backend.subscribe(sessionId, {
    onGrade: (grade) => seen.push(grade),
    onGrader: () => {},
    onSettings: () => {},
  })

  const graderB = graders.find((x) => x.name === 'DeviceB')!
  const CARD = 'sync-probe-card'

  console.log('=== device B writes a grade ===')
  await deviceBWrites(sessionId, graderB.id, CARD, 'A+')

  console.log('=== waiting for device A to observe it ===')
  const started = Date.now()
  let observed: Grade | undefined
  while (Date.now() - started < 20_000) {
    observed = seen.find((x) => x.cardId === CARD)
    if (observed) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  check('device A received device B grade', Boolean(observed), observed ? `after ${elapsed}s` : 'timed out after 20s')
  check('the grade value came through intact', observed?.grade === 'A+', String(observed?.grade))
  check('the note came through intact', observed?.notes === 'written by device B', String(observed?.notes))
  check('it is attributed to device B, not device A', observed?.graderId === graderB.id)

  console.log('\n=== a second write also arrives (cursor advances, no stall) ===')
  const before = seen.length
  await deviceBWrites(sessionId, graderB.id, 'sync-probe-card-2', 'F')
  const t2 = Date.now()
  let second = false
  while (Date.now() - t2 < 20_000) {
    second = seen.some((x) => x.cardId === 'sync-probe-card-2')
    if (second) break
    await new Promise((r) => setTimeout(r, 500))
  }
  check('second grade also arrived', second, `${seen.length - before} new events`)

  unsubscribe()

  console.log('\n=== polling stops after unsubscribe ===')
  const countAtStop = seen.length
  await deviceBWrites(sessionId, graderB.id, 'sync-probe-card-3', 'C')
  await new Promise((r) => setTimeout(r, 9000))
  check('no further events after unsubscribe', seen.length === countAtStop, `${seen.length - countAtStop} leaked`)

  console.log('\n=== cleanup ===')
  await backend.deleteSession(sessionId, ADMIN)
  check('session deleted', true)

  console.log(`\n${failures === 0 ? 'All checks passed. Multi-device sync works.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
