/** PINs and session codes.
 *
 *  The PIN is NOT a security boundary and is deliberately not hashed: the host
 *  needs to read PINs back to tell a grader what theirs is, which a hash makes
 *  impossible. Nothing is lost by this, because the session code has always
 *  been the real credential and the anon key could always read the graders
 *  table. The PIN's only job is stopping graders from submitting as each other
 *  by accident.
 */

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/** Credentials travel as HTTP request headers, and RFC 7230 requires servers
 *  to strip whitespace around a header value. A password stored with a leading
 *  or trailing space therefore can never be matched by any client: the space
 *  does not survive the request, so the session becomes permanently
 *  unjoinable. Everything that stores or sends a credential trims it first.
 *
 *  Internal spaces are preserved; only the ends are affected. */
export function normaliseCredential(value: string): string {
  return value.trim()
}

/** Minimum length is checked after trimming, so "   x" is not a valid
 *  four-character password. */
export const MIN_SESSION_PASSWORD_LENGTH = 4

export function isValidSessionPassword(value: string): boolean {
  return normaliseCredential(value).length >= MIN_SESSION_PASSWORD_LENGTH
}

/** Session codes avoid I, O, 0 and 1 so they survive being read aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateSessionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 3).join('')}-${chars.slice(3).join('')}`
}

/** Suggests a PIN for a grader the host has not chosen one for. */
export function generatePin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000
  return String(n).padStart(4, '0')
}
