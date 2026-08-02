import { describe, expect, it } from 'vitest'
import { safeFilename, toCsv, toJson, toPrintableHtml, type ExportInput } from './exporters'
import { DEFAULT_SETTINGS } from '../domain/ordering'
import type { CardRecord, Grade, Grader } from '../domain/types'

const card = (over: Partial<CardRecord> = {}): CardRecord => ({
  id: 'c1',
  name: 'Test Card',
  set: 'ecl',
  section: 'main',
  collectorNumber: '1',
  collectorSort: 1,
  rarity: 'common',
  layout: 'normal',
  bucket: 'W',
  colors: ['W'],
  colorIdentity: ['W'],
  cmc: 2,
  typeLine: 'Creature — Test',
  faces: [
    {
      name: 'Test Card',
      typeLine: 'Creature — Test',
      manaCost: '{1}{W}',
      oracleText: 'Text.',
      flavorText: null,
      power: '2',
      toughness: '2',
      loyalty: null,
      defense: null,
      imageNormal: 'https://cards.scryfall.io/normal/x.jpg',
      imageArt: 'https://cards.scryfall.io/art_crop/x.jpg',
    },
  ],
  multiFaced: false,
  ...over,
})

const graders: Grader[] = [
  { id: 'g1', name: 'Alice', currentCardId: null, followId: null, accent: '#fff', pin: '1234' },
  { id: 'g2', name: 'Bob', currentCardId: null, followId: null, accent: '#000', pin: '5678' },
]

const grade = (over: Partial<Grade> & Pick<Grade, 'graderId' | 'cardId'>): Grade => ({
  grade: null,
  isBuildaround: false,
  buildaroundGrade: null,
  notes: '',
  ...over,
})

function input(over: Partial<ExportInput> = {}): ExportInput {
  return {
    meta: {
      id: 's1',
      code: 'ABC-123',
      name: 'Test review',
      setCode: 'ecl',
      setName: 'Lorwyn Eclipsed',
      bonusSets: [],
      settings: DEFAULT_SETTINGS,
      hostGraderId: 'g1',
    },
    cards: [card()],
    graders,
    grades: {},
    ...over,
  }
}

describe('toCsv', () => {
  it('emits a header plus one row per card', () => {
    const rows = toCsv(input()).split('\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Alice grade')
    expect(rows[0]).toContain('Bob notes')
  })

  it('quotes notes containing commas, quotes and newlines', () => {
    const csv = toCsv(
      input({
        grades: {
          'g1:c1': grade({
            graderId: 'g1',
            cardId: 'c1',
            grade: 'B',
            notes: 'Good, but "situational"\nneeds support',
          }),
        },
      }),
    )
    // The embedded quote must be doubled and the whole cell wrapped.
    expect(csv).toContain('"Good, but ""situational""\nneeds support"')
    // The comma inside the note must not create an extra column in the header row.
    expect(csv.split('\r\n')[0].split(',').length).toBeGreaterThan(10)
  })

  it('writes the combined grade and spread across graders', () => {
    const csv = toCsv(
      input({
        grades: {
          'g1:c1': grade({ graderId: 'g1', cardId: 'c1', grade: 'C' }),
          'g2:c1': grade({ graderId: 'g2', cardId: 'c1', grade: 'A-' }),
        },
      }),
    )
    const row = csv.split('\r\n')[1]
    // C=5, A-=10 -> mean 7.5 -> rounds half-up to index 8 = B. Spread 5.
    expect(row).toContain(',B,7.50,5,')
  })

  it('combines build-around grades only over graders who flagged it', () => {
    const csv = toCsv(
      input({
        grades: {
          'g1:c1': grade({
            graderId: 'g1',
            cardId: 'c1',
            grade: 'D',
            isBuildaround: true,
            buildaroundGrade: 'A',
          }),
          'g2:c1': grade({ graderId: 'g2', cardId: 'c1', grade: 'D' }),
        },
      }),
    )
    const row = csv.split('\r\n')[1]
    // Standard D, build-around A: the case the feature exists for.
    expect(row).toContain('yes')
    expect(row).toContain('A')
  })

  it('leaves ungraded cards blank rather than writing F', () => {
    const row = toCsv(input()).split('\r\n')[1]
    expect(row).not.toMatch(/,F,/)
  })
})

describe('toPrintableHtml', () => {
  it('produces a standalone document with no external stylesheet or script', () => {
    const html = toPrintableHtml(input())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<link[^>]+stylesheet/i)
  })

  it('includes the card image and the combined grade', () => {
    const html = toPrintableHtml(
      input({
        grades: { 'g1:c1': grade({ graderId: 'g1', cardId: 'c1', grade: 'B+' }) },
      }),
    )
    expect(html).toContain('https://cards.scryfall.io/normal/x.jpg')
    expect(html).toContain('>B+<')
  })

  it('escapes card names so an apostrophe or angle bracket cannot break the page', () => {
    const html = toPrintableHtml(
      input({ cards: [card({ name: `Brigid's <Heart> & "Soul"` })] }),
    )
    expect(html).toContain('Brigid&#39;s &lt;Heart&gt; &amp; &quot;Soul&quot;')
    expect(html).not.toContain('<Heart>')
  })

  it('groups bonus sheets into their own section', () => {
    const html = toPrintableHtml(
      input({ cards: [card(), card({ id: 'c2', name: 'Bonus', section: 'soa' })] }),
    )
    expect(html).toContain('Main set (1)')
    expect(html).toContain('SOA (1)')
  })
})

describe('toJson', () => {
  it('never includes grader PINs, which must not travel in an exported file', () => {
    const json = toJson(input())
    expect(json).not.toContain('1234')
    expect(json).not.toContain('5678')
    expect(json).not.toContain('"pin"')
    // Sanity: the graders themselves are still present.
    expect(JSON.parse(json).graders.map((g: { name: string }) => g.name)).toEqual(['Alice', 'Bob'])
  })

  it('round-trips through JSON.parse with grades as an array', () => {
    const parsed = JSON.parse(
      toJson(input({ grades: { 'g1:c1': grade({ graderId: 'g1', cardId: 'c1', grade: 'A' }) } })),
    )
    expect(parsed.version).toBe(1)
    expect(parsed.grades).toHaveLength(1)
    expect(parsed.grades[0].grade).toBe('A')
    expect(parsed.cards).toHaveLength(1)
  })
})

describe('safeFilename', () => {
  it('strips characters that are illegal in filenames', () => {
    expect(safeFilename('Lorwyn Eclipsed review!')).toBe('lorwyn-eclipsed-review')
  })

  it('falls back rather than returning an empty name', () => {
    expect(safeFilename('///')).toBe('grades')
  })
})
