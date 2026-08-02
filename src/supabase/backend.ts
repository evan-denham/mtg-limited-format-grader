/** Persistence boundary. One interface, two implementations.
 *
 *  Every method is safe to call when Supabase is unconfigured: the local
 *  implementation no-ops on writes and returns null on loads, so the caller
 *  falls back to localStorage without branching on configuration anywhere else.
 */

import type {
  BonusSet,
  CardRecord,
  Grade,
  Grader,
  GradingSettings,
  SessionMeta,
} from '../domain/types'
import { clientFor, isBackendConfigured } from './client'
import * as local from '../storage/local'

export interface LoadedSession {
  meta: SessionMeta
  cards: CardRecord[]
  graders: Grader[]
  grades: Grade[]
}

export interface NewGrader {
  name: string
  pin: string
}

export interface CreateSessionArgs {
  code: string
  /** Shared password graders must supply to join. */
  joinPassword: string
  /** Verified inside Postgres; only an admin may create a session. */
  adminPassword: string
  name: string
  setCode: string
  setName: string
  bonusSets: BonusSet[]
  cards: CardRecord[]
  settings: GradingSettings
  graders: NewGrader[]
  /** Index into `graders` of the person creating the session. */
  hostIndex: number
}

export interface Backend {
  readonly configured: boolean
  createSession(
    args: CreateSessionArgs,
  ): Promise<{ sessionId: string; graders: Grader[]; hostGraderId: string } | null>
  loadSession(sessionId: string): Promise<LoadedSession | null>
  findSessionByCode(code: string, password: string): Promise<{ id: string } | null>
  saveGrade(sessionId: string, grade: Grade): Promise<void>
  savePosition(sessionId: string, graderId: string, cardId: string): Promise<void>
  saveFollow(sessionId: string, graderId: string, followId: string | null): Promise<void>
  saveSettings(sessionId: string, settings: GradingSettings): Promise<void>
  claimGrader(sessionId: string, graderId: string, pin: string): Promise<'ok' | 'wrong-pin'>
  deleteSession(sessionId: string, adminPassword: string): Promise<void>
  /** Adds a grader to a session already in progress. Admin-only, matching the
   *  policy on inserts into `graders`. */
  addGrader(args: {
    sessionId: string
    name: string
    pin: string
    accentIndex: number
    adminPassword: string
  }): Promise<Grader | null>
  subscribe(sessionId: string, handlers: RealtimeHandlers): () => void
}

export interface RealtimeHandlers {
  onGrade(grade: Grade): void
  onGrader(grader: Grader): void
  onSettings(settings: GradingSettings): void
}

// --- Row shapes ---

interface SessionRow {
  id: string
  code: string
  join_password: string
  name: string
  set_code: string
  set_name: string
  bonus_sets: BonusSet[]
  cards: CardRecord[]
  settings: GradingSettings
  host_grader_id: string | null
}

interface GraderRow {
  id: string
  session_id: string
  name: string
  pin: string | null
  current_card_id: string | null
  follow_id: string | null
  accent: string
}

interface GradeRow {
  session_id: string
  grader_id: string
  card_id: string
  updated_at: string
  grade: string | null
  is_buildaround: boolean
  buildaround_grade: string | null
  notes: string | null
}

const toGrader = (r: GraderRow): Grader => ({
  id: r.id,
  name: r.name,
  currentCardId: r.current_card_id,
  followId: r.follow_id,
  accent: r.accent,
  pin: r.pin ?? null,
})

const toGrade = (r: GradeRow): Grade => ({
  cardId: r.card_id,
  graderId: r.grader_id,
  grade: (r.grade as Grade['grade']) ?? null,
  isBuildaround: r.is_buildaround,
  buildaroundGrade: (r.buildaround_grade as Grade['grade']) ?? null,
  notes: r.notes ?? '',
})

/** How often a client checks for other graders' changes. */
const POLL_INTERVAL_MS = 4000
/** Rewind on the first poll to absorb client/server clock skew. */
const SKEW_MARGIN_MS = 60_000

const ACCENTS = ['#c8a15a', '#6aa9d6', '#c26b6b', '#7fb87f', '#a98ac9', '#d1985c']

// --- Local-only fallback ---

const localBackend: Backend = {
  configured: false,
  async createSession() {
    return null
  },
  async loadSession() {
    return null
  },
  async findSessionByCode() {
    return null
  },
  async saveGrade() {},
  async savePosition() {},
  async saveFollow() {},
  async saveSettings() {},
  async claimGrader() {
    return 'ok'
  },
  async deleteSession() {},
  async addGrader() {
    return null
  },
  subscribe() {
    return () => {}
  },
}

// --- Supabase implementation ---

function makeSupabaseBackend(): Backend {
  /** Row level security (migration 0003) checks a session id or code sent as a
   *  request header, and supabase-js fixes headers at construction, so every
   *  call resolves the client for its own session context. */
  const need = (c: ReturnType<typeof clientFor>) => {
    if (!c) throw new Error('Supabase is not configured')
    return c
  }
  /** The session password is read from storage so callers do not each have to
   *  thread it through. It is put there by the unlock flow on join. */
  const forSession = (sessionId: string) =>
    need(clientFor({ sessionId, password: local.loadSessionPassword(sessionId) }))
  const forCode = (code: string, password: string) => need(clientFor({ code, password }))
  const asAdmin = (adminPassword: string, extra: { sessionId?: string; code?: string } = {}) =>
    need(clientFor({ ...extra, adminPassword }))

  return {
    configured: true,

    async createSession(args) {
      // Admin credentials authorise the insert, and the select policy that
      // RETURNING depends on also accepts an admin.
      const db = asAdmin(args.adminPassword, { code: args.code })
      const { data: session, error } = await db
        .from('sessions')
        .insert({
          code: args.code,
          name: args.name,
          set_code: args.setCode,
          set_name: args.setName,
          bonus_sets: args.bonusSets,
          cards: args.cards,
          settings: args.settings,
          join_password: args.joinPassword,
        })
        .select('id')
        .single()
      if (error) throw new Error(`Could not create session: ${error.message}`)

      const sessionId = (session as { id: string }).id
      const { data: graderRows, error: gErr } = await db
        .from('graders')
        .insert(
          args.graders.map((g, i) => ({
            session_id: sessionId,
            name: g.name,
            pin: g.pin,
            accent: ACCENTS[i % ACCENTS.length],
          })),
        )
        .select('*')
      if (gErr) throw new Error(`Could not add graders: ${gErr.message}`)

      // Insert order is not guaranteed to be returned order, so resolve the
      // host by name rather than by position.
      const graders = (graderRows as GraderRow[]).map(toGrader)
      const hostName = args.graders[args.hostIndex]?.name
      const hostGraderId = graders.find((g) => g.name === hostName)?.id ?? graders[0].id

      await db.from('sessions').update({ host_grader_id: hostGraderId }).eq('id', sessionId)

      return { sessionId, graders, hostGraderId }
    },

    async loadSession(sessionId) {
      const db = forSession(sessionId)
      const { data: s, error } = await db
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()
      if (error || !s) return null
      const row = s as SessionRow

      const [{ data: graders }, { data: grades }] = await Promise.all([
        db.from('graders').select('*').eq('session_id', sessionId).order('name'),
        db.from('grades').select('*').eq('session_id', sessionId),
      ])

      return {
        meta: {
          id: row.id,
          code: row.code,
          name: row.name,
          setCode: row.set_code,
          setName: row.set_name,
          bonusSets: row.bonus_sets ?? [],
          settings: row.settings,
          hostGraderId: row.host_grader_id ?? null,
        },
        cards: row.cards ?? [],
        graders: ((graders ?? []) as GraderRow[]).map(toGrader),
        grades: ((grades ?? []) as GradeRow[]).map(toGrade),
      }
    },

    async findSessionByCode(code, password) {
      const db = forCode(code, password)
      const { data } = await db
        .from('sessions')
        .select('id')
        .eq('code', code.trim().toUpperCase())
        .maybeSingle()
      return (data as { id: string } | null) ?? null
    },

    async saveGrade(sessionId, grade) {
      if (!sessionId) return
      const { error } = await forSession(sessionId).from('grades').upsert(
        {
          session_id: sessionId,
          grader_id: grade.graderId,
          card_id: grade.cardId,
          grade: grade.grade,
          is_buildaround: grade.isBuildaround,
          buildaround_grade: grade.buildaroundGrade,
          notes: grade.notes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id,grader_id,card_id' },
      )
      if (error) console.error('saveGrade failed', error.message)
    },

    async savePosition(sessionId, graderId, cardId) {
      if (!sessionId) return
      await forSession(sessionId)
        .from('graders')
        .update({ current_card_id: cardId })
        .eq('id', graderId)
    },

    async saveFollow(sessionId, graderId, followId) {
      if (!sessionId) return
      await forSession(sessionId).from('graders').update({ follow_id: followId }).eq('id', graderId)
    },

    async saveSettings(sessionId, settings) {
      if (!sessionId) return
      await forSession(sessionId).from('sessions').update({ settings }).eq('id', sessionId)
    },

    async addGrader({ sessionId, name, pin, accentIndex, adminPassword }) {
      const db = asAdmin(adminPassword, { sessionId })
      const { data, error } = await db
        .from('graders')
        .insert({
          session_id: sessionId,
          name,
          pin,
          accent: ACCENTS[accentIndex % ACCENTS.length],
        })
        .select('*')
        .single()

      if (error) {
        // 23505 is the unique(session_id, name) constraint.
        if (error.code === '23505') {
          throw new Error(`There is already a grader called "${name}" in this session.`)
        }
        if (/row-level security|policy/i.test(error.message)) {
          throw new Error('The admin password was not accepted, so no grader was added.')
        }
        throw new Error(`Could not add grader: ${error.message}`)
      }
      return toGrader(data as GraderRow)
    },

    async claimGrader(sessionId, graderId, pin) {
      const db = forSession(sessionId)
      const { data } = await db.from('graders').select('pin').eq('id', graderId).maybeSingle()
      const existing = (data as { pin: string | null } | null)?.pin ?? null

      // Sessions created before PINs were assigned up front have none set;
      // the first person to claim the slot sets it.
      if (existing === null) {
        await db.from('graders').update({ pin }).eq('id', graderId)
        return 'ok'
      }
      return existing === pin ? 'ok' : 'wrong-pin'
    },

    async deleteSession(sessionId, adminPassword) {
      const db = asAdmin(adminPassword, { sessionId })
      const { error } = await db.from('sessions').delete().eq('id', sessionId)
      if (error) throw new Error(`Could not delete session: ${error.message}`)

      // RLS turns an unauthorised delete into a no-op rather than an error, so
      // confirm the row is actually gone instead of trusting the status.
      const { data } = await db.from('sessions').select('id').eq('id', sessionId).maybeSingle()
      if (data) throw new Error('Delete was refused. Check the admin password.')
    },

    /** Polling, not Realtime.
     *
     *  Realtime evaluates row level security from the connection JWT and never
     *  sees the PostgREST request headers these policies depend on, so a
     *  subscription reports SUBSCRIBED then immediately CLOSED and no change
     *  is ever delivered. Verified against the live project by
     *  scripts/verify-rls.ts. Polling is the workable alternative; a few
     *  seconds of latency is imperceptible while grading.
     */
    subscribe(sessionId, handlers) {
      const db = forSession(sessionId)
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined

      // Start slightly in the past so clock skew between this device and the
      // database cannot cause the first poll to miss a recent write.
      let since = new Date(Date.now() - SKEW_MARGIN_MS).toISOString()

      // Only emit rows that actually changed, or every poll would replace
      // objects in the store and re-render the whole screen on a timer.
      const graderSnapshots = new Map<string, string>()
      let settingsSnapshot = ''

      const poll = async () => {
        try {
          const { data: gradeRows } = await db
            .from('grades')
            .select('*')
            .eq('session_id', sessionId)
            .gt('updated_at', since)

          for (const row of (gradeRows ?? []) as GradeRow[]) {
            handlers.onGrade(toGrade(row))
            if (row.updated_at > since) since = row.updated_at
          }

          const { data: graderRows } = await db
            .from('graders')
            .select('*')
            .eq('session_id', sessionId)

          for (const row of (graderRows ?? []) as GraderRow[]) {
            const fingerprint = JSON.stringify(row)
            if (graderSnapshots.get(row.id) !== fingerprint) {
              graderSnapshots.set(row.id, fingerprint)
              handlers.onGrader(toGrader(row))
            }
          }

          const { data: sessionRow } = await db
            .from('sessions')
            .select('settings')
            .eq('id', sessionId)
            .maybeSingle()

          const settings = (sessionRow as { settings: GradingSettings } | null)?.settings
          if (settings) {
            const fingerprint = JSON.stringify(settings)
            if (settingsSnapshot && settingsSnapshot !== fingerprint) {
              handlers.onSettings(settings)
            }
            settingsSnapshot = fingerprint
          }
        } catch {
          // Transient failure; the next tick retries rather than tearing down.
        }
      }

      const tick = async () => {
        if (stopped) return
        // Skip work for a backgrounded tab; catch up when it returns.
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          await poll()
        }
        if (!stopped) timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
      }

      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)

      return () => {
        stopped = true
        if (timer) clearTimeout(timer)
      }
    },
  }
}

export const backend: Backend = isBackendConfigured ? makeSupabaseBackend() : localBackend
