/** Supabase client, created only when credentials are present.
 *
 *  The app is fully usable without them: every backend call degrades to a
 *  local-only no-op. That keeps the grading loop working offline and means
 *  a missing .env.local is a downgrade, not a crash.
 *
 *  VITE_SUPABASE_ANON_KEY is the anon/public key. It is designed to be shipped
 *  in a browser bundle. The service_role key must never appear here.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isBackendConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isBackendConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null

if (!isBackendConfigured && import.meta.env.DEV) {
  console.info(
    'Supabase not configured. Running local-only. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY in .env.local to enable multi-device sync.',
  )
}
