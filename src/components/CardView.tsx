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
  return <span className="font-mono text-sm text-muted">{cost}</span>
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
        <CardImage src={image ?? null} alt={face?.name ?? card.name} />

        {card.multiFaced ? (
          <button
            type="button"
            onClick={() => setFaceIndex((i) => (i + 1) % card.faces.length)}
            className="w-full rounded border border-edge bg-raised px-3 py-2 text-sm transition-all duration-100 hover:border-edge-strong hover:bg-raised-hover active:translate-y-px"
          >
            Flip to {card.faces[(faceIndex + 1) % card.faces.length]?.name}
          </button>
        ) : null}
      </div>

      <div className="min-w-0 space-y-4">
        <div>
          <h2 className="text-2xl font-medium">{face?.name ?? card.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
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

        <div className="rounded border border-edge bg-panel p-4">
          <OracleText text={face?.oracleText ?? null} />
          {face?.flavorText ? (
            <p className="mt-3 border-t border-edge pt-3 text-sm italic text-muted">
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
          <details className="rounded border border-edge bg-panel p-3">
            <summary className="cursor-pointer text-sm text-muted">
              Other faces
            </summary>
            <div className="mt-3 space-y-4">
              {card.faces
                .filter((_, i) => i !== faceIndex)
                .map((f, i) => (
                  <div key={i} className="border-t border-edge pt-3 first:border-0 first:pt-0">
                    <p className="font-medium">{f.name}</p>
                    <p className="text-sm text-muted">{f.typeLine}</p>
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
    <span className="rounded border border-edge bg-raised px-2 py-1 text-muted">{children}</span>
  )
}

/** Card images come off the Scryfall CDN and take a moment. Reserve the exact
 *  card aspect ratio and show a skeleton so the layout never jumps and the
 *  grade buttons never shift under a click mid-load. */
export function CardImage({
  src,
  alt,
  className = '',
}: {
  src: string | null
  alt: string
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // A new src is a new load; without this the skeleton never returns.
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])

  return (
    <div
      className={`relative aspect-[5/7] overflow-hidden rounded-xl ${loaded ? '' : 'skeleton'} ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full object-contain transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          draggable={false}
        />
      ) : null}
      {failed || !src ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted">
          {src ? 'Image failed to load' : 'No image available'}
        </div>
      ) : null}
    </div>
  )
}
