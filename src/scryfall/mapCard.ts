/** Maps raw Scryfall cards to the trimmed CardRecord frozen into a session. */

import type { RawCard, RawCardFace, RawImageUris } from './api'
import type { Bucket, CardFace, CardRecord, Rarity } from '../domain/types'

const KNOWN_RARITIES: readonly string[] = [
  'common',
  'uncommon',
  'rare',
  'mythic',
  'special',
  'bonus',
]

function toRarity(r: string): Rarity {
  return (KNOWN_RARITIES.includes(r) ? r : 'special') as Rarity
}

/** Layouts where both faces are separately printed and worth flipping to.
 *  Split and flip cards show everything on one image, so they are excluded. */
const MULTI_FACED_LAYOUTS = new Set([
  'transform',
  'modal_dfc',
  'double_faced_token',
  'reversible_card',
  'art_series',
])

/** Double-faced cards carry `colors: null` at the top level and put colours on
 *  each face. Reading `card.colors` alone mis-buckets every DFC as colourless. */
export function effectiveColors(card: RawCard): string[] {
  if (card.colors && card.colors.length > 0) return [...card.colors]
  if (card.colors && card.colors.length === 0 && !card.card_faces) return []

  const fromFaces = new Set<string>()
  for (const face of card.card_faces ?? []) {
    for (const c of face.colors ?? []) fromFaces.add(c)
  }
  if (fromFaces.size > 0) return [...fromFaces]
  return card.colors ? [...card.colors] : []
}

/** Every non-basic land buckets to 'L' regardless of colour identity, matching
 *  how draft guides group them. Colour comes from `colors`, not `color_identity`,
 *  so a mono-green card with an off-colour activation stays green. */
export function bucketOf(card: RawCard): Bucket {
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? ''
  if (/\bLand\b/.test(typeLine)) return 'L'

  const colors = effectiveColors(card)
  if (colors.length === 0) return 'C'
  if (colors.length === 1) return colors[0] as Bucket
  return 'MC'
}

function pickImages(uris: RawImageUris | undefined): {
  normal: string | null
  art: string | null
} {
  return {
    normal: uris?.normal ?? uris?.large ?? uris?.png ?? null,
    art: uris?.art_crop ?? null,
  }
}

function faceFrom(src: RawCardFace | RawCard, images: RawImageUris | undefined): CardFace {
  const { normal, art } = pickImages(images)
  return {
    name: src.name,
    typeLine: src.type_line ?? '',
    manaCost: src.mana_cost ?? null,
    oracleText: src.oracle_text ?? null,
    flavorText: src.flavor_text ?? null,
    power: src.power ?? null,
    toughness: src.toughness ?? null,
    loyalty: src.loyalty ?? null,
    defense: src.defense ?? null,
    imageNormal: normal,
    imageArt: art,
  }
}

/** Collector numbers are strings and may carry suffixes ('12a', '★103').
 *  Sorting them lexically puts 10 before 2, so extract the leading integer. */
export function collectorSortValue(cn: string): number {
  const m = cn.match(/\d+/)
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER
}

export function mapCard(card: RawCard, section: string): CardRecord {
  const hasFaceImages = (card.card_faces ?? []).some((f) => f.image_uris)

  // Single-faced cards keep images at the top level; DFCs put them per face.
  const faces: CardFace[] =
    card.card_faces && card.card_faces.length > 0
      ? card.card_faces.map((f) => faceFrom(f, hasFaceImages ? f.image_uris : card.image_uris))
      : [faceFrom(card, card.image_uris)]

  return {
    id: card.id,
    name: card.name,
    set: card.set,
    section,
    collectorNumber: card.collector_number,
    collectorSort: collectorSortValue(card.collector_number),
    rarity: toRarity(card.rarity),
    layout: card.layout,
    bucket: bucketOf(card),
    colors: effectiveColors(card),
    colorIdentity: card.color_identity ?? [],
    cmc: card.cmc ?? 0,
    typeLine: card.type_line ?? faces[0]?.typeLine ?? '',
    faces,
    multiFaced: MULTI_FACED_LAYOUTS.has(card.layout) && faces.length > 1 && hasFaceImages,
  }
}
