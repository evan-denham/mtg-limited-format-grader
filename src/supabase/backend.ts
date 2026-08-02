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
  findSessionByCode(code: string): Promise<{ id: string } | null>
  saveGrade(sessionId: string, grade: Grade): Promise<void>
  savePosition(sessionId: string, graderId: string, cardId: string): Promise<void>
  saveFollow(sessionId: string, graderId: string, followId: string | null): Promise<void>
  saveSettings(sessionId: string, settings: GradingSettings): Promise<void>
  claimGrader(sessionId: string, graderId: string, pin: string): Promise<'ok' | 'wrong-pin'>
  deleteSession(sessionId: string): Promise<void>
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
  subscribe() {
    return () => {}
  },
}

// --- Supabase implementation ---

function makeSupabaseBackend(): Backend {
  /** Row level security (migration 0003) checks a session id or code sent as a
   *  request header, and supabase-js fixes headers at construction, so every
   *  call resolves the client for its own session context. */
  const forSession = (sessionId: string) => {
    const c = clientFor({ sessionId })
    if (!c) throw new Error('Supabase is not configured')
    return c
  }
  const forCode = (code: string) => {
    const c = clientFor({ code })
    if (!c) throw new Error('Supabase is not configured')
    return c
  }

  return {
    configured: true,

    async createSession(args) {
      // The code is presented up front so the INSERT can return the new row:
      // RETURNING is subject to the select policy.
      const db = forCode(args.code)
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

    async findSessionByCode(code) {
      const db = forCode(code)
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

    async deleteSession(sessionId) {
      const { error } = await forSession(sessionId).from('sessions').delete().eq('id', sessionId)
      if (error) throw new Error(`Could not delete session: ${error.message}`)
    },

    subscribe(sessionId, handlers) {
      const db = forSession(sessionId)
      const channel = db
        .channel(`session:${sessionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'grades', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const row = payload.new as GradeRow
            if (row?.card_id) handlers.onGrade(toGrade(row))
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'graders', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const row = payload.new as GraderRow
            if (row?.id) handlers.onGrader(toGrader(row))
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
          (payload) => {
            const row = payload.new as SessionRow
            if (row?.settings) handlers.onSettings(row.settings)
          },
        )
        .subscribe()

      return () => {
        void db.removeChannel(channel)
      }
    },
  }
}

export const backend: Backend = isBackendConfigured ? makeSupabaseBackend() : localBackend
