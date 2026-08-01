import { useState } from 'react'
import { Button, Field, Input, Notice, Panel } from '../components/ui'
import { navigate } from '../router'
import * as local from '../storage/local'
import { backend } from '../supabase/backend'
import { isBackendConfigured } from '../supabase/client'

export function Landing() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const sessions = local.listSessions()

  async function join() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setJoining(true)
    setError(null)

    const localMatch = local.findSessionByCode(trimmed)
    if (localMatch) {
      navigate({ name: 'grade', sessionId: localMatch.id })
      return
    }

    try {
      const remote = await backend.findSessionByCode(trimmed)
      if (remote) {
        navigate({ name: 'grade', sessionId: remote.id })
        return
      }
      setError(
        isBackendConfigured
          ? `No session with code ${trimmed}.`
          : `No session with code ${trimmed} on this device. Multi-device joining needs Supabase configured.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl">Limited Format Grader</h1>
        <p className="mt-1 text-sm text-[--color-muted]">
          Grade every card in a set, card by card, with one or more graders.
        </p>
      </div>

      <Panel className="space-y-4">
        <div className="text-sm">Start a session</div>
        <Button variant="primary" onClick={() => navigate({ name: 'create' })}>
          New session
        </Button>
      </Panel>

      <Panel className="space-y-4">
        <div className="text-sm">Join a session</div>
        <Field label="Session code">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="MXK-492"
            spellCheck={false}
          />
        </Field>
        <Button onClick={join} disabled={!code.trim() || joining}>
          {joining ? 'Looking up' : 'Join'}
        </Button>
        {error ? <Notice tone="error">{error}</Notice> : null}
      </Panel>

      {sessions.length > 0 ? (
        <Panel className="space-y-3">
          <div className="text-sm">On this device</div>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <button
                  onClick={() => navigate({ name: 'grade', sessionId: s.id })}
                  className="min-w-0 flex-1 text-left text-sm hover:text-[--color-accent]"
                >
                  <span className="block truncate">{s.name}</span>
                  <span className="block text-xs text-[--color-muted]">
                    {s.code} · {s.setCode.toUpperCase()}
                  </span>
                </button>
                <Button
                  variant="danger"
                  onClick={() => {
                    local.deleteSession(s.id)
                    // listSessions is read at render; force one.
                    setCode((c) => c)
                    navigate({ name: 'landing' })
                    window.location.reload()
                  }}
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
