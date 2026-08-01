/** Minimal hash router.
 *
 *  Hash routing rather than history routing so the app can be served from any
 *  static host without a rewrite rule, and so a session link like
 *  #/s/MXK4-92/grade survives a hard refresh.
 */

import { useEffect, useState } from 'react'

export type Route =
  | { name: 'landing' }
  | { name: 'create' }
  | { name: 'join'; code: string }
  | { name: 'grade'; sessionId: string }
  | { name: 'results'; sessionId: string }
  | { name: 'settings'; sessionId: string }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\//, '')
  const parts = path.split('/').filter(Boolean)

  if (parts[0] === 'create') return { name: 'create' }
  if (parts[0] === 'join') return { name: 'join', code: parts[1] ?? '' }
  if (parts[0] === 's' && parts[1]) {
    const sessionId = parts[1]
    const tab = parts[2] ?? 'grade'
    if (tab === 'results') return { name: 'results', sessionId }
    if (tab === 'settings') return { name: 'settings', sessionId }
    return { name: 'grade', sessionId }
  }
  return { name: 'landing' }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'create':
      return '#/create'
    case 'join':
      return `#/join/${route.code}`
    case 'grade':
      return `#/s/${route.sessionId}/grade`
    case 'results':
      return `#/s/${route.sessionId}/results`
    case 'settings':
      return `#/s/${route.sessionId}/settings`
    default:
      return '#/'
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
