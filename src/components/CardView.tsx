/** Card display. This is the focus of the app, so it gets the space.
 *
 *  Image on the left, rules text on the right. Double-faced cards get a flip
 *  control; single-faced cards do not render one.
 */

import { useEffect, useState } from 'react'
import type { CardRecord } from '../domain/types'
import { BUCKET_LABELS } from '../domain/types'
import { RARITY_LABELS } from '../domain/ordering'

function ManaCost({ cost }: { cost: string | null }) {
  if (!cost) return null
  return <span className="font-mono text-sm text-[--color-muted]">{cost}</span>
}

/** Oracle text uses blank lines between abilities; preserve them. */
function OracleText({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {text.split('\n').map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  )
}

export function CardView({
  card,
  display,
}: {
  card: CardRecord
  display: 'full' | 'art'
}) {
  const [faceIndex, setFaceIndex] = useState(0)

  // Reset to the front face when the card changes, or face 2 of a transform
  // card leaks onto the next card.
  useEffect(() => setFaceIndex(0), [card.id])

  const face = card.faces[Math.min(faceIndex, card.faces.length - 1)] ?? card.faces[0]
  const image = display === 'art' ? (face?.imageArt ?? face?.imageNormal) : face?.imageNormal

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-xl bg-[--color-panel]">
          {image ? (
            <img
              src={image}
              alt={face?.name ?? card.name}
              className="w-full"
              loading="eager"
              draggable={false}
            />
          ) : (
            <div className="flex aspect-[5/7] items-center justify-center text-sm text-[--color-muted]">
              No image available
            </div>
          )}
        </div>

        {card.multiFaced ? (
          <button
            type="button"
            onClick={() => setFaceIndex((i) => (i + 1) % card.faces.length)}
            className="w-full rounded border border-[--color-edge] bg-[--color-panel] px-3 py-2 text-sm hover:border-[--color-muted]"
          >
            Flip to {card.faces[(faceIndex + 1) % card.faces.length]?.name}
          </button>
        ) : null}
      </div>

      <div className="min-w-0 space-y-4">
        <div>
          <h2 className="text-2xl font-medium">{face?.name ?? card.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[--color-muted]">
            <span>{face?.typeLine}</span>
            <ManaCost cost={face?.manaCost ?? null} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Tag>{RARITY_LABELS[card.rarity] ?? card.rarity}</Tag>
          <Tag>{BUCKET_LABELS[card.bucket] ?? card.bucket}</Tag>
          <Tag>
            {card.set.toUpperCase()} {card.collectorNumber}
          </Tag>
          {card.section !== 'main' ? <Tag>Bonus sheet</Tag> : null}
        </div>

        <div className="rounded border border-[--color-edge] bg-[--color-panel] p-4">
          <OracleText text={face?.oracleText ?? null} />
          {face?.flavorText ? (
            <p className="mt-3 border-t border-[--color-edge] pt-3 text-sm italic text-[--color-muted]">
              {face.flavorText}
            </p>
          ) : null}
          {face?.power != null && face?.toughness != null ? (
            <p className="mt-3 text-right font-mono text-sm">
              {face.power}/{face.toughness}
            </p>
          ) : null}
          {face?.loyalty != null ? (
            <p className="mt-3 text-right font-mono text-sm">Loyalty {face.loyalty}</p>
          ) : null}
          {face?.defense != null ? (
            <p className="mt-3 text-right font-mono text-sm">Defense {face.defense}</p>
          ) : null}
        </div>

        {/* The back face's rules text matters for grading even when the front
            image is showing, so surface it rather than hiding it behind flip. */}
        {card.multiFaced && card.faces.length > 1 ? (
          <details className="rounded border border-[--color-edge] bg-[--color-panel] p-3">
            <summary className="cursor-pointer text-sm text-[--color-muted]">
              Other faces
            </summary>
            <div className="mt-3 space-y-4">
              {card.faces
                .filter((_, i) => i !== faceIndex)
                .map((f, i) => (
                  <div key={i} className="border-t border-[--color-edge] pt-3 first:border-0 first:pt-0">
                    <p className="font-medium">{f.name}</p>
                    <p className="text-sm text-[--color-muted]">{f.typeLine}</p>
                    <div className="mt-2">
                      <OracleText text={f.oracleText} />
                    </div>
                  </div>
                ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-[--color-edge] px-2 py-1 text-[--color-muted]">
      {children}
    </span>
  )
}
