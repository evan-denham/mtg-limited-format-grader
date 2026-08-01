import { describe, expect, it } from 'vitest'
import { hrefFor, parseHash, type Route } from './router'

describe('parseHash', () => {
  it('reads the landing route from empty or root hashes', () => {
    for (const h of ['', '#', '#/', '#/nonsense']) {
      expect(parseHash(h).name).toBe('landing')
    }
  })

  it('reads session tabs', () => {
    expect(parseHash('#/s/abc/grade')).toEqual({ name: 'grade', sessionId: 'abc' })
    expect(parseHash('#/s/abc/results')).toEqual({ name: 'results', sessionId: 'abc' })
    expect(parseHash('#/s/abc/settings')).toEqual({ name: 'settings', sessionId: 'abc' })
  })

  it('defaults a bare session link to the grade tab', () => {
    expect(parseHash('#/s/abc')).toEqual({ name: 'grade', sessionId: 'abc' })
  })

  it('reads a join code, including an empty one', () => {
    expect(parseHash('#/join/MXK-492')).toEqual({ name: 'join', code: 'MXK-492' })
    expect(parseHash('#/join')).toEqual({ name: 'join', code: '' })
  })

  it('round-trips every route through hrefFor', () => {
    const routes: Route[] = [
      { name: 'landing' },
      { name: 'create' },
      { name: 'join', code: 'MXK-492' },
      { name: 'grade', sessionId: 'abc' },
      { name: 'results', sessionId: 'abc' },
      { name: 'settings', sessionId: 'abc' },
    ]
    for (const r of routes) {
      expect(parseHash(hrefFor(r))).toEqual(r)
    }
  })
})
