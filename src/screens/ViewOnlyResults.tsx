/** Read-only results, reached through a share link.
 *
 *  The token in the URL is the only credential. It grants select and nothing
 *  else: the write policies in migration 0006 do not accept it, so a viewer
 *  cannot grade even by calling the API directly. Hiding controls here is
 *  presentation, not the enforcement.
 */

import { useEffect, useState } from 'react'
import { Notice, Spinner } from '../components/ui'
import { ResultsScreen } from './ResultsScreen'
import * as local from '../storage/local'
import { useSession } from '../store/session'

export function ViewOnlyResults({ sessionId, token }: { sessionId: string; token: string }) {
  const load = useSession((s) => s.load)
  const meta = useSession((s) => s.meta)
  const error = useSession((s) => s.error)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Stored before loading: the backend reads credentials from storage when it
    // builds its client. Keeping it also means a reload works without the token
    // still being in the address bar.
    local.saveViewToken(sessionId, token)
    void load(sessionId).finally(() => setReady(true))
  }, [sessionId, token, load])

  if (!ready) return <Spinner label="Loading results" />

  if (error || !meta) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <Notice tone="error">
          This share link did not open a session. It may have been revoked, or the link may be
          incomplete.
        </Notice>
        <a href="#/" className="text-sm text-accent">
          Back to start
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Notice>
        Read-only view of {meta.name}. Grades cannot be changed from this link.
      </Notice>
      <ResultsScreen />
    </div>
  )
}
