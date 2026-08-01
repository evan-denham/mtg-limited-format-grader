/** Contrast guardrails for the palette.
 *
 *  The first build of this app shipped buttons nobody could see. These tests
 *  make that a failing test rather than a bug report.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read off disk, not via import.meta.glob: Vite routes .css through its style
// pipeline, so a ?raw glob comes back empty and every assertion below would
// pass vacuously.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`token --color-${name} not found in index.css`)
  return m[1]
}

describe('palette source', () => {
  it('actually read index.css', () => {
    // Guards against the whole suite passing on an empty string.
    expect(css).toContain('@theme')
    expect(css.length).toBeGreaterThan(500)
  })
})

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const AA_TEXT = 4.5
const AA_UI = 3 // SC 1.4.11, non-text contrast for control boundaries

describe('palette contrast', () => {
  it('body text is readable on every surface', () => {
    for (const surface of ['ink', 'panel', 'raised', 'raised-hover'] as const) {
      expect(
        contrast(token('text'), token(surface)),
        `text on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('muted text stays readable on ink and panel', () => {
    for (const surface of ['ink', 'panel'] as const) {
      expect(
        contrast(token('muted'), token(surface)),
        `muted on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('control borders are visible on both surfaces controls sit on', () => {
    // This is the check the original palette failed: edge was 1.62:1 on panel,
    // so buttons had no perceptible boundary.
    for (const surface of ['ink', 'panel'] as const) {
      expect(
        contrast(token('edge'), token(surface)),
        `edge on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_UI)
    }
  })

  it('hover border is brighter than the resting border', () => {
    expect(luminance(token('edge-strong'))).toBeGreaterThan(luminance(token('edge')))
  })

  it('hover fill is brighter than the resting fill, so hover is perceptible', () => {
    expect(luminance(token('raised-hover'))).toBeGreaterThan(luminance(token('raised')))
  })

  it('black text on the accent fill is readable', () => {
    // Selected grade buttons are black-on-accent.
    expect(contrast('#000000', token('accent'))).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the accent stands out against the surfaces it sits on', () => {
    for (const surface of ['ink', 'panel', 'raised'] as const) {
      expect(
        contrast(token('accent'), token(surface)),
        `accent on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_UI)
    }
  })

  it('warn and danger text is readable on panel', () => {
    for (const t of ['warn', 'danger'] as const) {
      expect(contrast(token(t), token('panel')), `${t} on panel`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })
})

describe('tailwind v4 custom property usage', () => {
  it('never uses the v3 bare-custom-property shorthand', () => {
    // `bg-[--color-panel]` emits `background-color: --color-panel`, which is
    // invalid CSS the browser silently drops. That bug made every button
    // invisible. Use the generated utilities (bg-panel) instead.
    const offenders: string[] = []
    const files = import.meta.glob('./**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' })

    // Without this, a glob that silently matches nothing would make the
    // assertion below pass vacuously and the bug could return unnoticed.
    expect(Object.keys(files).length).toBeGreaterThan(20)

    for (const [path, source] of Object.entries(files)) {
      if (path.endsWith('theme.test.ts')) continue
      const matches = String(source).match(/(?:bg|text|border|ring|fill|stroke|accent)-\[--[a-z-]+\]/g)
      if (matches) offenders.push(`${path}: ${matches.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
