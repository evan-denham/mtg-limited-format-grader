import { useEffect } from 'react'
import { navigate, useRoute, type Route } from './router'
import { CreateSession } from './screens/CreateSession'
import { GradeScreen } from './screens/GradeScreen'
import { Landing } from './screens/Landing'
import { PickGrader } from './screens/PickGrader'
import { ResultsScreen } from './screens/ResultsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { UnlockSession } from './screens/UnlockSession'
import * as local from './storage/local'
import { isBackendConfigured } from './supabase/client'
import { Notice, Spinner } from './components/ui'
import { useSession } from './store/session'
import { backend } from './supabase/backend'

export default function App() {
  const route = useRoute()
  const sessionId = 'sessionId' in route ? route.sessionId : null

  const meta = useSession((s) => s.meta)
  const meId = useSession((s) => s.meId)
  const loading = useSession((s) => s.loading)
  const error = useSession((s) => s.error)
  const load = useSession((s) => s.load)
  const applyRemoteGrade = useSession((s) => s.applyRemoteGrade)
  const applyRemoteGrader = useSession((s) => s.applyRemoteGrader)
  const applyRemoteSettings = useSession((s) => s.applyRemoteSettings)

  // Since 0004 the session password is required before anything can be read,
  // so hold off loading until it is available.
  const hasPassword =
    !isBackendConfigured || !sessionId || Boolean(local.loadSessionPassword(sessionId))

  // Load whenever the route points at a session we do not already hold.
  useEffect(() => {
    if (sessionId && hasPassword && meta?.id !== sessionId) void load(sessionId)
  }, [sessionId, hasPassword, meta?.id, load])

  // Live sync. Re-subscribes only when the session changes.
  useEffect(() => {
    if (!sessionId || !backend.configured) return
    return backend.subscribe(sessionId, {
      onGrade: applyRemoteGrade,
      onGrader: applyRemoteGrader,
      onSettings: applyRemoteSettings,
    })
  }, [sessionId, applyRemoteGrade, applyRemoteGrader, applyRemoteSettings])

  if (route.name === 'landing') {
    return <Shell><Landing /></Shell>
  }
  if (route.name === 'create') {
    return <Shell><CreateSession /></Shell>
  }

  if (sessionId && !hasPassword) {
    return (
      <Shell>
        <UnlockSession sessionId={sessionId} />
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <Spinner label="Loading session" />
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div className="mx-auto max-w-md space-y-4">
          <Notice tone="error">{error}</Notice>
          <a href="#/" className="text-sm text-accent">
            Back to start
          </a>
        </div>
      </Shell>
    )
  }

  if (!meta) return <Shell>{null}</Shell>

  const session = { name: meta.name, code: meta.code, id: meta.id }

  // Every session screen needs to know who is grading.
  if (!meId) {
    return (
      <Shell session={session} route={route}>
        <PickGrader />
      </Shell>
    )
  }

  return (
    <Shell session={session} route={route} tabs wide={route.name === 'results'}>
      {route.name === 'results' ? (
        <ResultsScreen />
      ) : route.name === 'settings' ? (
        <SettingsScreen />
      ) : (
        <GradeScreen />
      )}
    </Shell>
  )
}

function Shell({
  children,
  session,
  route,
  tabs,
  wide,
}: {
  children: React.ReactNode
  session?: { name: string; code: string; id: string }
  route?: Route
  tabs?: boolean
  /** Results needs the full screen: card images there are the content, not
   *  decoration, and a 6xl column wastes most of a desktop display. */
  wide?: boolean
}) {
  const meId = useSession((s) => s.meId)
  const graders = useSession((s) => s.graders)
  const me = graders.find((g) => g.id === meId)

  return (
    <div className="min-h-full">
      <header className="border-b border-edge bg-panel">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <a href="#/" className="text-sm font-medium hover:text-accent">
            Limited Format Grader
          </a>
          {session ? (
            <>
              <span className="text-sm text-muted">{session.name}</span>
              <span className="rounded border border-edge px-2 py-0.5 font-mono text-xs text-muted">
                {session.code}
              </span>
            </>
          ) : null}

          {tabs && session && route ? (
            <nav className="ml-auto flex gap-1">
              <Tab route={route} target="grade" sessionId={session.id}>
                Grade
              </Tab>
              <Tab route={route} target="results" sessionId={session.id}>
                Results
              </Tab>
              <Tab route={route} target="settings" sessionId={session.id}>
                Settings
              </Tab>
            </nav>
          ) : null}

          {me && session ? (
            <button
              onClick={() => {
                localStorage.removeItem(`mtglfg.identity.${session.id}`)
                window.location.reload()
              }}
              className="text-xs text-muted hover:text-text"
              title="Switch grader"
            >
              {me.name}
            </button>
          ) : null}
        </div>
      </header>

      <main
        className={`mx-auto w-full px-4 py-6 ${wide ? 'max-w-[1800px]' : 'max-w-6xl'}`}
      >
        {children}
      </main>
    </div>
  )
}

function Tab({
  route,
  target,
  sessionId,
  children,
}: {
  route: Route
  target: 'grade' | 'results' | 'settings'
  sessionId: string
  children: React.ReactNode
}) {
  const active = route.name === target
  return (
    <button
      onClick={() => navigate({ name: target, sessionId } as Route)}
      className={
        'rounded px-3 py-1.5 text-sm transition-colors ' +
        (active
          ? 'bg-ink text-text'
          : 'text-muted hover:text-text')
      }
    >
      {children}
    </button>
  )
}
