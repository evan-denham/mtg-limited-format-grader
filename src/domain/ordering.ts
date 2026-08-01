/** Turns the shared GradingSettings into the ordered grading queue. */

import { BUCKETS, RARITY_ORDER_DEFAULT, type Bucket, type CardRecord, type GradingSettings, type Rarity } from './types'
import { MAIN_SECTION } from '../scryfall/pool'

export const DEFAULT_SETTINGS: GradingSettings = {
  mode: 'color-first',
  colorOrder: [...BUCKETS],
  rarityOrder: [...RARITY_ORDER_DEFAULT],
  sectionOrder: [MAIN_SECTION],
  tiebreak: 'collector',
  cardDisplay: 'full',
}

/** Items missing from an order list sort last rather than vanishing. */
function rankIn<T>(list: readonly T[], value: T): number {
  const i = list.indexOf(value)
  return i === -1 ? list.length : i
}

/** Parses a user-typed colour order such as "WUBRG MC C L" or "w,u,b,r,g,mc,c,l".
 *  Tokens are matched longest-first so 'MC' is not read as 'M','C'.
 *  Unrecognised characters are ignored; missing buckets are appended in the
 *  canonical order so no card can ever fall out of the queue. */
export function parseColorOrder(input: string): Bucket[] {
  const text = input.toUpperCase()
  const out: Bucket[] = []
  let i = 0
  while (i < text.length) {
    if (text.startsWith('MC', i)) {
      if (!out.includes('MC')) out.push('MC')
      i += 2
      continue
    }
    const ch = text[i] as Bucket
    if ((BUCKETS as readonly string[]).includes(ch) && !out.includes(ch)) out.push(ch)
    i += 1
  }
  for (const b of BUCKETS) if (!out.includes(b)) out.push(b)
  return out
}

export function formatColorOrder(order: readonly Bucket[]): string {
  return order.join(' ')
}

export interface SortContext {
  settings: GradingSettings
  /** Section codes in display order. Sections absent from settings sort last. */
  sectionOrder: readonly string[]
}

function compare(a: CardRecord, b: CardRecord, ctx: SortContext): number {
  const { settings, sectionOrder } = ctx

  const section = rankIn(sectionOrder, a.section) - rankIn(sectionOrder, b.section)
  if (section !== 0) return section

  // Set-number mode deliberately skips the colour and rarity axes: the point
  // is to walk the set exactly as printed.
  if (settings.mode === 'set-number') {
    if (a.collectorSort !== b.collectorSort) return a.collectorSort - b.collectorSort
    return a.collectorNumber.localeCompare(b.collectorNumber) || a.name.localeCompare(b.name)
  }

  const color = rankIn(settings.colorOrder, a.bucket) - rankIn(settings.colorOrder, b.bucket)
  const rarity = rankIn(settings.rarityOrder, a.rarity) - rankIn(settings.rarityOrder, b.rarity)

  if (settings.mode === 'color-first') {
    if (color !== 0) return color
    if (rarity !== 0) return rarity
  } else {
    if (rarity !== 0) return rarity
    if (color !== 0) return color
  }

  if (settings.tiebreak === 'collector') {
    if (a.collectorSort !== b.collectorSort) return a.collectorSort - b.collectorSort
  }
  return a.name.localeCompare(b.name)
}

/** Stable ordered queue. Never mutates the input. */
export function orderCards(cards: readonly CardRecord[], settings: GradingSettings): CardRecord[] {
  const sections =
    settings.sectionOrder.length > 0 ? settings.sectionOrder : [MAIN_SECTION]
  const ctx: SortContext = { settings, sectionOrder: sections }
  return [...cards].sort((a, b) => compare(a, b, ctx))
}

/** Section codes present in the pool, main first then bonus sheets. */
export function sectionsInPool(cards: readonly CardRecord[]): string[] {
  const found = new Set(cards.map((c) => c.section))
  const out: string[] = []
  if (found.has(MAIN_SECTION)) out.push(MAIN_SECTION)
  for (const s of [...found].sort()) if (s !== MAIN_SECTION) out.push(s)
  return out
}

export type RarityLabel = Record<Rarity, string>

export const RARITY_LABELS: RarityLabel = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
  special: 'Special',
  bonus: 'Bonus',
}
