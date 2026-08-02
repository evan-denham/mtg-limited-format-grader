/** Shared order settings plus session details. Changes sync to every grader. */

import { useState } from 'react'
import { Button, Field, Input, Notice, Panel, Select } from '../components/ui'
import { formatColorOrder, parseColorOrder, RARITY_LABELS } from '../domain/ordering'
import { ORDER_MODE_LABELS, type GradingSettings } from '../domain/types'
import { useSession } from '../store/session'
import { isBackendConfigured } from '../supabase/client'
import { generatePin, isValidPin, normaliseCredential } from '../supabase/pin'
import * as local from '../storage/local'

export function SettingsScreen() {
  const meta = useSession((s) => s.meta)
  const cards = useSession((s) => s.cards)
  const graders = useSession((s) => s.graders)
  const updateSettings = useSession((s) => s.updateSettings)

  const meId = useSession((st) => st.meId)

  const [colorText, setColorText] = useState(
    meta ? formatColorOrder(meta.settings.colorOrder) : '',
  )

  if (!meta) return null
  const s = meta.settings
  // Falls back to the first grader for sessions created before hosts existed.
  const isHost = meta.hostGraderId ? meId === meta.hostGraderId : meId === graders[0]?.id

  const sectionCounts = new Map<string, number>()
  for (const c of cards) sectionCounts.set(c.section, (sectionCounts.get(c.section) ?? 0) + 1)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Panel className="space-y-3">
        <div className="text-sm">Session</div>
        <Row label="Name" value={meta.name} />
        <Row label="Code" value={meta.code} />
        <Row label="Set" value={`${meta.setName} (${meta.setCode.toUpperCase()})`} />
        <Row label="Cards" value={String(cards.length)} />
        <Row label="Graders" value={graders.map((g) => g.name).join(', ')} />
        {[...sectionCounts].map(([code, n]) => (
          <Row
            key={code}
            label={code === 'main' ? 'Main set' : code.toUpperCase()}
            value={`${n} cards`}
          />
        ))}
      </Panel>

      {isHost ? <GraderPins /> : null}

      <Panel className="space-y-4">
        <div className="text-sm">Grading order</div>
        <p className="text-xs text-muted">
          Order is shared. Changing it reorders the queue for every grader but keeps each
          grader on the card they are currently viewing.
        </p>

        <Field
          label="Mode"
          hint="Set number walks the set exactly as printed and ignores colour and rarity."
        >
          <Select
            value={s.mode}
            onChange={(e) => updateSettings({ mode: e.target.value as GradingSettings['mode'] })}
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
          hint="W U B R G for colours, MC multicolour, C colourless, L lands. Anything missing is appended."
        >
          <div className="flex gap-2">
            <Input
              value={colorText}
              onChange={(e) => setColorText(e.target.value)}
              spellCheck={false}
            />
            <Button onClick={() => updateSettings({ colorOrder: parseColorOrder(colorText) })}>
              Apply
            </Button>
          </div>
        </Field>
        <div className="text-xs text-muted">
          Currently: {formatColorOrder(s.colorOrder)}
        </div>

        <Field label="Rarity order">
          <div className="text-sm text-muted">
            {s.rarityOrder.map((r) => RARITY_LABELS[r] ?? r).join(' → ')}
          </div>
        </Field>

        <Field label="Tiebreak" hint="Not used in set number mode.">
          <Select
            value={s.tiebreak}
            onChange={(e) =>
              updateSettings({ tiebreak: e.target.value as GradingSettings['tiebreak'] })
            }
            className="w-full"
          >
            <option value="collector">Collector number</option>
            <option value="name">Name</option>
          </Select>
        </Field>

        <Field label="Section order" hint="Drag is not supported; use the buttons.">
          <ul className="space-y-2">
            {s.sectionOrder.map((code, i) => (
              <li key={code} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  {code === 'main' ? 'Main set' : code.toUpperCase()}
                </span>
                <Button
                  onClick={() => updateSettings({ sectionOrder: move(s.sectionOrder, i, -1) })}
                  disabled={i === 0}
                >
                  Up
                </Button>
                <Button
                  onClick={() => updateSettings({ sectionOrder: move(s.sectionOrder, i, 1) })}
                  disabled={i === s.sectionOrder.length - 1}
                >
                  Down
                </Button>
              </li>
            ))}
          </ul>
        </Field>
      </Panel>

      <Panel className="space-y-4">
        <div className="text-sm">Card display</div>
        <Field label="Show">
          <Select
            value={s.cardDisplay}
            onChange={(e) =>
              updateSettings({ cardDisplay: e.target.value as GradingSettings['cardDisplay'] })
            }
            className="w-full"
          >
            <option value="full">Full card image</option>
            <option value="art">Art only</option>
          </Select>
        </Field>
      </Panel>

      {!isBackendConfigured ? (
        <Notice tone="warn">
          Supabase is not configured. Settings changes stay on this device.
        </Notice>
      ) : null}
    </div>
  )
}

/** Host-only roster: shows each grader's PIN so the host can remind someone
 *  what theirs is, and adds graders to a session already under way. Hidden
 *  behind a disclosure so PINs are not on screen by default. */
function GraderPins() {
  const meta = useSession((s) => s.meta)
  const graders = useSession((s) => s.graders)
  const addGrader = useSession((s) => s.addGrader)

  const [revealed, setRevealed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [pin, setPin] = useState(() => generatePin())
  const [adminPassword, setAdminPassword] = useState(() => local.loadAdminPassword() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  if (!meta) return null

  const nameTaken = graders.some((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase())
  const canAdd =
    name.trim().length > 0 &&
    !nameTaken &&
    isValidPin(pin) &&
    (!isBackendConfigured || adminPassword.length > 0)

  async function submit() {
    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      const newName = name.trim()
      await addGrader(newName, pin, normaliseCredential(adminPassword))
      if (isBackendConfigured) local.saveAdminPassword(normaliseCredential(adminPassword))
      setAdded(`${newName} added with PIN ${pin}. Give them the session code and password too.`)
      setName('')
      setPin(generatePin())
      setAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">Graders</div>
        <div className="flex gap-2">
          <Button onClick={() => setRevealed((r) => !r)}>
            {revealed ? 'Hide PINs' : 'Show PINs'}
          </Button>
          <Button onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'Add grader'}</Button>
        </div>
      </div>
      <p className="text-xs text-muted">
        Visible to you as the session host. Anyone already in the session can read these from
        the database directly, so treat them as a convenience, not a secret.
      </p>

      <ul className="divide-y divide-edge rounded border border-edge">
        {graders.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
            <span>
              {g.name}
              {g.id === meta.hostGraderId ? (
                <span className="ml-2 text-xs text-muted">host</span>
              ) : null}
            </span>
            <span className="font-mono text-muted">
              {revealed ? (g.pin ?? 'not set') : '••••'}
            </span>
          </li>
        ))}
      </ul>

      {added ? <Notice>{added}</Notice> : null}

      {adding ? (
        <div className="space-y-3 rounded border border-edge p-3">
          <p className="text-xs text-muted">
            A grader added now starts with nothing graded. Combined grades ignore cards they
            have not reached, so existing results are not dragged down.
          </p>
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grader name"
              autoFocus
            />
          </Field>
          <Field label="PIN" hint="Four digits. Tell them what it is.">
            <div className="flex gap-2">
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                className="w-28 font-mono"
              />
              <Button onClick={() => setPin(generatePin())}>Random</Button>
            </div>
          </Field>
          {isBackendConfigured ? (
            <Field label="Admin password" hint="Required to change who is in a session.">
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="off"
              />
            </Field>
          ) : null}
          {nameTaken ? <Notice tone="error">That name is already taken.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button variant="primary" onClick={() => void submit()} disabled={!canAdd} loading={busy}>
            Add grader
          </Button>
        </div>
      ) : null}
    </Panel>
  )
}

function move(list: string[], index: number, delta: number): string[] {
  const next = [...list]
  const target = index + delta
  if (target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
