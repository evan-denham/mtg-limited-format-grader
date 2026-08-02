/** Supabase clients, created only when credentials are present.
 *
 *  The app is fully usable without them: every backend call degrades to a
 *  local-only no-op. That keeps the grading loop working offline and means a
 *  missing .env.local is a downgrade, not a crash.
 *
 *  VITE_SUPABASE_ANON_KEY is the anon/public key. It is designed to be shipped
 *  in a browser bundle. The service_role key must never appear here.
 *
 *  Since migration 0003 the anon key alone grants nothing: row level security
 *  requires the caller to also present the session id or session code as a
 *  request header. supabase-js fixes headers at client construction, so a
 *  client is built per session context and cached.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isBackendConfigured = Boolean(url && anonKey)

export interface SessionContext {
  sessionId?: string | null
  code?: string | null
  /** Per-session password. Required by RLS since migration 0004. */
  password?: string | null
  /** Admin password. Required to create or delete sessions. Never persisted
   *  to localStorage and never part of the bundle: it is typed each time and
   *  compared inside Postgres. */
  adminPassword?: string | null
}

const cache = new Map<string, SupabaseClient>()

function contextKey(ctx: SessionContext): string {
  // Trim before keying too, or "pw" and "pw " would cache as different
  // clients that then send identical headers.
  return [ctx.sessionId ?? '', ctx.code ?? '', ctx.password ?? '', ctx.adminPassword ?? '']
    .map((v) => v.trim())
    .join('|')
}

/** A client carrying the headers the RLS policies check. Cached per context so
 *  repeated calls reuse one connection rather than opening a new one each time. */
export function clientFor(ctx: SessionContext = {}): SupabaseClient | null {
  if (!isBackendConfigured) return null

  const key = contextKey(ctx)
  const existing = cache.get(key)
  if (existing) return existing

  // Trimmed here as the last line of defence. HTTP strips whitespace around a
  // header value anyway (RFC 7230), so an untrimmed credential silently
  // becomes a different string in transit and never matches. Normalising at
  // the one place headers are built means no caller can reintroduce it.
  const headers: Record<string, string> = {}
  if (ctx.sessionId) headers['x-session-id'] = ctx.sessionId.trim()
  if (ctx.code) headers['x-session-code'] = ctx.code.trim()
  if (ctx.password) headers['x-session-password'] = ctx.password.trim()
  if (ctx.adminPassword) headers['x-admin-password'] = ctx.adminPassword.trim()

  const client = createClient(url as string, anonKey as string, {
    auth: { persistSession: false },
    global: { headers },
    realtime: { params: { eventsPerSecond: 5 } },
  })

  // Unbounded growth is not a concern: one entry per session touched per page
  // load, and the page is not long-lived enough for that to matter.
  cache.set(key, client)
  return client
}

if (!isBackendConfigured && import.meta.env.DEV) {
  console.info(
    'Supabase not configured. Running local-only. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY in .env.local to enable multi-device sync.',
  )
}
