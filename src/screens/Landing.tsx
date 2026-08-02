import { useState } from 'react'
import { Button, Field, Input, Notice, Panel } from '../components/ui'
import { navigate } from '../router'
import * as local from '../storage/local'
import { backend } from '../supabase/backend'
import { isBackendConfigured } from '../supabase/client'
import { normaliseCredential } from '../supabase/pin'

export function Landing() {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const sessions = local.listSessions()

  async function join() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setJoining(true)
    setError(null)

    try {
      // A session already on this device does not need the password re-entered.
      const localMatch = local.findSessionByCode(trimmed)
      if (localMatch && local.loadSessionPassword(localMatch.id)) {
        navigate({ name: 'grade', sessionId: localMatch.id })
        return
      }

      if (!isBackendConfigured) {
        setError(
          localMatch
            ? 'This session is on this device but its password is missing. Ask the host.'
            : `No session with code ${trimmed} on this device. Multi-device joining needs Supabase configured.`,
        )
        return
      }

      const pw = normaliseCredential(password)
      const remote = await backend.findSessionByCode(trimmed, pw)
      if (remote) {
        local.saveSessionPassword(remote.id, pw)
        navigate({ name: 'grade', sessionId: remote.id })
        return
      }
      // RLS returns no rows for a wrong code and a wrong password alike, so
      // the message cannot distinguish them without leaking which was wrong.
      setError('No session matched that code and password.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setJoining(false)
    }
  }

  /** Deleting is admin-only server side, so the admin password is required. */
  async function remove(sessionId: string, name: string) {
    if (!window.confirm(`Delete "${name}" and every grade in it? This cannot be undone.`)) return

    let admin = local.loadAdminPassword() ?? ''
    if (isBackendConfigured) {
      const entered = window.prompt(`Admin password required to delete "${name}".`, admin)
      if (entered === null) return
      admin = entered
    }

    setDeleting(sessionId)
    setError(null)
    try {
      await backend.deleteSession(sessionId, admin)
      if (isBackendConfigured) local.saveAdminPassword(admin)
      local.deleteSession(sessionId)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl">Limited Format Grader</h1>
        <p className="mt-1 text-sm text-muted">
          Grade every card in a set, card by card, with one or more graders.
        </p>
      </div>

      <Panel className="space-y-4">
        <div className="text-sm">Join a session</div>
        <Field label="Session code">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="MXK-492"
            spellCheck={false}
          />
        </Field>
        {isBackendConfigured ? (
          <Field label="Session password" hint="Given to you by whoever set up the session.">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              autoComplete="off"
            />
          </Field>
        ) : null}
        <Button variant="primary" onClick={join} disabled={!code.trim() || joining}>
          {joining ? 'Checking' : 'Join'}
        </Button>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Panel>

      <Panel className="space-y-3">
        <div className="text-sm">Start a session</div>
        <p className="text-xs text-muted">
          {isBackendConfigured
            ? 'Requires the admin password.'
            : 'Running local-only, so no admin password is needed.'}
        </p>
        <Button onClick={() => navigate({ name: 'create' })}>New session</Button>
      </Panel>

      {sessions.length > 0 ? (
        <Panel className="space-y-3">
          <div className="text-sm">On this device</div>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <button
                  onClick={() => navigate({ name: 'grade', sessionId: s.id })}
                  className="min-w-0 flex-1 text-left text-sm hover:text-accent"
                >
                  <span className="block truncate">{s.name}</span>
                  <span className="block text-xs text-muted">
                    {s.code} · {s.setCode.toUpperCase()}
                  </span>
                </button>
                <Button
                  variant="danger"
                  loading={deleting === s.id}
                  onClick={() => void remove(s.id, s.name)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {!isBackendConfigured ? (
        <Notice tone="warn">
          Running local-only. Sessions stay in this browser and cannot be joined from another
          device until Supabase is configured.
        </Notice>
      ) : null}
    </div>
  )
}
