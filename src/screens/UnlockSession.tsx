/** Shown when a session link is opened on a device that has no stored password.
 *
 *  The session id is in the URL, but since migration 0004 that alone grants
 *  nothing: row level security requires the session password too.
 */

import { useState } from 'react'
import { Button, Field, Input, Notice, Panel } from '../components/ui'
import { navigate } from '../router'
import * as local from '../storage/local'
import { useSession } from '../store/session'
import { normaliseCredential } from '../supabase/pin'

export function UnlockSession({ sessionId }: { sessionId: string }) {
  const load = useSession((s) => s.load)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function unlock() {
    if (!password) return
    setBusy(true)
    setError(null)

    // Store before loading: the backend reads the password from storage when
    // it builds its client. Cleared again if the load turns up nothing.
    local.saveSessionPassword(sessionId, normaliseCredential(password))
    try {
      await load(sessionId)
      if (!useSession.getState().meta) {
        local.clearSessionPassword(sessionId)
        setError('That password did not unlock this session.')
      }
    } catch (err) {
      local.clearSessionPassword(sessionId)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-xl">Session password</h1>
        <p className="mt-1 text-sm text-muted">
          This link needs the session password before it will open. Ask whoever set the
          session up.
        </p>
      </div>

      <Panel className="space-y-4">
        <Field label="Session password">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void unlock()}
            autoComplete="off"
            autoFocus
          />
        </Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void unlock()} disabled={!password} loading={busy}>
            Open session
          </Button>
          <Button onClick={() => navigate({ name: 'landing' })}>Back</Button>
        </div>
      </Panel>
    </div>
  )
}
