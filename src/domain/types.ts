/** Core domain types. These are storage-facing: CardRecord is what gets frozen
 *  into sessions.cards, so changing it is a data migration, not a refactor. */

/** Colour buckets used for grouping. 'MC' multicolour, 'C' colourless, 'L' land.
 *  Every non-basic land lands in 'L' regardless of colour identity, matching how
 *  draft guides group them. */
export type Bucket = 'W' | 'U' | 'B' | 'R' | 'G' | 'MC' | 'C' | 'L'

export const BUCKETS: readonly Bucket[] = ['W', 'U', 'B', 'R', 'G', 'MC', 'C', 'L']

export const BUCKET_LABELS: Record<Bucket, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  MC: 'Multicolour',
  C: 'Colourless',
  L: 'Land',
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus'

export const RARITY_ORDER_DEFAULT: readonly Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'mythic',
  'special',
  'bonus',
]

/** One face of a card. Single-faced cards have exactly one. */
export interface CardFace {
  name: string
  typeLine: string
  manaCost: string | null
  oracleText: string | null
  flavorText: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  imageNormal: string | null
  imageArt: string | null
}

/** Trimmed Scryfall card, frozen into the session at creation time.
 *  `section` is 'main' or a bonus-sheet set code. */
export interface CardRecord {
  id: string
  name: string
  set: string
  section: string
  collectorNumber: string
  /** Numeric form of collectorNumber for correct sorting; NaN-safe. */
  collectorSort: number
  rarity: Rarity
  layout: string
  bucket: Bucket
  colors: string[]
  colorIdentity: string[]
  cmc: number
  typeLine: string
  faces: CardFace[]
  /** True when the card has two distinct printed faces worth flipping between. */
  multiFaced: boolean
}

export interface BonusSet {
  code: string
  name: string
}

/** 'set-number' ignores colour and rarity entirely and walks the set in
 *  printed collector-number order, which is how spoiler galleries are laid out. */
export type OrderMode = 'color-first' | 'rarity-first' | 'set-number'

export const ORDER_MODE_LABELS: Record<OrderMode, string> = {
  'color-first': 'Colour, then rarity',
  'rarity-first': 'Rarity, then colour',
  'set-number': 'Set number',
}

export interface GradingSettings {
  mode: OrderMode
  /** Bucket order, e.g. ['W','U','B','R','G','MC','C','L'] */
  colorOrder: Bucket[]
  rarityOrder: Rarity[]
  /** Section codes in display order; 'main' plus any bonus sheet codes. */
  sectionOrder: string[]
  tiebreak: 'collector' | 'name'
  /** Grading view: full card image, or art crop with separate text panel. */
  cardDisplay: 'full' | 'art'
}

export interface Grade {
  cardId: string
  graderId: string
  grade: GradeLetter | null
  isBuildaround: boolean
  buildaroundGrade: GradeLetter | null
  notes: string
}

export interface Grader {
  id: string
  name: string
  currentCardId: string | null
  followId: string | null
  accent: string
  /** Four digits, assigned by the host when the session is created.
   *  Stored and transmitted in the clear so the host can read it back; see the
   *  note in supabase/migrations/0002. It prevents accidental cross-grading,
   *  not access. */
  pin: string | null
}

export interface SessionMeta {
  id: string
  code: string
  name: string
  setCode: string
  setName: string
  bonusSets: BonusSet[]
  settings: GradingSettings
  /** The grader who created the session. Decides who is shown the PIN list.
   *  UI convenience only; anyone with the code can read the table directly. */
  hostGraderId: string | null
  /** Read-only share token. Present only for readers allowed to see it. */
  viewToken: string | null
}

// Re-exported from grades.ts to keep the type surface in one import site.
import type { GradeLetter } from './grades'
export type { GradeLetter }
