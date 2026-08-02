/** All cards with their grades.
 *
 *  Defaults to the session's grading order so the results read in the same
 *  sequence the cards were graded in. Three layouts: a dense table, a card
 *  gallery showing image and grade, and a gallery that adds the rules text.
 */

import { useMemo, useState } from 'react'
import { CardImage } from '../components/CardView'
import { GradeBadge } from '../components/GradeScale'
import { Button, Input, Notice, Panel, SegmentedControl, Select } from '../components/ui'
import { combine, isContentious, type Combined } from '../domain/grades'
import { orderCards, RARITY_LABELS } from '../domain/ordering'
import { BUCKET_LABELS, type CardRecord, type Grade } from '../domain/types'
import { gradeKey, useSession } from '../store/session'
import {
  download,
  safeFilename,
  toCsv,
  toJson,
  toPrintableHtml,
  type ExportInput,
} from '../export/exporters'

/** 'grading' means whatever order the session is set to grade in. */
type SortKey = 'grading' | 'name' | 'grade' | 'rarity' | 'colour' | 'spread' | 'setNumber'
type Layout = 'table' | 'cards' | 'cards-text' | 'notes'
type GraderView = 'combined' | 'both' | 'graders'

interface Row {
  card: CardRecord
  all: (Grade | null)[]
  main: Combined
  ba: Combined
  baVotes: number
}

const SORT_LABELS: Record<SortKey, string> = {
  grading: 'Grading order',
  name: 'Name',
  setNumber: 'Set number',
  grade: 'Combined grade',
  spread: 'Disagreement',
  colour: 'Colour',
  rarity: 'Rarity',
}

export function ResultsScreen() {
  const meta = useSession((s) => s.meta)
  const cards = useSession((s) => s.cards)
  const graders = useSession((s) => s.graders)
  const grades = useSession((s) => s.grades)

  const [sort, setSort] = useState<SortKey>('grading')
  const [asc, setAsc] = useState(true)
  const [layout, setLayout] = useState<Layout>('table')
  const [graderView, setGraderView] = useState<GraderView>('combined')
  const [section, setSection] = useState('all')
  const [onlyGraded, setOnlyGraded] = useState(false)
  const [query, setQuery] = useState('')

  const rows = useMemo<Row[]>(() => {
    if (!meta) return []

    // Start from the shared grading order so 'grading' needs no extra work and
    // every other sort is applied on top of a stable, meaningful base.
    const ordered = orderCards(cards, meta.settings)
    const gradingRank = new Map(ordered.map((c, i) => [c.id, i]))

    const built = ordered.map((card): Row => {
      const all = graders.map((g) => grades[gradeKey(g.id, card.id)] ?? null)
      const main = combine(all.map((g) => g?.grade ?? null))
      const flagged = all.filter((g) => g?.isBuildaround)
      return {
        card,
        all,
        main,
        ba: combine(flagged.map((g) => g?.buildaroundGrade ?? null)),
        baVotes: flagged.length,
      }
    })

    // Matches name, type line and rules text, so "flying" or "Equipment"
    // work as well as a card name.
    const q = query.trim().toLowerCase()
    const filtered = built
      .filter((r) => section === 'all' || r.card.section === section)
      .filter((r) => !onlyGraded || r.main.count > 0)
      .filter((r) => {
        if (!q) return true
        const c = r.card
        return (
          c.name.toLowerCase().includes(q) ||
          c.typeLine.toLowerCase().includes(q) ||
          c.faces.some(
            (f) =>
              f.name.toLowerCase().includes(q) ||
              f.typeLine.toLowerCase().includes(q) ||
              (f.oracleText ?? '').toLowerCase().includes(q),
          )
        )
      })

    const dir = asc ? 1 : -1
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'grading':
          return ((gradingRank.get(a.card.id) ?? 0) - (gradingRank.get(b.card.id) ?? 0)) * dir
        case 'setNumber':
          return (a.card.collectorSort - b.card.collectorSort) * dir
        case 'grade':
          // Ungraded sorts last in both directions rather than posing as F.
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
  }, [meta, cards, graders, grades, sort, asc, section, onlyGraded, query])

  if (!meta) return null

  const exportInput: ExportInput = { meta, cards, graders, grades }
  const base = safeFilename(`${meta.setCode}-${meta.name}`)
  const gradedTotal = cards.filter((c) =>
    graders.some((g) => grades[gradeKey(g.id, c.id)]?.grade),
  ).length
  const sections = ['all', ...new Set(cards.map((c) => c.section))]

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted">
        {gradedTotal} of {cards.length} cards have at least one grade.
        {query.trim() ? ` Showing ${rows.length} matching "${query.trim()}".` : ''}
      </div>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <SegmentedControl
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'table', label: 'Table' },
              { value: 'cards', label: 'Cards' },
              { value: 'cards-text', label: 'Cards and text' },
              { value: 'notes', label: 'Notes' },
            ]}
          />

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
              Search
            </span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, type or rules text"
              className="sm:w-64"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
              Sort
            </span>
            <div className="flex gap-2">
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {Object.entries(SORT_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <Button onClick={() => setAsc((a) => !a)} title="Reverse sort direction">
                {asc ? 'Ascending' : 'Descending'}
              </Button>
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
              Section
            </span>
            <Select value={section} onChange={(e) => setSection(e.target.value)}>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All' : s === 'main' ? 'Main set' : s.toUpperCase()}
                </option>
              ))}
            </Select>
          </label>

          {layout === 'table' ? (
            <SegmentedControl
              label="Grades"
              value={graderView}
              onChange={setGraderView}
              options={[
                { value: 'combined', label: 'Combined' },
                { value: 'both', label: 'Both' },
                { value: 'graders', label: 'Per grader' },
              ]}
            />
          ) : null}

          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={onlyGraded}
              onChange={(e) => setOnlyGraded(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Graded only
          </label>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-edge pt-4">
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
          <Button onClick={() => download(`${base}.json`, toJson(exportInput), 'application/json')}>
            Export JSON
          </Button>
        </div>
      </Panel>

      {rows.length === 0 ? (
        <Notice>No cards match the current filters.</Notice>
      ) : layout === 'table' ? (
        <ResultsTable rows={rows} graderView={graderView} />
      ) : layout === 'notes' ? (
        <NotesView rows={rows} />
      ) : (
        <CardGallery rows={rows} withText={layout === 'cards-text'} />
      )}
    </div>
  )
}

/** Card list on the left, that card's notes from every grader on the right.
 *
 *  Overflow is handled by giving each column its own scroll container sized to
 *  the viewport, so the page itself never scrolls and the two sides move
 *  independently. Long notes wrap rather than truncate: a note you cannot read
 *  in full is worthless, and `break-words` stops an unbroken string from
 *  forcing the column wider than its track. */
function NotesView({ rows }: { rows: Row[] }) {
  const graders = useSession((s) => s.graders)
  const grades = useSession((s) => s.grades)

  const notesFor = (cardId: string) =>
    graders
      .map((g) => ({ grader: g, entry: grades[gradeKey(g.id, cardId)] ?? null }))
      .filter((x) => (x.entry?.notes ?? '').trim().length > 0)

  const withAny = rows.filter((r) => notesFor(r.card.id).length > 0)

  if (withAny.length === 0) {
    return <Notice>No notes yet. Notes written while grading show up here.</Notice>
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted">
        {withAny.length} {withAny.length === 1 ? 'card has' : 'cards have'} notes.
      </div>

      {/* One full-width row per card. The page scrolls rather than a nested
          container: nested scroll regions are awkward on touch, and the image
          is the content here so it gets real size at the cost of scrolling. */}
      <ul className="space-y-4">
        {withAny.map(({ card, main }) => (
          <li
            key={card.id}
            className="flex flex-col gap-5 rounded-lg border border-edge bg-panel p-4 transition-colors hover:border-edge-strong sm:flex-row"
          >
            <div className="w-full max-w-[18rem] shrink-0 self-center sm:w-64 sm:self-start lg:w-80">
              <CardImage src={card.faces[0]?.imageNormal ?? null} alt={card.name} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge pb-3">
                <div className="min-w-0">
                  <h3 className="break-words text-xl font-medium">{card.name}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {card.faces[0]?.typeLine}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {BUCKET_LABELS[card.bucket] ?? card.bucket} ·{' '}
                    {RARITY_LABELS[card.rarity] ?? card.rarity} · {card.set.toUpperCase()}{' '}
                    {card.collectorNumber}
                    {card.section !== 'main' ? ` · ${card.section.toUpperCase()}` : ''}
                  </p>
                </div>
                <GradeBadge grade={main.letter} size="large" />
              </div>

              <ul className="mt-4 space-y-4">
                {notesFor(card.id).map(({ grader, entry }) => (
                  <li key={grader.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{grader.name}</span>
                      <span className="rounded border border-edge bg-raised px-2 py-0.5 font-mono text-sm text-muted">
                        {entry?.grade ?? '—'}
                      </span>
                      {entry?.isBuildaround ? (
                        <span className="rounded border border-warn/50 px-2 py-0.5 text-xs text-warn">
                          Build-around {entry.buildaroundGrade ?? '—'}
                        </span>
                      ) : null}
                    </div>
                    {/* whitespace-pre-wrap keeps the grader's line breaks;
                        break-words stops one long token widening the row.
                        The row spans the screen but the text does not: past
                        roughly 75 characters a line becomes hard to track. */}
                    <p className="mt-1.5 max-w-[75ch] whitespace-pre-wrap break-words leading-relaxed text-muted">
                      {entry?.notes}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CardGallery({ rows, withText }: { rows: Row[]; withText: boolean }) {
  const graders = useSession((s) => s.graders)

  return (
    <div
      className={
        withText
          ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
          : 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
      }
    >
      {rows.map(({ card, all, main, ba, baVotes }) => (
        <div
          key={card.id}
          className={
            'rounded-lg border border-edge bg-panel p-3 transition-colors hover:border-edge-strong ' +
            (withText ? 'flex flex-col gap-3 sm:flex-row' : '')
          }
        >
          <div className={withText ? 'w-full max-w-[12rem] self-center sm:w-32 sm:self-start' : ''}>
            <CardImage src={card.faces[0]?.imageNormal ?? null} alt={card.name} />
          </div>

          <div className={withText ? 'min-w-0 flex-1' : 'mt-2'}>
            <div className={withText ? 'flex items-start justify-between gap-2' : 'flex items-center justify-between gap-2'}>
              <span className="min-w-0 truncate text-sm" title={card.name}>
                {card.name}
              </span>
              <GradeBadge grade={main.letter} size={withText ? 'normal' : 'large'} />
            </div>

            <div className="mt-1 text-xs text-muted">
              {BUCKET_LABELS[card.bucket] ?? card.bucket} ·{' '}
              {RARITY_LABELS[card.rarity] ?? card.rarity} · {card.collectorNumber}
            </div>

            {baVotes > 0 ? (
              <div className="mt-1 text-xs text-warn">
                Build-around {ba.letter ?? '—'} ({baVotes}/{graders.length})
              </div>
            ) : null}

            {isContentious(main) ? (
              <div className="mt-1 text-xs text-warn">Disagreement: {main.spread} steps</div>
            ) : null}

            {withText ? (
              <div className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
                <div className="text-text">{card.faces[0]?.typeLine}</div>
                {(card.faces[0]?.oracleText ?? '').split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
                {card.faces.length > 1
                  ? card.faces.slice(1).map((f, i) => (
                      <div key={i} className="border-t border-edge pt-1">
                        <div className="text-text">{f.name}</div>
                        <div>{f.oracleText}</div>
                      </div>
                    ))
                  : null}
              </div>
            ) : null}

            {graders.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {all.map((g, i) =>
                  g?.grade ? (
                    <span
                      key={graders[i].id}
                      className="rounded border border-edge bg-raised px-1.5 py-0.5 font-mono text-xs text-muted"
                      title={graders[i].name}
                    >
                      {graders[i].name.slice(0, 1)} {g.grade}
                    </span>
                  ) : null,
                )}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function ResultsTable({ rows, graderView }: { rows: Row[]; graderView: GraderView }) {
  const graders = useSession((s) => s.graders)

  return (
    <div className="overflow-x-auto rounded-lg border border-edge">
      <table className="w-full min-w-max text-sm">
        <thead className="bg-panel text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Card</th>
            <th className="px-3 py-2 font-medium">Colour</th>
            <th className="px-3 py-2 font-medium">Rarity</th>
            <th className="px-3 py-2 font-medium">No.</th>
            {graderView !== 'graders' ? (
              <>
                <th className="px-3 py-2 font-medium">Combined</th>
                <th className="px-3 py-2 font-medium">Spread</th>
              </>
            ) : null}
            {graderView !== 'combined'
              ? graders.map((g) => (
                  <th key={g.id} className="px-3 py-2 font-medium">
                    {g.name}
                  </th>
                ))
              : null}
            <th className="px-3 py-2 font-medium">Build-around</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, all, main, ba, baVotes }) => (
            <tr
              key={card.id}
              className="border-t border-edge align-top transition-colors hover:bg-panel"
            >
              <td className="px-3 py-2">
                <div>{card.name}</div>
                {card.section !== 'main' ? (
                  <div className="text-xs text-muted">{card.section.toUpperCase()}</div>
                ) : null}
                <Notes cardId={card.id} />
              </td>
              <td className="px-3 py-2 text-muted">{BUCKET_LABELS[card.bucket] ?? card.bucket}</td>
              <td className="px-3 py-2 text-muted">{RARITY_LABELS[card.rarity] ?? card.rarity}</td>
              <td className="px-3 py-2 font-mono text-muted">{card.collectorNumber}</td>
              {graderView !== 'graders' ? (
                <>
                  <td className="px-3 py-2">
                    <GradeBadge grade={main.letter} />
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {main.count > 1 ? (
                      <span className={isContentious(main) ? 'font-semibold text-warn' : ''}>
                        {main.spread}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </>
              ) : null}
              {graderView !== 'combined'
                ? all.map((g, i) => (
                    <td key={graders[i].id} className="px-3 py-2 font-mono">
                      {g?.grade ?? <span className="text-muted">—</span>}
                    </td>
                  ))
                : null}
              <td className="px-3 py-2 font-mono">
                {baVotes > 0 ? (
                  <span>
                    {ba.letter ?? '—'}
                    <span className="ml-2 text-xs text-muted">
                      {baVotes}/{graders.length}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
      <summary className="cursor-pointer text-xs text-muted hover:text-text">
        Notes ({withNotes.length})
      </summary>
      <ul className="mt-1 space-y-1 text-xs text-muted">
        {withNotes.map(({ g, note }) => (
          <li key={g.id}>
            <span className="text-text">{g.name}:</span> {note}
          </li>
        ))}
      </ul>
    </details>
  )
}
