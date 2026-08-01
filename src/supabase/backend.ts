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
import { isBackendConfigured, supabase } from './client'
import { hashPin } from './pin'

export interface LoadedSession {
  meta: SessionMeta
  cards: CardRecord[]
  graders: Grader[]
  grades: Grade[]
}

export interface CreateSessionArgs {
  code: string
  name: string
  setCode: string
  setName: string
  bonusSets: BonusSet[]
  cards: CardRecord[]
  settings: GradingSettings
  graderNames: string[]
}

export interface Backend {
  readonly configured: boolean
  createSession(args: CreateSessionArgs): Promise<{ sessionId: string; graders: Grader[] } | null>
  loadSession(sessionId: string): Promise<LoadedSession | null>
  findSessionByCode(code: string): Promise<{ id: string } | null>
  saveGrade(sessionId: string, grade: Grade): Promise<void>
  savePosition(sessionId: string, graderId: string, cardId: string): Promise<void>
  saveFollow(sessionId: string, graderId: string, followId: string | null): Promise<void>
  saveSettings(sessionId: string, settings: GradingSettings): Promise<void>
  claimGrader(sessionId: string, graderId: string, pin: string): Promise<'ok' | 'wrong-pin'>
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
}

interface GraderRow {
  id: string
  session_id: string
  name: string
  pin_hash: string | null
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
  subscribe() {
    return () => {}
  },
}

// --- Supabase implementation ---

function makeSupabaseBackend(): Backend {
  const db = supabase
  if (!db) return localBackend

  return {
    configured: true,

    async createSession(args) {
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
          args.graderNames.map((name, i) => ({
            session_id: sessionId,
            name,
            accent: ACCENTS[i % ACCENTS.length],
          })),
        )
        .select('*')
      if (gErr) throw new Error(`Could not add graders: ${gErr.message}`)

      return { sessionId, graders: (graderRows as GraderRow[]).map(toGrader) }
    },

    async loadSession(sessionId) {
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
        },
        cards: row.cards ?? [],
        graders: ((graders ?? []) as GraderRow[]).map(toGrader),
        grades: ((grades ?? []) as GradeRow[]).map(toGrade),
      }
    },

    async findSessionByCode(code) {
      const { data } = await db
        .from('sessions')
        .select('id')
        .eq('code', code.trim().toUpperCase())
        .maybeSingle()
      return (data as { id: string } | null) ?? null
    },

    async saveGrade(sessionId, grade) {
      if (!sessionId) return
      const { error } = await db.from('grades').upsert(
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
      await db.from('graders').update({ current_card_id: cardId }).eq('id', graderId)
    },

    async saveFollow(sessionId, graderId, followId) {
      if (!sessionId) return
      await db.from('graders').update({ follow_id: followId }).eq('id', graderId)
    },

    async saveSettings(sessionId, settings) {
      if (!sessionId) return
      await db.from('sessions').update({ settings }).eq('id', sessionId)
    },

    async claimGrader(sessionId, graderId, pin) {
      const hash = await hashPin(pin, sessionId)
      const { data } = await db
        .from('graders')
        .select('pin_hash')
        .eq('id', graderId)
        .maybeSingle()
      const existing = (data as { pin_hash: string | null } | null)?.pin_hash ?? null

      if (existing === null) {
        await db.from('graders').update({ pin_hash: hash }).eq('id', graderId)
        return 'ok'
      }
      return existing === hash ? 'ok' : 'wrong-pin'
    },

    subscribe(sessionId, handlers) {
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
