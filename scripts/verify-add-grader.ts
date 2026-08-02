/** Verifies that a grader added to a session already in progress works:
 *  admin-only to add, visible to devices already connected, able to grade, and
 *  their absence from earlier cards does not distort combined grades.
 *
 *  Run with:  ADMIN_PASSWORD=your-password npm run verify:add-grader
 */

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
const { combine } = await import('../src/domain/grades')
import type { Grader } from '../src/domain/types'

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
  console.error('Run as: ADMIN_PASSWORD=your-password npm run verify:add-grader')
  process.exit(1)
}

const PW = 'add-grader-test-pw'
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`)
}

async function writeGrade(sessionId: string, graderId: string, cardId: string, grade: string) {
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
      updated_at: new Date().toISOString(),
    }),
  })
  return res.ok
}

async function main() {
  console.log('\n=== create a session with one grader ===')
  const created = await backend.createSession({
    code: `ZZADD-${Math.floor(Math.random() * 900 + 100)}`,
    name: 'add grader test',
    setCode: 'ecl',
    setName: 'Lorwyn Eclipsed',
    bonusSets: [],
    cards: [],
    settings: DEFAULT_SETTINGS,
    graders: [{ name: 'Original', pin: '1111' }],
    hostIndex: 0,
    joinPassword: PW,
    adminPassword: ADMIN,
  })
  if (!created) {
    console.error('createSession returned null')
    process.exit(1)
  }
  const { sessionId, graders } = created
  local.saveSessionPassword(sessionId, PW)
  check('session created with one grader', graders.length === 1)

  // The original grader grades a card before anyone else joins.
  await writeGrade(sessionId, graders[0].id, 'card-1', 'B')

  console.log('\n=== a device already connected is watching ===')
  const seenGraders: Grader[] = []
  const unsubscribe = backend.subscribe(sessionId, {
    onGrade: () => {},
    onGrader: (grader) => seenGraders.push(grader),
    onSettings: () => {},
  })

  console.log('\n=== adding a grader requires the admin password ===')
  let refused = false
  try {
    await backend.addGrader({
      sessionId,
      name: 'Sneaky',
      pin: '9999',
      accentIndex: 1,
      adminPassword: 'wrong-password',
    })
  } catch {
    refused = true
  }
  check('a wrong admin password is refused', refused)

  console.log('\n=== add a grader mid-session ===')
  const added = await backend.addGrader({
    sessionId,
    name: 'Latecomer',
    pin: '4242',
    accentIndex: 1,
    adminPassword: ADMIN,
  })
  check('grader added', Boolean(added), added?.name)
  check('the assigned PIN came back', added?.pin === '4242', String(added?.pin))

  console.log('\n=== duplicate names are rejected ===')
  let dupeRejected = false
  try {
    await backend.addGrader({
      sessionId,
      name: 'Latecomer',
      pin: '5555',
      accentIndex: 2,
      adminPassword: ADMIN,
    })
  } catch {
    dupeRejected = true
  }
  check('a duplicate name is rejected', dupeRejected)

  console.log('\n=== the watching device notices the new grader ===')
  const started = Date.now()
  let noticed = false
  while (Date.now() - started < 20_000) {
    noticed = seenGraders.some((x) => x.name === 'Latecomer')
    if (noticed) break
    await new Promise((r) => setTimeout(r, 500))
  }
  check(
    'new grader propagated to a connected device',
    noticed,
    noticed ? `after ${((Date.now() - started) / 1000).toFixed(1)}s` : 'timed out',
  )
  unsubscribe()

  console.log('\n=== the new grader can actually grade ===')
  const wrote = await writeGrade(sessionId, added!.id, 'card-2', 'A')
  check('new grader can write a grade', wrote)

  console.log('\n=== their absence from earlier cards does not distort results ===')
  // card-1 was graded B by Original only. The newcomer has no grade for it,
  // which must be ignored rather than counted as an F.
  const c1 = combine(['B', null])
  check('a card the newcomer never saw keeps its grade', c1.letter === 'B', String(c1.letter))
  check('and counts only the graders who graded it', c1.count === 1, String(c1.count))

  const reloaded = await backend.loadSession(sessionId)
  check('reload shows both graders', reloaded?.graders.length === 2, String(reloaded?.graders.length))
  check(
    'reload shows both grades',
    reloaded?.grades.length === 2,
    String(reloaded?.grades.length),
  )

  console.log('\n=== cleanup ===')
  await backend.deleteSession(sessionId, ADMIN)
  check('session deleted', true)

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})
