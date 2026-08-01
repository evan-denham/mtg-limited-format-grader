/** The single source of truth for an active grading session.
 *
 *  Writes go to localStorage immediately and, when a backend is configured,
 *  are mirrored to Supabase. Remote changes are applied through applyRemote*
 *  so the reducer logic stays in one place regardless of origin.
 */

import { create } from 'zustand'
import type {
  CardRecord,
  Grade,
  GradeLetter,
  Grader,
  GradingSettings,
  SessionMeta,
} from '../domain/types'
import { orderCards } from '../domain/ordering'
import * as local from '../storage/local'
import { backend } from '../supabase/backend'

export interface SessionState {
  meta: SessionMeta | null
  cards: CardRecord[]
  graders: Grader[]
  /** Keyed `${graderId}:${cardId}` for O(1) lookup during grading. */
  grades: Record<string, Grade>
  meId: string | null
  loading: boolean
  error: string | null

  load: (sessionId: string) => Promise<void>
  hydrate: (args: {
    meta: SessionMeta
    cards: CardRecord[]
    graders: Grader[]
    grades: Grade[]
    meId: string | null
  }) => void
  setMe: (graderId: string) => void
  setGrade: (cardId: string, patch: Partial<Omit<Grade, 'cardId' | 'graderId'>>) => void
  setPosition: (cardId: string) => void
  setFollow: (targetId: string | null) => void
  updateSettings: (patch: Partial<GradingSettings>) => void
  applyRemoteGrade: (grade: Grade) => void
  applyRemoteGrader: (grader: Grader) => void
  applyRemoteSettings: (settings: GradingSettings) => void
  reset: () => void
}

export const gradeKey = (graderId: string, cardId: string) => `${graderId}:${cardId}`

function persist(state: SessionState): void {
  if (!state.meta) return
  local.saveSession({
    meta: state.meta,
    graders: state.graders,
    grades: Object.values(state.grades),
    updatedAt: Date.now(),
  })
}

const blankGrade = (graderId: string, cardId: string): Grade => ({
  cardId,
  graderId,
  grade: null,
  isBuildaround: false,
  buildaroundGrade: null,
  notes: '',
})

export const useSession = create<SessionState>((set, get) => ({
  meta: null,
  cards: [],
  graders: [],
  grades: {},
  meId: null,
  loading: false,
  error: null,

  async load(sessionId) {
    set({ loading: true, error: null })
    try {
      const remote = await backend.loadSession(sessionId)
      if (remote) {
        local.savePool(remote.meta.id, remote.cards)
        get().hydrate({ ...remote, meId: local.loadIdentity(sessionId)?.graderId ?? null })
        set({ loading: false })
        return
      }

      const stored = local.loadSession(sessionId)
      const cards = local.loadPool(sessionId)
      if (!stored || !cards) {
        set({ loading: false, error: 'Session not found on this device.' })
        return
      }
      get().hydrate({
        meta: stored.meta,
        cards,
        graders: stored.graders,
        grades: stored.grades,
        meId: local.loadIdentity(sessionId)?.graderId ?? null,
      })
      set({ loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  hydrate({ meta, cards, graders, grades, meId }) {
    const map: Record<string, Grade> = {}
    for (const g of grades) map[gradeKey(g.graderId, g.cardId)] = g
    set({ meta, cards, graders, grades: map, meId, error: null })
  },

  setMe(graderId) {
    const { meta } = get()
    if (meta) {
      const grader = get().graders.find((g) => g.id === graderId)
      local.saveIdentity(meta.id, { graderId, graderName: grader?.name ?? '' })
    }
    set({ meId: graderId })
  },

  setGrade(cardId, patch) {
    const { meId, grades } = get()
    if (!meId) return
    const key = gradeKey(meId, cardId)
    const next: Grade = { ...(grades[key] ?? blankGrade(meId, cardId)), ...patch }

    // Clearing the build-around flag must clear its grade too, otherwise a
    // stale build-around grade survives into the exports.
    if (next.isBuildaround === false) next.buildaroundGrade = null

    set({ grades: { ...grades, [key]: next } })
    persist(get())
    void backend.saveGrade(get().meta?.id ?? '', next)
  },

  setPosition(cardId) {
    const { meId, graders } = get()
    if (!meId) return
    const nextGraders = graders.map((g) =>
      g.id === meId ? { ...g, currentCardId: cardId } : g,
    )
    set({ graders: nextGraders })
    persist(get())
    void backend.savePosition(get().meta?.id ?? '', meId, cardId)
  },

  setFollow(targetId) {
    const { meId, graders } = get()
    if (!meId) return
    // Following yourself would deadlock the position sync.
    const safe = targetId === meId ? null : targetId
    const nextGraders = graders.map((g) => (g.id === meId ? { ...g, followId: safe } : g))
    set({ graders: nextGraders })
    persist(get())
    void backend.saveFollow(get().meta?.id ?? '', meId, safe)
  },

  updateSettings(patch) {
    const { meta } = get()
    if (!meta) return
    const next: SessionMeta = { ...meta, settings: { ...meta.settings, ...patch } }
    set({ meta: next })
    persist(get())
    void backend.saveSettings(meta.id, next.settings)
  },

  applyRemoteGrade(grade) {
    set((s) => ({ grades: { ...s.grades, [gradeKey(grade.graderId, grade.cardId)]: grade } }))
    persist(get())
  },

  applyRemoteGrader(grader) {
    set((s) => {
      const exists = s.graders.some((g) => g.id === grader.id)
      return {
        graders: exists
          ? s.graders.map((g) => (g.id === grader.id ? grader : g))
          : [...s.graders, grader],
      }
    })
    persist(get())
  },

  applyRemoteSettings(settings) {
    set((s) => (s.meta ? { meta: { ...s.meta, settings } } : {}))
    persist(get())
  },

  reset() {
    set({ meta: null, cards: [], graders: [], grades: {}, meId: null, error: null })
  },
}))

// --- Derived selectors ---

export function useOrderedCards(): CardRecord[] {
  const cards = useSession((s) => s.cards)
  const settings = useSession((s) => s.meta?.settings)
  if (!settings) return cards
  return orderCards(cards, settings)
}

export function useMe(): Grader | null {
  const meId = useSession((s) => s.meId)
  const graders = useSession((s) => s.graders)
  return graders.find((g) => g.id === meId) ?? null
}

export function useMyGrade(cardId: string | null): Grade | null {
  const meId = useSession((s) => s.meId)
  const grades = useSession((s) => s.grades)
  if (!meId || !cardId) return null
  return grades[gradeKey(meId, cardId)] ?? null
}

/** Grades for one card across every grader, in roster order. */
export function gradesForCard(
  grades: Record<string, Grade>,
  graders: readonly Grader[],
  cardId: string,
): (Grade | null)[] {
  return graders.map((g) => grades[gradeKey(g.id, cardId)] ?? null)
}

export function gradeLettersForCard(
  grades: Record<string, Grade>,
  graders: readonly Grader[],
  cardId: string,
): (GradeLetter | null)[] {
  return gradesForCard(grades, graders, cardId).map((g) => g?.grade ?? null)
}
