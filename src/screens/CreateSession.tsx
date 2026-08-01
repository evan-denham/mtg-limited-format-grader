/** Session creation: set code, bonus sheets, graders, order. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Field, Input, Notice, Panel, Spinner } from '../components/ui'
import { DEFAULT_SETTINGS, formatColorOrder, parseColorOrder, sectionsInPool } from '../domain/ordering'
import type { BonusSet, CardRecord, GradingSettings, Grader, SessionMeta } from '../domain/types'
import { ScryfallError, type RawSet } from '../scryfall/api'
import { buildPool, detectBonusSheets, validateSet, type BonusRequest, type PoolReport } from '../scryfall/pool'
import { generateSessionCode } from '../supabase/pin'
import { backend } from '../supabase/backend'
import { isBackendConfigured } from '../supabase/client'
import * as local from '../storage/local'
import { navigate } from '../router'
import { useSession } from '../store/session'

interface BonusChoice extends BonusSet {
  selected: boolean
  from: string
  to: string
}

export function CreateSession() {
  const [setCode, setSetCode] = useState('')
  const [setInfo, setSetInfo] = useState<RawSet | null>(null)
  const [checking, setChecking] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)

  const [bonus, setBonus] = useState<BonusChoice[]>([])
  const [manualCode, setManualCode] = useState('')

  const [graderNames, setGraderNames] = useState<string[]>([''])
  const [settings, setSettings] = useState<GradingSettings>(DEFAULT_SETTINGS)
  const [colorText, setColorText] = useState(formatColorOrder(DEFAULT_SETTINGS.colorOrder))

  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState('')
  const [report, setReport] = useState<PoolReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hydrate = useSession((s) => s.hydrate)
  const debounce = useRef<number | undefined>(undefined)

  // Validate the set code as it is typed, and offer its bonus sheets.
  useEffect(() => {
    window.clearTimeout(debounce.current)
    const code = setCode.trim().toLowerCase()
    setSetInfo(null)
    setCodeError(null)
    setBonus([])
    if (code.length < 3) return

    debounce.current = window.setTimeout(async () => {
      setChecking(true)
      try {
        const info = await validateSet(code)
        setSetInfo(info)
        const sheets = await detectBonusSheets(code)
        setBonus(sheets.map((s) => ({ ...s, selected: true, from: '', to: '' })))
      } catch (err) {
        setCodeError(
          err instanceof ScryfallError && err.status === 404
            ? `No set with code "${code}".`
            : err instanceof Error
              ? err.message
              : String(err),
        )
      } finally {
        setChecking(false)
      }
    }, 350)
    return () => window.clearTimeout(debounce.current)
  }, [setCode])

  const addManual = useCallback(async () => {
    const code = manualCode.trim().toLowerCase()
    if (!code || bonus.some((b) => b.code === code)) return
    try {
      const info = await validateSet(code)
      setBonus((b) => [
        ...b,
        { code: info.code, name: info.name, selected: true, from: '', to: '' },
      ])
      setManualCode('')
    } catch {
      setError(`No set with code "${code}".`)
    }
  }, [manualCode, bonus])

  const names = graderNames.map((n) => n.trim()).filter(Boolean)
  const namesUnique = new Set(names.map((n) => n.toLowerCase())).size === names.length
  const canCreate = Boolean(setInfo) && names.length > 0 && namesUnique && !building

  async function create() {
    if (!setInfo) return
    setBuilding(true)
    setError(null)
    setReport(null)
    try {
      const requests: BonusRequest[] = bonus
        .filter((b) => b.selected)
        .map((b) => ({
          code: b.code,
          name: b.name,
          range: {
            from: b.from.trim() ? Number(b.from) : undefined,
            to: b.to.trim() ? Number(b.to) : undefined,
          },
        }))

      const { cards, report } = await buildPool(setInfo.code, {
        bonusSets: requests,
        onProgress: (msg, n) => setProgress(`${msg}. ${n} cards.`),
      })
      setReport(report)

      if (cards.length === 0) {
        setError('That set produced no cards. Check the set code.')
        setBuilding(false)
        return
      }

      const finalSettings: GradingSettings = {
        ...settings,
        colorOrder: parseColorOrder(colorText),
        sectionOrder: sectionsInPool(cards),
      }

      const code = generateSessionCode()
      const name = `${setInfo.name} review`

      let sessionId: string
      let graders: Grader[]

      const created = await backend.createSession({
        code,
        name,
        setCode: setInfo.code,
        setName: setInfo.name,
        bonusSets: requests.map((r) => ({ code: r.code, name: r.name })),
        cards,
        settings: finalSettings,
        graderNames: names,
      })

      if (created) {
        sessionId = created.sessionId
        graders = created.graders
      } else {
        // Local-only mode: mint ids client-side.
        sessionId = crypto.randomUUID()
        graders = names.map((n, i) => ({
          id: crypto.randomUUID(),
          name: n,
          currentCardId: null,
          followId: null,
          accent: ['#c8a15a', '#6aa9d6', '#c26b6b', '#7fb87f', '#a98ac9'][i % 5],
        }))
      }

      const meta: SessionMeta = {
        id: sessionId,
        code,
        name,
        setCode: setInfo.code,
        setName: setInfo.name,
        bonusSets: requests.map((r) => ({ code: r.code, name: r.name })),
        settings: finalSettings,
      }

      persistLocally(meta, cards, graders)
      hydrate({ meta, cards, graders, grades: [], meId: null })
      navigate({ name: 'grade', sessionId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl">New session</h1>

      <Panel className="space-y-4">
        <Field label="Set code" hint="Scryfall set code. For example ecl, sos, eoe.">
          <Input
            value={setCode}
            onChange={(e) => setSetCode(e.target.value)}
            placeholder="ecl"
            autoFocus
            spellCheck={false}
          />
        </Field>

        {checking ? <Spinner label="Checking set" /> : null}
        {codeError ? <Notice tone="error">{codeError}</Notice> : null}
        {setInfo ? (
          <Notice>
            {setInfo.name}. {setInfo.card_count} printings, released {setInfo.released_at}.
          </Notice>
        ) : null}
      </Panel>

      {setInfo ? (
        <Panel className="space-y-4">
          <div className="text-sm">Bonus sheets</div>
          {bonus.length === 0 ? (
            <p className="text-sm text-[--color-muted]">
              No bonus sheet found for this set. Add one below if it has one.
            </p>
          ) : (
            <div className="space-y-3">
              {bonus.map((b, i) => (
                <div key={b.code} className="space-y-2 rounded border border-[--color-edge] p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={b.selected}
                      onChange={(e) =>
                        setBonus((list) =>
                          list.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)),
                        )
                      }
                      className="h-4 w-4 accent-[--color-accent]"
                    />
                    {b.name} ({b.code.toUpperCase()})
                  </label>
                  {b.selected ? (
                    <div className="flex items-center gap-2 pl-6 text-xs text-[--color-muted]">
                      <span>Collector numbers</span>
                      <Input
                        value={b.from}
                        onChange={(e) =>
                          setBonus((l) => l.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))
                        }
                        placeholder="from"
                        className="w-20"
                        inputMode="numeric"
                      />
                      <Input
                        value={b.to}
                        onChange={(e) =>
                          setBonus((l) => l.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))
                        }
                        placeholder="to"
                        className="w-20"
                        inputMode="numeric"
                      />
                      <span>Leave blank for the whole sheet.</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <Field
              label="Add a sheet by code"
              hint="Needed for Special Guests (spg), which has no parent set link."
            >
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="spg"
                spellCheck={false}
              />
            </Field>
            <Button onClick={addManual} disabled={!manualCode.trim()}>
              Add
            </Button>
          </div>
        </Panel>
      ) : null}

      <Panel className="space-y-4">
        <div className="text-sm">Graders</div>
        {graderNames.map((n, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={n}
              onChange={(e) =>
                setGraderNames((list) => list.map((x, j) => (j === i ? e.target.value : x)))
              }
              placeholder={`Grader ${i + 1}`}
            />
            {graderNames.length > 1 ? (
              <Button
                variant="danger"
                onClick={() => setGraderNames((l) => l.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        <Button onClick={() => setGraderNames((l) => [...l, ''])}>Add grader</Button>
        {!namesUnique ? <Notice tone="error">Grader names must be different.</Notice> : null}
      </Panel>

      <Panel className="space-y-4">
        <div className="text-sm">Order</div>
        <Field label="Mode">
          <select
            value={settings.mode}
            onChange={(e) =>
              setSettings((s) => ({ ...s, mode: e.target.value as GradingSettings['mode'] }))
            }
            className="w-full rounded border border-[--color-edge] bg-[--color-ink] px-3 py-2 text-sm"
          >
            <option value="color-first">Colour, then rarity</option>
            <option value="rarity-first">Rarity, then colour</option>
          </select>
        </Field>
        <Field
          label="Colour order"
          hint="W U B R G for colours, MC multicolour, C colourless, L lands. Missing entries are appended."
        >
          <Input value={colorText} onChange={(e) => setColorText(e.target.value)} spellCheck={false} />
        </Field>
      </Panel>

      {!isBackendConfigured ? (
        <Notice tone="warn">
          Supabase is not configured, so this session stays on this device only. Multi-device
          sync needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.
        </Notice>
      ) : null}

      {building ? <Spinner label={progress || 'Building card pool'} /> : null}
      {report ? <PoolSummary report={report} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex gap-2">
        <Button variant="primary" onClick={create} disabled={!canCreate}>
          Create session
        </Button>
        <Button onClick={() => navigate({ name: 'landing' })}>Cancel</Button>
      </div>
    </div>
  )
}

function PoolSummary({ report }: { report: PoolReport }) {
  return (
    <Notice tone={report.usedFallback ? 'warn' : 'info'}>
      <div className="space-y-1">
        <div>Query: {report.mainQuery}</div>
        {report.usedFallback ? (
          <div>
            Scryfall has no booster data for this set yet, so every non-token, non-basic card
            was included. Common for a set at release.
          </div>
        ) : null}
        {report.sections.map((s) => (
          <div key={s.code}>
            {s.name}: {s.count} cards.
          </div>
        ))}
      </div>
    </Notice>
  )
}

function persistLocally(meta: SessionMeta, cards: CardRecord[], graders: Grader[]): void {
  const ok = local.savePool(meta.id, cards)
  if (!ok) {
    console.warn('Card pool exceeded localStorage quota; it will be refetched from the backend.')
  }
  local.saveSession({ meta, graders, grades: [], updatedAt: Date.now() })
}
