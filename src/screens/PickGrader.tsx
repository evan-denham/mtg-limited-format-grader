/** Choose which grader this device is, and set or enter that grader's PIN.
 *
 *  The PIN prevents accidental cross-grading. It is not access control; see
 *  the note in supabase/pin.ts.
 */

import { useState } from 'react'
import { Button, Field, Input, Notice, Panel } from '../components/ui'
import { isValidPin } from '../supabase/pin'
import { backend } from '../supabase/backend'
import { useSession } from '../store/session'

export function PickGrader() {
  const meta = useSession((s) => s.meta)
  const graders = useSession((s) => s.graders)
  const setMe = useSession((s) => s.setMe)

  const [selected, setSelected] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const grader = graders.find((g) => g.id === selected) ?? null

  async function confirm() {
    if (!grader || !meta) return
    if (!isValidPin(pin)) {
      setError('PIN must be four digits.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await backend.claimGrader(meta.id, grader.id, pin)
      if (result === 'wrong-pin') {
        setError('That PIN does not match the one set for this grader.')
        return
      }
      setMe(grader.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-xl">Who is grading?</h1>
        <p className="mt-1 text-sm text-muted">
          Pick your name. Your grades and notes are stored against it.
        </p>
      </div>

      <Panel className="space-y-2">
        {graders.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              setSelected(g.id)
              setPin('')
              setError(null)
            }}
            className={
              'w-full rounded border px-3 py-2 text-left text-sm transition-colors ' +
              (selected === g.id
                ? 'border-accent'
                : 'border-edge hover:border-muted')
            }
          >
            {g.name}
          </button>
        ))}
      </Panel>

      {grader ? (
        <Panel className="space-y-4">
          <Field
            label={`PIN for ${grader.name}`}
            hint="Type the pin you assigned at time of session generation to authenticate your login."
          >
            <Input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0000"
            />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button variant="primary" onClick={confirm} disabled={busy || pin.length !== 4}>
            {busy ? 'Checking' : 'Start grading'}
          </Button>
        </Panel>
      ) : null}
    </div>
  )
}
