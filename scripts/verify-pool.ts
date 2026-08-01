/** Live verification against the real Scryfall API.
 *
 *  Not part of the unit suite: it needs a network and Scryfall's data changes.
 *  Run with `npm run verify`.
 */

import { buildPool, detectBonusSheets } from '../src/scryfall/pool'
import { orderCards, DEFAULT_SETTINGS, sectionsInPool } from '../src/domain/ordering'
import type { Bucket, CardRecord } from '../src/domain/types'

// Scryfall rejects the default Node/undici User-Agent with a 400. The app
// itself never sets one because browsers forbid it as a request header and
// send a real browser UA instead. Only this Node-side script needs the patch.
// api.ts resolves `fetch` from globalThis at call time, so wrapping it here
// is enough.
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  headers.set('User-Agent', 'MTGLimitedFormatGrader/0.1 (verification script)')
  return realFetch(input, { ...init, headers })
}) as typeof fetch

let failures = 0

function check(label: string, ok: boolean, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  if (!ok) failures += 1
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`)
}

function tally(cards: CardRecord[], key: (c: CardRecord) => string) {
  const m = new Map<string, number>()
  for (const c of cards) m.set(key(c), (m.get(key(c)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

async function verifySet(code: string, expectFallback: boolean) {
  console.log(`\n=== ${code.toUpperCase()} ===`)
  const sheets = await detectBonusSheets(code)
  console.log(`  bonus sheets detected: ${sheets.map((s) => s.code).join(', ') || 'none'}`)

  const { cards, report } = await buildPool(code)
  console.log(`  query: ${report.mainQuery}`)
  console.log(`  booster count: ${report.boosterCount}, plain count: ${report.plainCount}`)
  console.log(`  cards: ${cards.length}`)
  console.log(`  rarity: ${tally(cards, (c) => c.rarity).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  console.log(`  bucket: ${tally(cards, (c) => c.bucket).map(([k, v]) => `${k}=${v}`).join(' ')}`)

  check('pool is non-empty', cards.length > 100, `${cards.length} cards`)
  check(
    expectFallback ? 'used the fallback query' : 'used the is:booster query',
    report.usedFallback === expectFallback,
    `usedFallback=${report.usedFallback}`,
  )
  check('no basic lands', !cards.some((c) => /^Basic /.test(c.typeLine)))
  check('no tokens', !cards.some((c) => c.layout === 'token'))
  check(
    'every card has at least one face with an image',
    cards.every((c) => c.faces.length > 0 && c.faces.some((f) => f.imageNormal)),
  )
  check(
    'no card bucketed outside the known set',
    cards.every((c) => ['W', 'U', 'B', 'R', 'G', 'MC', 'C', 'L'].includes(c.bucket)),
  )
  check('card ids are unique', new Set(cards.map((c) => c.id)).size === cards.length)

  // The DFC trap: Scryfall omits `colors` on double-faced cards, so a naive
  // reader buckets every one of them as colourless.
  const dfcs = cards.filter((c) => c.multiFaced)
  console.log(`  double-faced cards: ${dfcs.length}`)
  if (dfcs.length > 0) {
    const miscolored = dfcs.filter((c) => c.bucket === 'C' && !/\bLand\b/.test(c.typeLine))
    check(
      'no double-faced card fell into the colourless bucket',
      miscolored.length === 0,
      miscolored.length ? miscolored.map((c) => c.name).join(', ') : `${dfcs.length} checked`,
    )
    for (const d of dfcs.slice(0, 3)) {
      console.log(`    ${d.name} -> ${d.bucket} (faces: ${d.faces.map((f) => f.name).join(' // ')})`)
    }
  }

  // Ordering must cover every card exactly once, in both modes.
  for (const mode of ['color-first', 'rarity-first'] as const) {
    const settings = {
      ...DEFAULT_SETTINGS,
      mode,
      sectionOrder: sectionsInPool(cards),
    }
    const ordered = orderCards(cards, settings)
    check(
      `${mode} ordering keeps every card exactly once`,
      ordered.length === cards.length &&
        new Set(ordered.map((c) => c.id)).size === cards.length,
    )
  }

  return cards
}

async function verifyBonusSheet(parent: string, sheet: string) {
  console.log(`\n=== ${parent.toUpperCase()} + ${sheet.toUpperCase()} ===`)
  const sheets = await detectBonusSheets(parent)
  check(
    `${sheet} auto-detected from parent_set_code`,
    sheets.some((s) => s.code === sheet),
    sheets.map((s) => s.code).join(', ') || 'none',
  )

  const found = sheets.find((s) => s.code === sheet)
  if (!found) return

  const { cards } = await buildPool(parent, { bonusSets: [{ code: found.code, name: found.name }] })
  const bonusCards = cards.filter((c) => c.section === sheet)
  console.log(`  main: ${cards.length - bonusCards.length}, ${sheet}: ${bonusCards.length}`)
  check('bonus sheet contributed cards', bonusCards.length > 0)

  const sections = sectionsInPool(cards)
  check('sections are main-first', sections[0] === 'main', sections.join(', '))

  // Bonus sheet must stay in its own block regardless of colour.
  const ordered = orderCards(cards, { ...DEFAULT_SETTINGS, sectionOrder: sections })
  const firstBonusAt = ordered.findIndex((c) => c.section === sheet)
  const lastMainAt = ordered.map((c) => c.section).lastIndexOf('main')
  check('bonus sheet sorts entirely after the main set', firstBonusAt > lastMainAt)
}

async function main() {
  // ECL: booster flags populated. Should NOT use the fallback.
  await verifySet('ecl', false)

  // SOS: booster flags missing at time of writing. MUST use the fallback.
  // If this ever flips to PASS-without-fallback, Scryfall has backfilled the
  // data and the expectation here should be updated, not the code.
  await verifySet('sos', true)

  await verifyBonusSheet('sos', 'soa')
  await verifyBonusSheet('stx', 'sta')

  console.log(
    `\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nVerification crashed:', err)
  process.exit(1)
})

export type { Bucket }
