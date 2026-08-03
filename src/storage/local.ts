/** localStorage persistence.
 *
 *  Two distinct jobs:
 *  1. The frozen card pool, cached by session id. It is immutable, so it is
 *     written once and re-read forever, avoiding a ~300KB fetch per load.
 *  2. Local session state, which is the whole store when running without a
 *     backend and the offline write-behind buffer once Supabase is wired up.
 */

import type { CardRecord, Grade, Grader, SessionMeta } from '../domain/types'

const POOL_PREFIX = 'mtglfg.pool.'
const SESSION_PREFIX = 'mtglfg.session.'
const INDEX_KEY = 'mtglfg.index'
const IDENTITY_PREFIX = 'mtglfg.identity.'
const PASSWORD_PREFIX = 'mtglfg.password.'
const ADMIN_KEY = 'mtglfg.admin'
const VIEW_TOKEN_PREFIX = 'mtglfg.view.'

export interface LocalSession {
  meta: SessionMeta
  graders: Grader[]
  grades: Grade[]
  updatedAt: number
}

export interface SessionIndexEntry {
  id: string
  code: string
  name: string
  setCode: string
  setName: string
  updatedAt: number
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Quota exceeded. The caller decides whether that is fatal.
    return false
  }
}

// --- Card pool (immutable, cached by session id) ---

export function loadPool(sessionId: string): CardRecord[] | null {
  return read<CardRecord[]>(POOL_PREFIX + sessionId)
}

export function savePool(sessionId: string, cards: CardRecord[]): boolean {
  return write(POOL_PREFIX + sessionId, cards)
}

// --- Session state ---

export function loadSession(sessionId: string): LocalSession | null {
  return read<LocalSession>(SESSION_PREFIX + sessionId)
}

export function saveSession(session: LocalSession): boolean {
  const ok = write(SESSION_PREFIX + session.meta.id, session)
  if (ok) touchIndex(session)
  return ok
}

export function deleteSession(sessionId: string): void {
  localStorage.removeItem(SESSION_PREFIX + sessionId)
  localStorage.removeItem(POOL_PREFIX + sessionId)
  localStorage.removeItem(IDENTITY_PREFIX + sessionId)
  localStorage.removeItem(PASSWORD_PREFIX + sessionId)
  localStorage.removeItem(VIEW_TOKEN_PREFIX + sessionId)
  write(
    INDEX_KEY,
    listSessions().filter((s) => s.id !== sessionId),
  )
}

// --- Index of known sessions, for the landing screen ---

export function listSessions(): SessionIndexEntry[] {
  return (read<SessionIndexEntry[]>(INDEX_KEY) ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
}

function touchIndex(session: LocalSession): void {
  const entry: SessionIndexEntry = {
    id: session.meta.id,
    code: session.meta.code,
    name: session.meta.name,
    setCode: session.meta.setCode,
    setName: session.meta.setName,
    updatedAt: session.updatedAt,
  }
  const rest = listSessions().filter((s) => s.id !== entry.id)
  write(INDEX_KEY, [entry, ...rest])
}

export function findSessionByCode(code: string): SessionIndexEntry | null {
  const needle = code.trim().toUpperCase()
  return listSessions().find((s) => s.code.toUpperCase() === needle) ?? null
}

// --- Which grader this device is signed in as ---

export interface Identity {
  graderId: string
  graderName: string
}

export function loadIdentity(sessionId: string): Identity | null {
  return read<Identity>(IDENTITY_PREFIX + sessionId)
}

export function saveIdentity(sessionId: string, identity: Identity): void {
  write(IDENTITY_PREFIX + sessionId, identity)
}

export function clearIdentity(sessionId: string): void {
  localStorage.removeItem(IDENTITY_PREFIX + sessionId)
}


// --- Session password ---
// Kept so a reload does not re-prompt. It is the shared grading password, not
// an admin credential.

export function loadSessionPassword(sessionId: string): string | null {
  try {
    return localStorage.getItem(PASSWORD_PREFIX + sessionId)
  } catch {
    return null
  }
}

export function saveSessionPassword(sessionId: string, password: string): void {
  try {
    localStorage.setItem(PASSWORD_PREFIX + sessionId, password)
  } catch {
    /* quota; the user will be prompted again next load */
  }
}

export function clearSessionPassword(sessionId: string): void {
  localStorage.removeItem(PASSWORD_PREFIX + sessionId)
  localStorage.removeItem(VIEW_TOKEN_PREFIX + sessionId)
}

// --- Admin password ---
// sessionStorage, not localStorage: it is discarded when the tab closes rather
// than persisting on a shared machine.

export function loadAdminPassword(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY)
  } catch {
    return null
  }
}

export function saveAdminPassword(password: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY, password)
  } catch {
    /* ignore */
  }
}

export function clearAdminPassword(): void {
  try {
    sessionStorage.removeItem(ADMIN_KEY)
  } catch {
    /* ignore */
  }
}

// --- UI preferences ---
// Per-device, not per-session: how someone likes the grading bar is a property
// of their screen, not of the set being graded.

const GRADE_BAR_KEY = 'mtglfg.ui.gradeBarOpen'

export function loadGradeBarOpen(): boolean {
  try {
    // Default open. Only an explicit "0" collapses it, so a cleared or
    // corrupt value fails toward the controls being visible.
    return localStorage.getItem(GRADE_BAR_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveGradeBarOpen(open: boolean): void {
  try {
    localStorage.setItem(GRADE_BAR_KEY, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}


// --- Read-only view token ---
// Kept so a share link survives a reload without the token staying in the URL.

export function loadViewToken(sessionId: string): string | null {
  try {
    return localStorage.getItem(VIEW_TOKEN_PREFIX + sessionId)
  } catch {
    return null
  }
}

export function saveViewToken(sessionId: string, token: string): void {
  try {
    localStorage.setItem(VIEW_TOKEN_PREFIX + sessionId, token)
  } catch {
    /* ignore */
  }
}
