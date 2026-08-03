import { describe, expect, it } from 'vitest'
import fixtures from './__fixtures__/ecl-sample.json'
import { bucketOf, collectorSortValue, effectiveColors, mapCard } from './mapCard'
import type { RawCard } from './api'

const cards = fixtures as unknown as RawCard[]
const byName = (needle: string): RawCard => {
  const c = cards.find((x) => x.name.startsWith(needle))
  if (!c) throw new Error(`fixture missing: ${needle}`)
  return c
}

describe('effectiveColors', () => {
  it('reads colours from faces when the top level is missing (double-faced cards)', () => {
    const brigid = byName('Brigid')
    // The trap: Scryfall OMITS the colors key entirely on DFCs (not null, absent).
    // Anything reading card.colors directly sees undefined and buckets it as colourless.
    expect('colors' in brigid).toBe(false)
    expect(effectiveColors(brigid).sort()).toEqual(['G', 'W'])
  })

  it('also handles an explicit null colors value', () => {
    const withNull = { ...byName('Brigid'), colors: null } as RawCard
    expect(effectiveColors(withNull).sort()).toEqual(['G', 'W'])
  })

  it('reads colours from the top level on single-faced cards', () => {
    expect(effectiveColors(byName('Adept Watershaper'))).toEqual(['W'])
  })

  it('returns empty for a genuinely colourless card', () => {
    expect(effectiveColors(byName('Changeling Wayfinder'))).toEqual([])
  })
})

describe('bucketOf', () => {
  it('buckets a two-colour double-faced card as multicolour, not colourless', () => {
    expect(bucketOf(byName('Brigid'))).toBe('MC')
    expect(bucketOf(byName('Eirdu'))).toBe('MC')
  })

  it('buckets a gold card as multicolour', () => {
    expect(bucketOf(byName('Abigale'))).toBe('MC')
  })

  it('buckets a mono-coloured card by its colour', () => {
    expect(bucketOf(byName('Adept Watershaper'))).toBe('W')
  })

  it('buckets a colourless non-land as C', () => {
    expect(bucketOf(byName('Changeling Wayfinder'))).toBe('C')
  })

  it('buckets a non-basic land as L', () => {
    expect(bucketOf(byName('Blood Crypt'))).toBe('L')
  })

  it('sends a coloured land to L rather than its colour', () => {
    const coloredLand = {
      ...byName('Blood Crypt'),
      colors: ['R'],
      type_line: 'Land Creature — Dryad',
    } as RawCard
    expect(bucketOf(coloredLand)).toBe('L')
  })

  it('does not treat "Landfall" or "Island Sanctuary" text as a land type', () => {
    const notALand = { ...byName('Adept Watershaper'), type_line: 'Creature — Landwalker' } as RawCard
    expect(bucketOf(notALand)).toBe('W')
  })
})

describe('mapCard', () => {
  it('gives a double-faced card one entry per face, each with its own image', () => {
    const c = mapCard(byName('Brigid'), 'main')
    expect(c.faces).toHaveLength(2)
    expect(c.multiFaced).toBe(true)
    for (const face of c.faces) {
      expect(face.imageNormal).toMatch(/^https:\/\//)
      expect(face.name.length).toBeGreaterThan(0)
    }
    expect(c.faces[0].name).not.toBe(c.faces[1].name)
  })

  it('gives a single-faced card exactly one face with a working image', () => {
    const c = mapCard(byName('Adept Watershaper'), 'main')
    expect(c.faces).toHaveLength(1)
    expect(c.multiFaced).toBe(false)
    expect(c.faces[0].imageNormal).toMatch(/^https:\/\//)
    expect(c.faces[0].imageArt).toMatch(/^https:\/\//)
  })

  it('tags the section it was loaded under', () => {
    expect(mapCard(byName('Brigid'), 'soa').section).toBe('soa')
  })

  it('never produces a card with zero faces', () => {
    for (const raw of cards) {
      expect(mapCard(raw, 'main').faces.length).toBeGreaterThan(0)
    }
  })

  it('carries oracle text for every fixture card', () => {
    for (const raw of cards) {
      const c = mapCard(raw, 'main')
      const hasText = c.faces.some((f) => (f.oracleText ?? '').length > 0)
      expect(hasText, `${c.name} has no oracle text on any face`).toBe(true)
    }
  })
})

describe('collectorSortValue', () => {
  it('orders numerically rather than lexically', () => {
    expect(collectorSortValue('2')).toBeLessThan(collectorSortValue('10'))
  })

  it('handles suffixed and prefixed numbers', () => {
    expect(collectorSortValue('12a')).toBe(12)
    expect(collectorSortValue('★103')).toBe(103)
  })

  it('sorts unparseable numbers last instead of to the front', () => {
    expect(collectorSortValue('NaN-ish')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('cards whose faces share one printed image', () => {
  // Adventures, splits and flip cards put every face on a single image. They
  // have card_faces but no per-face image_uris, so there is nothing to flip to
  // and all of the rules text has to be rendered at once. Getting this wrong
  // hid the entire Adventure half of 16 cards in The Hobbit.
  const shared = ['Bofur', 'Never']

  for (const needle of shared) {
    it(`${needle}: keeps every face, with text on each`, () => {
      const raw = byName(needle)
      const c = mapCard(raw, 'main')

      expect(c.faces.length).toBeGreaterThan(1)
      for (const face of c.faces) {
        expect(face.name.length, `${c.name} face has no name`).toBeGreaterThan(0)
        expect((face.oracleText ?? '').length, `${face.name} has no rules text`).toBeGreaterThan(0)
      }
    })

    it(`${needle}: is not marked multiFaced, because there is nothing to flip`, () => {
      // multiFaced drives the flip control and must mean "separate images",
      // not merely "several faces".
      expect(mapCard(byName(needle), 'main').multiFaced).toBe(false)
    })

    it(`${needle}: every face carries the one shared image`, () => {
      for (const face of mapCard(byName(needle), 'main').faces) {
        expect(face.imageNormal).toMatch(/^https:\/\//)
      }
    })
  }

  it('the second face is not the same as the first', () => {
    const c = mapCard(byName('Bofur'), 'main')
    expect(c.faces[0].name).not.toBe(c.faces[1].name)
    expect(c.faces[0].oracleText).not.toBe(c.faces[1].oracleText)
    expect(c.faces[1].typeLine).toContain('Adventure')
  })
})
