/** Session creation: set code, bonus sheets, graders, order. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Field, Input, Notice, Panel, Select, Spinner } from '../components/ui'
import { DEFAULT_SETTINGS, formatColorOrder, parseColorOrder, sectionsInPool } from '../domain/ordering'
import { ORDER_MODE_LABELS, type BonusSet, type CardRecord, type GradingSettings, type Grader, type SessionMeta } from '../domain/types'
import { ScryfallError, type RawSet } from '../scryfall/api'
import { buildPool, detectBonusSheets, validateSet, type BonusRequest, type PoolReport } from '../scryfall/pool'
import { generatePin, generateSessionCode, isValidPin } from '../supabase/pin'
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

  const [graderRows, setGraderRows] = useState<{ name: string; pin: string }[]>([
    { name: '', pin: generatePin() },
  ])
  const [hostIndex, setHostIndex] = useState(0)
  const [settings, setSettings] = useState<GradingSettings>(DEFAULT_SETTINGS)
  const [colorText, setColorText] = useState(formatColorOrder(DEFAULT_SETTINGS.colorOrder))

  const [adminPassword, setAdminPassword] = useState(() => local.loadAdminPassword() ?? '')
  const [joinPassword, setJoinPassword] = useState('')

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

  const filled = graderRows.filter((g) => g.name.trim())
  const names = filled.map((g) => g.name.trim())
  const namesUnique = new Set(names.map((n) => n.toLowerCase())).size === names.length
  const pinsValid = filled.every((g) => isValidPin(g.pin))
  // Only the admin password is enforced server side; these are here so the
  // form fails fast instead of after a full Scryfall fetch.
  const credsOk = !isBackendConfigured || (adminPassword.length > 0 && joinPassword.length >= 4)
  const canCreate =
    Boolean(setInfo) && names.length > 0 && namesUnique && pinsValid && credsOk && !building

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

      const newGraders = filled.map((g) => ({ name: g.name.trim(), pin: g.pin }))
      const safeHostIndex = Math.min(hostIndex, newGraders.length - 1)

      let sessionId: string
      let graders: Grader[]
      let hostGraderId: string | null

      const created = await backend.createSession({
        code,
        name,
        setCode: setInfo.code,
        setName: setInfo.name,
        bonusSets: requests.map((r) => ({ code: r.code, name: r.name })),
        cards,
        settings: finalSettings,
        graders: newGraders,
        hostIndex: safeHostIndex,
        joinPassword,
        adminPassword,
      })

      if (created) {
        sessionId = created.sessionId
        graders = created.graders
        hostGraderId = created.hostGraderId
      } else {
        // Local-only mode: mint ids client-side.
        sessionId = crypto.randomUUID()
        graders = newGraders.map((g, i) => ({
          id: crypto.randomUUID(),
          name: g.name,
          currentCardId: null,
          followId: null,
          accent: ['#4a9eff', '#e0a938', '#ff6b6b', '#7fb87f', '#a98ac9'][i % 5],
          pin: g.pin,
        }))
        hostGraderId = graders[safeHostIndex]?.id ?? null
      }

      const meta: SessionMeta = {
        id: sessionId,
        code,
        name,
        setCode: setInfo.code,
        setName: setInfo.name,
        bonusSets: requests.map((r) => ({ code: r.code, name: r.name })),
        settings: finalSettings,
        hostGraderId,
      }

      if (isBackendConfigured) {
        local.saveSessionPassword(sessionId, joinPassword)
        local.saveAdminPassword(adminPassword)
      }
      persistLocally(meta, cards, graders)
      hydrate({ meta, cards, graders, grades: [], meId: null })
      navigate({ name: 'grade', sessionId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // RLS reports a refused insert as a policy violation; say what it means.
      setError(
        /row-level security|violates|policy/i.test(message)
          ? 'The admin password was not accepted, so the session was not created.'
          : message,
      )
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
            <p className="text-sm text-muted">
              No bonus sheet found for this set. Add one below if it has one.
            </p>
          ) : (
            <div className="space-y-3">
              {bonus.map((b, i) => (
                <div key={b.code} className="space-y-2 rounded border border-edge p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={b.selected}
                      onChange={(e) =>
                        setBonus((list) =>
                          list.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)),
                        )
                      }
                      className="h-4 w-4 accent-accent"
                    />
                    {b.name} ({b.code.toUpperCase()})
                  </label>
                  {b.selected ? (
                    <div className="flex items-center gap-2 pl-6 text-xs text-muted">
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

      {isBackendConfigured ? (
        <Panel className="space-y-4">
          <div className="text-sm">Access</div>
          <Field
            label="Admin password"
            hint="Required to create a session. Checked by the database, never stored in the site. Kept for this browser tab only."
          >
            <Input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field
            label="Session password"
            hint="Give this to your graders along with the session code. They need both to join. Minimum four characters."
          >
            <Input
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              autoComplete="off"
              placeholder="at least 4 characters"
            />
          </Field>
        </Panel>
      ) : null}

      <Panel className="space-y-4">
        <div className="text-sm">Graders</div>
        <p className="text-xs text-muted">
          Assign each grader a four-digit PIN now and tell them what it is. You can look them
          up again later in Settings. The PIN stops graders entering grades as each other by
          accident; it is not a password, so do not reuse one that matters.
        </p>

        <div className="space-y-2">
          {graderRows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                value={row.name}
                onChange={(e) =>
                  setGraderRows((l) =>
                    l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
                placeholder={`Grader ${i + 1}`}
                className="min-w-40 flex-1"
              />
              <Input
                value={row.pin}
                onChange={(e) =>
                  setGraderRows((l) =>
                    l.map((x, j) =>
                      j === i ? { ...x, pin: e.target.value.replace(/\D/g, '').slice(0, 4) } : x,
                    ),
                  )
                }
                inputMode="numeric"
                placeholder="PIN"
                className="w-24 font-mono"
              />
              <Button
                onClick={() =>
                  setGraderRows((l) =>
                    l.map((x, j) => (j === i ? { ...x, pin: generatePin() } : x)),
                  )
                }
                title="Generate a random PIN"
              >
                Random
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="radio"
                  name="host"
                  checked={hostIndex === i}
                  onChange={() => setHostIndex(i)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                This is me
              </label>
              {graderRows.length > 1 ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setGraderRows((l) => l.filter((_, j) => j !== i))
                    setHostIndex((h) => (h >= i && h > 0 ? h - 1 : h))
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </div>

        <Button onClick={() => setGraderRows((l) => [...l, { name: '', pin: generatePin() }])}>
          Add grader
        </Button>

        {!namesUnique ? <Notice tone="error">Grader names must be different.</Notice> : null}
        {!pinsValid ? <Notice tone="error">Every PIN must be exactly four digits.</Notice> : null}
      </Panel>

      <Panel className="space-y-4">
        <div className="text-sm">Order</div>
        <Field label="Mode">
          <Select
            value={settings.mode}
            onChange={(e) =>
              setSettings((s) => ({ ...s, mode: e.target.value as GradingSettings['mode'] }))
            }
            className="w-full"
          >
            {Object.entries(ORDER_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
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
