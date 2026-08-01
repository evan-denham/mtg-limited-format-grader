/** All cards with their grades. Combined by default. */

import { useMemo, useState } from 'react'
import { Button, Notice, Panel } from '../components/ui'
import { combine, isContentious } from '../domain/grades'
import { RARITY_LABELS } from '../domain/ordering'
import { BUCKET_LABELS, type CardRecord } from '../domain/types'
import { gradeKey, useSession } from '../store/session'
import {
  download,
  safeFilename,
  toCsv,
  toJson,
  toPrintableHtml,
  type ExportInput,
} from '../export/exporters'

type SortKey = 'name' | 'grade' | 'rarity' | 'colour' | 'spread'
type View = 'combined' | 'both' | 'graders'

export function ResultsScreen() {
  const meta = useSession((s) => s.meta)
  const cards = useSession((s) => s.cards)
  const graders = useSession((s) => s.graders)
  const grades = useSession((s) => s.grades)

  const [sort, setSort] = useState<SortKey>('name')
  const [asc, setAsc] = useState(true)
  const [view, setView] = useState<View>('combined')
  const [section, setSection] = useState<string>('all')
  const [onlyGraded, setOnlyGraded] = useState(false)

  const rows = useMemo(() => {
    const built = cards.map((card) => {
      const all = graders.map((g) => grades[gradeKey(g.id, card.id)] ?? null)
      const main = combine(all.map((g) => g?.grade ?? null))
      const baVotes = all.filter((g) => g?.isBuildaround).length
      const ba = combine(
        all.filter((g) => g?.isBuildaround).map((g) => g?.buildaroundGrade ?? null),
      )
      return { card, all, main, ba, baVotes }
    })

    const filtered = built
      .filter((r) => section === 'all' || r.card.section === section)
      .filter((r) => !onlyGraded || r.main.count > 0)

    const dir = asc ? 1 : -1
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'grade':
          // Ungraded sorts last in both directions rather than pretending to be F.
          if (a.main.mean == null && b.main.mean == null) return 0
          if (a.main.mean == null) return 1
          if (b.main.mean == null) return -1
          return (a.main.mean - b.main.mean) * dir
        case 'spread':
          return (a.main.spread - b.main.spread) * dir
        case 'rarity':
          return a.card.rarity.localeCompare(b.card.rarity) * dir
        case 'colour':
          return a.card.bucket.localeCompare(b.card.bucket) * dir
        default:
          return a.card.name.localeCompare(b.card.name) * dir
      }
    })
  }, [cards, graders, grades, sort, asc, section, onlyGraded])

  if (!meta) return null

  const exportInput: ExportInput = { meta, cards, graders, grades }
  const base = safeFilename(`${meta.setCode}-${meta.name}`)
  const gradedTotal = cards.filter((c) =>
    graders.some((g) => grades[gradeKey(g.id, c.id)]?.grade),
  ).length

  const sections = ['all', ...new Set(cards.map((c) => c.section))]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[--color-muted]">
          {gradedTotal} of {cards.length} cards have at least one grade.
        </span>
      </div>

      <Panel className="flex flex-wrap items-end gap-3">
        <Select label="View" value={view} onChange={(v) => setView(v as View)}>
          <option value="combined">Combined</option>
          <option value="both">Combined and graders</option>
          <option value="graders">Graders only</option>
        </Select>

        <Select label="Section" value={section} onChange={setSection}>
          {sections.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All' : s === 'main' ? 'Main set' : s.toUpperCase()}
            </option>
          ))}
        </Select>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={onlyGraded}
            onChange={(e) => setOnlyGraded(e.target.checked)}
            className="h-4 w-4 accent-[--color-accent]"
          />
          Graded only
        </label>

        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => download(`${base}.csv`, toCsv(exportInput), 'text/csv')}>
            Export CSV
          </Button>
          <Button
            onClick={() =>
              download(`${base}-cards.html`, toPrintableHtml(exportInput), 'text/html')
            }
          >
            Export card sheet
          </Button>
          <Button
            onClick={() => download(`${base}.json`, toJson(exportInput), 'application/json')}
          >
            Export JSON
          </Button>
        </div>
      </Panel>

      {cards.length === 0 ? <Notice>No cards in this session.</Notice> : null}

      <div className="overflow-x-auto rounded border border-[--color-edge]">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-[--color-panel] text-left text-xs uppercase tracking-wide text-[--color-muted]">
            <tr>
              <Th onClick={() => toggle('name')} active={sort === 'name'} asc={asc}>
                Card
              </Th>
              <Th onClick={() => toggle('colour')} active={sort === 'colour'} asc={asc}>
                Colour
              </Th>
              <Th onClick={() => toggle('rarity')} active={sort === 'rarity'} asc={asc}>
                Rarity
              </Th>
              {view !== 'graders' ? (
                <>
                  <Th onClick={() => toggle('grade')} active={sort === 'grade'} asc={asc}>
                    Combined
                  </Th>
                  <Th onClick={() => toggle('spread')} active={sort === 'spread'} asc={asc}>
                    Spread
                  </Th>
                </>
              ) : null}
              {view !== 'combined'
                ? graders.map((g) => (
                    <th key={g.id} className="px-3 py-2 font-normal">
                      {g.name}
                    </th>
                  ))
                : null}
              <th className="px-3 py-2 font-normal">Build-around</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ card, all, main, ba, baVotes }) => (
              <tr key={card.id} className="border-t border-[--color-edge] align-top">
                <td className="px-3 py-2">
                  <div>{card.name}</div>
                  {card.section !== 'main' ? (
                    <div className="text-xs text-[--color-muted]">
                      {card.section.toUpperCase()}
                    </div>
                  ) : null}
                  <Notes cardId={card.id} />
                </td>
                <td className="px-3 py-2 text-[--color-muted]">
                  {BUCKET_LABELS[card.bucket] ?? card.bucket}
                </td>
                <td className="px-3 py-2 text-[--color-muted]">
                  {RARITY_LABELS[card.rarity] ?? card.rarity}
                </td>
                {view !== 'graders' ? (
                  <>
                    <td className="px-3 py-2 font-mono">
                      {main.letter ?? '—'}
                      {main.mean != null ? (
                        <span className="ml-2 text-xs text-[--color-muted]">
                          {main.mean.toFixed(2)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {main.count > 1 ? (
                        <span className={isContentious(main) ? 'text-[#d8bd82]' : ''}>
                          {main.spread}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </>
                ) : null}
                {view !== 'combined'
                  ? all.map((g, i) => (
                      <td key={graders[i].id} className="px-3 py-2 font-mono">
                        {g?.grade ?? '—'}
                      </td>
                    ))
                  : null}
                <td className="px-3 py-2 font-mono">
                  {baVotes > 0 ? (
                    <span>
                      {ba.letter ?? '—'}
                      <span className="ml-2 text-xs text-[--color-muted]">
                        {baVotes}/{graders.length}
                      </span>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  function toggle(k: SortKey) {
    if (sort === k) setAsc((a) => !a)
    else {
      setSort(k)
      setAsc(true)
    }
  }
}

function Notes({ cardId }: { cardId: string }) {
  const graders = useSession((s) => s.graders)
  const grades = useSession((s) => s.grades)
  const withNotes = graders
    .map((g) => ({ g, note: grades[gradeKey(g.id, cardId)]?.notes ?? '' }))
    .filter((x) => x.note.trim())

  if (withNotes.length === 0) return null
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-[--color-muted]">
        Notes ({withNotes.length})
      </summary>
      <ul className="mt-1 space-y-1 text-xs text-[--color-muted]">
        {withNotes.map(({ g, note }) => (
          <li key={g.id}>
            <span className="text-[--color-text]">{g.name}:</span> {note}
          </li>
        ))}
      </ul>
    </details>
  )
}

function Th({
  children,
  onClick,
  active,
  asc,
}: {
  children: React.ReactNode
  onClick: () => void
  active: boolean
  asc: boolean
}) {
  return (
    <th className="px-3 py-2 font-normal">
      <button onClick={onClick} className="hover:text-[--color-text]">
        {children}
        {active ? <span className="ml-1">{asc ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  )
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-[--color-muted]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-[--color-edge] bg-[--color-ink] px-2 py-2 text-sm"
      >
        {children}
      </select>
    </label>
  )
}

export type { CardRecord }
