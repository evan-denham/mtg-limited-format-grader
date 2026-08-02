import { describe, expect, it } from 'vitest'
import {
  generatePin,
  generateSessionCode,
  isValidPin,
  isValidSessionPassword,
  normaliseCredential,
} from './pin'

describe('normaliseCredential', () => {
  it('strips surrounding whitespace', () => {
    // The bug this exists for: a session password saved as 'MirkwoodNurturer '
    // could never be matched, because HTTP strips whitespace around a header
    // value (RFC 7230), so the space never survived the request. The session
    // became permanently unjoinable by everyone including its host.
    expect(normaliseCredential('MirkwoodNurturer ')).toBe('MirkwoodNurturer')
    expect(normaliseCredential('  spaced  ')).toBe('spaced')
    expect(normaliseCredential('\tTabbed\n')).toBe('Tabbed')
  })

  it('preserves internal spaces, which are transmitted fine', () => {
    expect(normaliseCredential(' two words ')).toBe('two words')
  })

  it('is idempotent', () => {
    const once = normaliseCredential('  value  ')
    expect(normaliseCredential(once)).toBe(once)
  })

  it('a normalised credential survives an HTTP header round trip unchanged', () => {
    // Headers() applies the same stripping a server would. If these ever
    // disagree, a credential can be stored that can never be sent.
    for (const raw of ['MirkwoodNurturer ', ' lead', 'two words', 'plain']) {
      const value = normaliseCredential(raw)
      const received = new Headers({ 'x-test': value }).get('x-test')
      expect(received, `"${raw}" did not round trip`).toBe(value)
    }
  })
})

describe('isValidSessionPassword', () => {
  it('requires four characters after trimming', () => {
    expect(isValidSessionPassword('abcd')).toBe(true)
    expect(isValidSessionPassword('abc')).toBe(false)
    // Would be four characters untrimmed, but only one once sent.
    expect(isValidSessionPassword('   a')).toBe(false)
    expect(isValidSessionPassword('  abcd  ')).toBe(true)
  })
})

describe('isValidPin', () => {
  it('accepts exactly four digits', () => {
    expect(isValidPin('0000')).toBe(true)
    expect(isValidPin('4242')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const bad of ['123', '12345', 'abcd', '12 4', '', ' 123']) {
      expect(isValidPin(bad), bad).toBe(false)
    }
  })
})

describe('generatePin', () => {
  it('always produces four digits, including leading zeros', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isValidPin(generatePin())).toBe(true)
    }
  })
})

describe('generateSessionCode', () => {
  it('avoids characters that are ambiguous when read aloud', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateSessionCode()
      expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/)
      expect(code).not.toMatch(/[IO01]/)
    }
  })

  it('needs no trimming', () => {
    const code = generateSessionCode()
    expect(normaliseCredential(code)).toBe(code)
  })
})
