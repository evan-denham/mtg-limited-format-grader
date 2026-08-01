/** Builds the frozen card pool for a session: main set plus bonus sheets. */

import { countMatches, getSet, listSets, searchAll, type RawSet } from './api'
import { mapCard } from './mapCard'
import type { BonusSet, CardRecord } from '../domain/types'

export const MAIN_SECTION = 'main'

/** A bonus sheet is a masterpiece set whose parent is the main set.
 *  Verified: sos->soa, stx->sta, eoe->eos, fin->fca, tmt->pza. */
export function findBonusSheets(sets: readonly RawSet[], parentCode: string): RawSet[] {
  const parent = parentCode.toLowerCase()
  return sets
    .filter((s) => !s.digital && s.set_type === 'masterpiece' && s.parent_set_code === parent)
    .sort((a, b) => a.code.localeCompare(b.code))
}

export async function detectBonusSheets(parentCode: string): Promise<BonusSet[]> {
  const sets = await listSets()
  return findBonusSheets(sets, parentCode).map((s) => ({ code: s.code, name: s.name }))
}

export function mainQuery(setCode: string, useBooster: boolean): string {
  const code = setCode.toLowerCase()
  const base = `set:${code} -type:"basic land" -is:token`
  return useBooster ? `${base} is:booster` : base
}

export function bonusQuery(setCode: string, range?: CollectorRange): string {
  const parts = [`set:${setCode.toLowerCase()}`, '-type:"basic land"', '-is:token']
  if (range?.from != null) parts.push(`cn>=${range.from}`)
  if (range?.to != null) parts.push(`cn<=${range.to}`)
  return parts.join(' ')
}

export interface CollectorRange {
  from?: number
  to?: number
}

export interface BonusRequest {
  code: string
  name: string
  range?: CollectorRange
}

export interface PoolReport {
  /** The query actually used for the main set. */
  mainQuery: string
  /** True when is:booster returned nothing usable and we fell back. */
  usedFallback: boolean
  boosterCount: number
  plainCount: number
  mainCards: number
  sections: { code: string; name: string; count: number }[]
}

export interface BuildPoolResult {
  cards: CardRecord[]
  report: PoolReport
}

export interface BuildPoolOptions {
  bonusSets?: BonusRequest[]
  /** Overrides the main-set query entirely. Escape hatch for odd sets. */
  queryOverride?: string
  onProgress?: (message: string, loaded: number) => void
  signal?: AbortSignal
}

/** `is:booster` is unpopulated on brand-new sets: `set:sos is:booster` returned
 *  404/no-matches while `set:ecl is:booster` returned 273. Since grading a set
 *  at release is the main use case, fall back to the plain set query whenever
 *  the booster filter returns nothing or looks implausibly small. */
const FALLBACK_RATIO = 0.5

export async function buildPool(
  setCode: string,
  opts: BuildPoolOptions = {},
): Promise<BuildPoolResult> {
  const code = setCode.toLowerCase()
  const boosterQ = mainQuery(code, true)
  const plainQ = mainQuery(code, false)

  let chosen: string
  let usedFallback = false
  let boosterCount = 0
  let plainCount = 0

  if (opts.queryOverride?.trim()) {
    chosen = opts.queryOverride.trim()
  } else {
    ;[boosterCount, plainCount] = await Promise.all([
      countMatches(boosterQ),
      countMatches(plainQ),
    ])
    usedFallback = boosterCount === 0 || boosterCount < plainCount * FALLBACK_RATIO
    chosen = usedFallback ? plainQ : boosterQ
  }

  opts.onProgress?.('Loading main set', 0)
  const rawMain = await searchAll(chosen, {
    signal: opts.signal,
    onProgress: (n) => opts.onProgress?.('Loading main set', n),
  })
  const cards: CardRecord[] = rawMain.map((c) => mapCard(c, MAIN_SECTION))

  const sections: PoolReport['sections'] = [
    { code: MAIN_SECTION, name: 'Main set', count: cards.length },
  ]

  for (const bonus of opts.bonusSets ?? []) {
    opts.onProgress?.(`Loading ${bonus.name}`, cards.length)
    const raw = await searchAll(bonusQuery(bonus.code, bonus.range), {
      signal: opts.signal,
      onProgress: (n) => opts.onProgress?.(`Loading ${bonus.name}`, cards.length + n),
    })
    const mapped = raw.map((c) => mapCard(c, bonus.code))
    cards.push(...mapped)
    sections.push({ code: bonus.code, name: bonus.name, count: mapped.length })
  }

  // A card can legitimately appear in both the main set and a bonus sheet
  // reprint; keep the first (main) occurrence so it is graded once.
  const seen = new Set<string>()
  const deduped = cards.filter((c) => {
    const key = `${c.section}:${c.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    cards: deduped,
    report: {
      mainQuery: chosen,
      usedFallback,
      boosterCount,
      plainCount,
      mainCards: deduped.filter((c) => c.section === MAIN_SECTION).length,
      sections,
    },
  }
}

export async function validateSet(code: string): Promise<RawSet> {
  return getSet(code)
}
