/** The grading loop.
 *
 *  Navigation rule: Previous is always available. Next is withheld until this
 *  grader has assigned a grade to the current card, so the set cannot be
 *  skimmed past by accident. Once graded, Next stays available on revisit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CardView } from '../components/CardView'
import { GradeScale } from '../components/GradeScale'
import { Button, Input, Notice, Panel } from '../components/ui'
import { applyModifier, type GradeLetter } from '../domain/grades'
import { gradeKey, useOrderedCards, useSession } from '../store/session'
import type { CardRecord } from '../domain/types'

const NOTES_DEBOUNCE_MS = 400

export function GradeScreen() {
  const cards = useOrderedCards()
  const meta = useSession((s) => s.meta)
  const meId = useSession((s) => s.meId)
  const graders = useSession((s) => s.graders)
  const grades = useSession((s) => s.grades)
  const setGrade = useSession((s) => s.setGrade)
  const setPosition = useSession((s) => s.setPosition)
  const setFollow = useSession((s) => s.setFollow)

  const me = graders.find((g) => g.id === meId) ?? null

  // Position is a card id, so changing the sort order keeps you on the same
  // card instead of teleporting you to whatever now sits at that index.
  const currentIndex = useMemo(() => {
    const idx = cards.findIndex((c) => c.id === me?.currentCardId)
    return idx === -1 ? 0 : idx
  }, [cards, me?.currentCardId])

  const card = cards[currentIndex] ?? null
  const myGrade = card && meId ? (grades[gradeKey(meId, card.id)] ?? null) : null

  const go = useCallback(
    (delta: number) => {
      const next = currentIndex + delta
      if (next < 0 || next >= cards.length) return
      // Manual navigation releases follow, otherwise you snap straight back.
      if (me?.followId) setFollow(null)
      setPosition(cards[next].id)
    },
    [cards, currentIndex, me?.followId, setFollow, setPosition],
  )

  // Follow: mirror the target's position. Grades still write to your own row.
  const followTarget = graders.find((g) => g.id === me?.followId) ?? null
  useEffect(() => {
    if (!followTarget?.currentCardId) return
    if (followTarget.currentCardId === me?.currentCardId) return
    setPosition(followTarget.currentCardId)
  }, [followTarget?.currentCardId, me?.currentCardId, setPosition])

  const hasGrade = Boolean(myGrade?.grade)
  const canAdvance = hasGrade && currentIndex < cards.length - 1

  const gradedCount = useMemo(() => {
    if (!meId) return 0
    return cards.reduce((n, c) => n + (grades[gradeKey(meId, c.id)]?.grade ? 1 : 0), 0)
  }, [cards, grades, meId])

  const swipeHandlers = useSwipe({
    onLeft: () => canAdvance && go(1),
    onRight: () => go(-1),
  })

  useKeyboardGrading({
    enabled: Boolean(card && meId),
    onGrade: (g) => card && setGrade(card.id, { grade: g }),
    onPrev: () => go(-1),
    onNext: () => canAdvance && go(1),
    current: myGrade?.grade ?? null,
  })

  if (!meta) return null
  if (cards.length === 0) {
    return <Notice tone="warn">This session has no cards. Check the set code in Settings.</Notice>
  }
  if (!meId) {
    return <Notice tone="warn">Pick which grader you are before grading.</Notice>
  }
  if (!card) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted">
          Card {currentIndex + 1} of {cards.length}. Graded {gradedCount}.
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <CardSearch cards={cards} onPick={(cardId) => setPosition(cardId)} />
        {graders.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Follow</span>
            <select
              value={me?.followId ?? ''}
              onChange={(e) => setFollow(e.target.value || null)}
              className="rounded border border-edge bg-ink px-2 py-1 text-base sm:text-sm"
            >
              <option value="">Nobody</option>
              {graders
                .filter((g) => g.id !== meId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        </div>
      </div>

      {followTarget ? (
        <Notice>
          Following {followTarget.name}. Grading a card or moving manually stops following.
        </Notice>
      ) : null}

      {/* Swipe changes cards on touch devices. Next still respects the rule
          that an ungraded card cannot be skipped past. */}
      <div {...swipeHandlers}>
        <CardView card={card} display={meta.settings.cardDisplay} />
      </div>

      <Panel className="space-y-5">
        <div className="space-y-3 border-b border-edge pb-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={myGrade?.isBuildaround ?? false}
              onChange={(e) => setGrade(card.id, { isBuildaround: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            Build-around card
          </label>

          {myGrade?.isBuildaround ? (
            <GradeScale
              label="Build-around grade"
              size="small"
              value={myGrade?.buildaroundGrade ?? null}
              onChange={(g) => setGrade(card.id, { buildaroundGrade: g })}
            />
          ) : null}
        </div>

        <NotesBox
          key={`${card.id}:${meId}`}
          value={myGrade?.notes ?? ''}
          onCommit={(notes) => setGrade(card.id, { notes })}
        />
      </Panel>

      {/* Spacer so the sticky bar never covers the last of the page content. */}
      <div className="h-4" aria-hidden />

      {/* The grade scale and navigation stick to the bottom of the viewport.
          On a phone a card is roughly two screens tall, so without this you
          scroll down to grade, then further to advance, on every one of a few
          hundred cards. `sticky` rather than `fixed` keeps it in flow, so it
          cannot overlap content or fight the on-screen keyboard. */}
      <div className="sticky bottom-0 -mx-4 border-t border-edge bg-panel/95 px-4 py-3 backdrop-blur">
        <GradeScale
          label="Grade"
          value={myGrade?.grade ?? null}
          onChange={(g) => setGrade(card.id, { grade: g })}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <Button onClick={() => go(-1)} disabled={currentIndex === 0}>
            Previous
          </Button>

          <div className="text-center text-xs text-muted">
            {hasGrade ? null : 'Assign a grade to continue.'}
          </div>

          {canAdvance ? (
            <Button variant="primary" onClick={() => go(1)}>
              Next
            </Button>
          ) : hasGrade && currentIndex === cards.length - 1 ? (
            <span className="text-sm text-muted">Last card.</span>
          ) : (
            // Reserve the slot so the layout does not jump when Next appears.
            <span className="invisible">
              <Button>Next</Button>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Horizontal swipe to change cards.
 *
 *  Deliberately ignores gestures that are mostly vertical, so scrolling the
 *  page never fires a navigation, and gestures that involve more than one
 *  finger, which are pinch-zoom on a card image.
 */
const SWIPE_MIN_PX = 60
const SWIPE_MAX_OFF_AXIS_RATIO = 0.6

function useSwipe({ onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null)

  return {
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) {
        start.current = null
        return
      }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const from = start.current
      start.current = null
      if (!from || e.changedTouches.length !== 1) return

      const dx = e.changedTouches[0].clientX - from.x
      const dy = e.changedTouches[0].clientY - from.y
      if (Math.abs(dx) < SWIPE_MIN_PX) return
      if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_OFF_AXIS_RATIO) return

      // Swiping left moves forward, matching how carousels read.
      if (dx < 0) onLeft()
      else onRight()
    },
  }
}

/** Jump straight to a card by name, for when you know what you want to revisit
 *  rather than stepping through the queue. */
function CardSearch({
  cards,
  onPick,
}: {
  cards: CardRecord[]
  onPick: (cardId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return cards
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.faces.some((f) => f.typeLine.toLowerCase().includes(q)),
      )
      .slice(0, 12)
  }, [cards, query])

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // Blur is delayed so a click on a result registers before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search cards"
        aria-label="Search cards"
        className="sm:w-64"
      />
      {open && matches.length > 0 ? (
        <ul className="absolute right-0 z-20 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded border border-edge bg-panel shadow-lg">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  onPick(c.id)
                  setQuery('')
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-raised"
              >
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {c.collectorNumber}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Notes are debounced so a full sentence is one write, not one per keystroke. */
function NotesBox({
  value,
  onCommit,
}: {
  value: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(value)

  useEffect(() => {
    setDraft(value)
    latest.current = value
  }, [value])

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current)
    }
  }, [])

  const onChange = (v: string) => {
    setDraft(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (v !== latest.current) {
        latest.current = v
        onCommit(v)
      }
    }, NOTES_DEBOUNCE_MS)
  }

  // Flush on blur so a note is never lost by navigating within the debounce.
  const onBlur = () => {
    window.clearTimeout(timer.current)
    if (draft !== latest.current) {
      latest.current = draft
      onCommit(draft)
    }
  }

  return (
    <div className="border-t border-edge pt-4">
      <div className="mb-1.5 text-xs uppercase tracking-wide text-muted">
        Notes
      </div>
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={3}
        placeholder="Your notes on this card."
        className="w-full resize-y rounded border border-edge bg-ink px-3 py-2 text-base placeholder:text-muted sm:text-sm"
      />
    </div>
  )
}

/** F/D/C/B/A set the base grade, - and + adjust it, arrows navigate.
 *  Disabled while typing in a field, or notes would trigger grades. */
function useKeyboardGrading({
  enabled,
  onGrade,
  onPrev,
  onNext,
  current,
}: {
  enabled: boolean
  onGrade: (g: GradeLetter) => void
  onPrev: () => void
  onNext: () => void
  current: GradeLetter | null
}) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key.toLowerCase()
      if (['f', 'd', 'c', 'b', 'a'].includes(key)) {
        e.preventDefault()
        onGrade(applyModifier(key.toUpperCase() as 'F' | 'D' | 'C' | 'B' | 'A', ''))
        return
      }
      if ((e.key === '-' || e.key === '+' || e.key === '=') && current) {
        e.preventDefault()
        const base = current[0] as 'F' | 'D' | 'C' | 'B' | 'A'
        onGrade(applyModifier(base, e.key === '-' ? '-' : '+'))
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrev()
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, onGrade, onPrev, onNext, current])
}
