/** PIN hashing.
 *
 *  This is NOT a security boundary. Anyone holding the session code can read
 *  the graders table through the anon key, and the PIN space is 10^4. Its only
 *  job is stopping graders from accidentally submitting as each other.
 *  Salting with the session id at least keeps hashes from being comparable
 *  across sessions. Do not present this to users as protection.
 */

export async function hashPin(pin: string, sessionId: string): Promise<string> {
  const data = new TextEncoder().encode(`mtglfg:${sessionId}:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/** Session codes avoid I, O, 0 and 1 so they survive being read aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateSessionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 3).join('')}-${chars.slice(3).join('')}`
}
