import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, orderCards, parseColorOrder, sectionsInPool } from './ordering'
import type { Bucket, CardRecord, GradingSettings, Rarity } from './types'

let n = 0
function card(partial: Partial<CardRecord>): CardRecord {
  n += 1
  return {
    id: `id-${n}`,
    name: partial.name ?? `Card ${n}`,
    set: 'ecl',
    section: 'main',
    collectorNumber: String(n),
    collectorSort: n,
    rarity: 'common',
    layout: 'normal',
    bucket: 'W',
    colors: [],
    colorIdentity: [],
    cmc: 1,
    typeLine: 'Creature',
    faces: [],
    multiFaced: false,
    ...partial,
  }
}

const settings = (over: Partial<GradingSettings> = {}): GradingSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
})

describe('parseColorOrder', () => {
  it('parses the standard string', () => {
    expect(parseColorOrder('WUBRG MC C L')).toEqual(['W', 'U', 'B', 'R', 'G', 'MC', 'C', 'L'])
  })

  it('reads MC as one token, not M then C', () => {
    // 'C' must not be pulled forward by the C inside MC.
    expect(parseColorOrder('MC W')).toEqual(['MC', 'W', 'U', 'B', 'R', 'G', 'C', 'L'])
  })

  it('accepts separators and lowercase', () => {
    expect(parseColorOrder('w,u,b,r,g,mc,c,l')).toEqual([
      'W', 'U', 'B', 'R', 'G', 'MC', 'C', 'L',
    ])
  })

  it('appends missing buckets so no card can fall out of the queue', () => {
    const parsed = parseColorOrder('L')
    expect(parsed[0]).toBe('L')
    expect(parsed).toHaveLength(8)
    expect(new Set(parsed).size).toBe(8)
  })

  it('ignores junk characters', () => {
    expect(parseColorOrder('W!!!U???')).toEqual(['W', 'U', 'B', 'R', 'G', 'MC', 'C', 'L'])
  })

  it('never duplicates a bucket even if typed twice', () => {
    expect(parseColorOrder('WWWW')).toHaveLength(8)
  })
})

describe('orderCards', () => {
  const w1 = card({ name: 'W common', bucket: 'W', rarity: 'common', collectorSort: 5 })
  const w2 = card({ name: 'W rare', bucket: 'W', rarity: 'rare', collectorSort: 1 })
  const u1 = card({ name: 'U common', bucket: 'U', rarity: 'common', collectorSort: 9 })
  const land = card({ name: 'A land', bucket: 'L', rarity: 'rare', collectorSort: 2 })
  const pool = [land, u1, w2, w1]

  it('colour-first orders by colour, then rarity', () => {
    const out = orderCards(pool, settings({ mode: 'color-first' }))
    expect(out.map((c) => c.name)).toEqual(['W common', 'W rare', 'U common', 'A land'])
  })

  it('rarity-first orders by rarity, then colour', () => {
    const out = orderCards(pool, settings({ mode: 'rarity-first' }))
    expect(out.map((c) => c.name)).toEqual(['W common', 'U common', 'W rare', 'A land'])
  })

  it('respects a custom colour order', () => {
    const out = orderCards(pool, settings({ colorOrder: parseColorOrder('L U W') }))
    expect(out[0].name).toBe('A land')
    expect(out[1].name).toBe('U common')
  })

  it('breaks ties by collector number, not name, by default', () => {
    const a = card({ name: 'Zebra', bucket: 'W', rarity: 'common', collectorSort: 1 })
    const b = card({ name: 'Alpha', bucket: 'W', rarity: 'common', collectorSort: 2 })
    const out = orderCards([b, a], settings())
    expect(out.map((c) => c.name)).toEqual(['Zebra', 'Alpha'])
  })

  it('breaks ties by name when asked', () => {
    const a = card({ name: 'Zebra', bucket: 'W', rarity: 'common', collectorSort: 1 })
    const b = card({ name: 'Alpha', bucket: 'W', rarity: 'common', collectorSort: 2 })
    const out = orderCards([a, b], settings({ tiebreak: 'name' }))
    expect(out.map((c) => c.name)).toEqual(['Alpha', 'Zebra'])
  })

  it('keeps bonus sheets in their own block after the main set', () => {
    const main = card({ name: 'Main card', section: 'main', bucket: 'G' })
    const bonus = card({ name: 'Bonus card', section: 'soa', bucket: 'W' })
    const out = orderCards([bonus, main], settings({ sectionOrder: ['main', 'soa'] }))
    // 'W' sorts before 'G', so only sectioning can put the main card first.
    expect(out.map((c) => c.section)).toEqual(['main', 'soa'])
  })

  it('can move a bonus sheet in front of the main set', () => {
    const main = card({ name: 'Main card', section: 'main' })
    const bonus = card({ name: 'Bonus card', section: 'soa' })
    const out = orderCards([main, bonus], settings({ sectionOrder: ['soa', 'main'] }))
    expect(out.map((c) => c.section)).toEqual(['soa', 'main'])
  })

  it('does not drop cards whose bucket or rarity is missing from the order lists', () => {
    const odd = card({ name: 'Odd', bucket: 'X' as Bucket, rarity: 'weird' as Rarity })
    const out = orderCards([...pool, odd], settings())
    expect(out).toHaveLength(pool.length + 1)
    expect(out.map((c) => c.name)).toContain('Odd')
  })

  it('does not mutate the input array', () => {
    const input = [...pool]
    orderCards(input, settings())
    expect(input).toEqual(pool)
  })

  it('is deterministic across repeated runs', () => {
    const a = orderCards(pool, settings()).map((c) => c.id)
    const b = orderCards(pool, settings()).map((c) => c.id)
    expect(a).toEqual(b)
  })
})

describe('sectionsInPool', () => {
  it('lists main first then bonus sheets alphabetically', () => {
    const pool = [
      card({ section: 'soa' }),
      card({ section: 'main' }),
      card({ section: 'spg' }),
    ]
    expect(sectionsInPool(pool)).toEqual(['main', 'soa', 'spg'])
  })
})
