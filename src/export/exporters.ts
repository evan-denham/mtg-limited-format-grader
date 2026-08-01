/** CSV, print-ready HTML and JSON exports. */

import { combine } from '../domain/grades'
import { RARITY_LABELS } from '../domain/ordering'
import { BUCKET_LABELS, type CardRecord, type Grade, type Grader, type SessionMeta } from '../domain/types'

export interface ExportInput {
  meta: SessionMeta
  cards: CardRecord[]
  graders: Grader[]
  grades: Record<string, Grade>
}

const key = (graderId: string, cardId: string) => `${graderId}:${cardId}`

function gradesFor(input: ExportInput, cardId: string): (Grade | null)[] {
  return input.graders.map((g) => input.grades[key(g.id, cardId)] ?? null)
}

/** RFC 4180: wrap in quotes and double any embedded quote. Notes routinely
 *  contain commas and newlines, so this cannot be skipped. */
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(input: ExportInput): string {
  const { cards, graders } = input
  const header = [
    'Name',
    'Section',
    'Set',
    'Collector number',
    'Rarity',
    'Colour',
    'Mana value',
    'Type',
    'Combined grade',
    'Combined numeric',
    'Spread',
    'Build-around votes',
    'Combined build-around',
    ...graders.flatMap((g) => [
      `${g.name} grade`,
      `${g.name} build-around`,
      `${g.name} build-around grade`,
      `${g.name} notes`,
    ]),
  ]

  const rows = cards.map((card) => {
    const all = gradesFor(input, card.id)
    const main = combine(all.map((g) => g?.grade ?? null))
    const baVotes = all.filter((g) => g?.isBuildaround).length
    const ba = combine(all.filter((g) => g?.isBuildaround).map((g) => g?.buildaroundGrade ?? null))

    return [
      card.name,
      card.section === 'main' ? 'Main set' : card.section.toUpperCase(),
      card.set.toUpperCase(),
      card.collectorNumber,
      RARITY_LABELS[card.rarity] ?? card.rarity,
      BUCKET_LABELS[card.bucket] ?? card.bucket,
      card.cmc,
      card.typeLine,
      main.letter ?? '',
      main.mean != null ? main.mean.toFixed(2) : '',
      main.count > 1 ? main.spread : '',
      baVotes || '',
      ba.letter ?? '',
      ...all.flatMap((g) => [
        g?.grade ?? '',
        g?.isBuildaround ? 'yes' : '',
        g?.buildaroundGrade ?? '',
        g?.notes ?? '',
      ]),
    ].map(csvCell)
  })

  return [header.map(csvCell), ...rows].map((r) => r.join(',')).join('\r\n')
}

export function toJson(input: ExportInput): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      session: input.meta,
      graders: input.graders,
      cards: input.cards,
      grades: Object.values(input.grades),
    },
    null,
    2,
  )
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )

/** Self-contained HTML: a grid of card images with grades beneath, styled for
 *  printing. Images are Scryfall CDN URLs, so the file stays small but needs
 *  a connection the first time it is opened. */
export function toPrintableHtml(input: ExportInput): string {
  const { meta, cards, graders } = input

  const sections = new Map<string, CardRecord[]>()
  for (const c of cards) {
    const list = sections.get(c.section) ?? []
    list.push(c)
    sections.set(c.section, list)
  }

  const cardHtml = (card: CardRecord): string => {
    const all = gradesFor(input, card.id)
    const main = combine(all.map((g) => g?.grade ?? null))
    const baVotes = all.filter((g) => g?.isBuildaround).length
    const ba = combine(all.filter((g) => g?.isBuildaround).map((g) => g?.buildaroundGrade ?? null))
    const img = card.faces[0]?.imageNormal ?? ''

    const perGrader = graders
      .map((g, i) => {
        const entry = all[i]
        if (!entry?.grade) return ''
        return `<li><span>${escapeHtml(g.name)}</span><b>${entry.grade}</b></li>`
      })
      .join('')

    return `<figure class="card">
  ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(card.name)}" loading="lazy">` : '<div class="noimg">No image</div>'}
  <figcaption>
    <div class="grade">${main.letter ?? '—'}</div>
    <div class="name">${escapeHtml(card.name)}</div>
    ${baVotes ? `<div class="ba">Build-around ${ba.letter ?? '—'} (${baVotes}/${graders.length})</div>` : ''}
    ${perGrader ? `<ul class="graders">${perGrader}</ul>` : ''}
  </figcaption>
</figure>`
  }

  const sectionHtml = [...sections.entries()]
    .map(
      ([code, list]) => `<section>
  <h2>${code === 'main' ? 'Main set' : escapeHtml(code.toUpperCase())} (${list.length})</h2>
  <div class="grid">${list.map(cardHtml).join('\n')}</div>
</section>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.name)} - grades</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 24px; color: #111; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 15px; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #ddd; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 18px; }
  .card { margin: 0; break-inside: avoid; page-break-inside: avoid; }
  .card img { width: 100%; border-radius: 4.75% / 3.5%; display: block; }
  .noimg { aspect-ratio: 5/7; display: grid; place-items: center; background: #eee; font-size: 12px; color: #888; }
  figcaption { text-align: center; margin-top: 6px; }
  .grade { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .name { font-size: 11px; color: #444; margin-top: 2px; }
  .ba { font-size: 10px; color: #7a5a12; margin-top: 3px; }
  .graders { list-style: none; padding: 0; margin: 5px 0 0; font-size: 10px; color: #666; }
  .graders li { display: flex; justify-content: space-between; padding: 0 6px; }
  @media print {
    body { margin: 10mm; }
    .grid { grid-template-columns: repeat(4, 1fr); gap: 10px; }
    h2 { break-after: avoid; page-break-after: avoid; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(meta.name)}</h1>
<div class="meta">
  ${escapeHtml(meta.setName)} (${escapeHtml(meta.setCode.toUpperCase())}).
  ${cards.length} cards. Graders: ${graders.map((g) => escapeHtml(g.name)).join(', ')}.
  Exported ${new Date().toISOString().slice(0, 10)}.
</div>
${sectionHtml}
</body>
</html>`
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'grades'
}
