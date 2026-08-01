/** Scryfall REST client.
 *
 *  Scryfall asks for 50-100ms between requests and a descriptive User-Agent.
 *  The delay is honoured below. The User-Agent is NOT set: `User-Agent` is a
 *  forbidden header name in the Fetch spec, so a browser silently drops any
 *  attempt to set it. The browser's own UA is sent instead, which Scryfall
 *  accepts. CORS is `Access-Control-Allow-Origin: *`, so no proxy is needed.
 */

const API = 'https://api.scryfall.com'
const MIN_INTERVAL_MS = 100

export class ScryfallError extends Error {
  // Declared as fields rather than constructor parameter properties: the
  // project builds with erasableSyntaxOnly, which forbids that shorthand.
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ScryfallError'
    this.status = status
    this.code = code
  }

  /** Scryfall returns 404 with code 'not_found' when a search matches nothing.
   *  That is a legitimate empty result, not a transport failure. */
  get isEmptySearch(): boolean {
    return this.status === 404 && this.code === 'not_found'
  }
}

let chain: Promise<unknown> = Promise.resolve()

/** Serialises every request through one queue with a fixed gap between them.
 *  Concurrent callers cannot outrun the rate limit. */
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const result = await fn()
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS))
    return result
  })
  // Keep the chain alive even if this link rejects.
  chain = run.catch(() => undefined)
  return run as Promise<T>
}

async function request<T>(url: string): Promise<T> {
  return throttle(async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    const body = (await res.json().catch(() => null)) as
      | (T & { object?: string; code?: string; details?: string })
      | null

    if (!res.ok || body?.object === 'error') {
      throw new ScryfallError(
        body?.details ?? `Scryfall request failed (${res.status})`,
        res.status,
        body?.code,
      )
    }
    if (body === null) throw new ScryfallError('Scryfall returned no body', res.status)
    return body
  })
}

// --- Raw response shapes (only the fields actually consumed) ---

export interface RawImageUris {
  small?: string
  normal?: string
  large?: string
  png?: string
  art_crop?: string
  border_crop?: string
}

export interface RawCardFace {
  name: string
  type_line?: string
  mana_cost?: string
  oracle_text?: string
  flavor_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  colors?: string[]
  image_uris?: RawImageUris
}

export interface RawCard {
  id: string
  name: string
  set: string
  collector_number: string
  rarity: string
  layout: string
  type_line?: string
  mana_cost?: string
  oracle_text?: string
  flavor_text?: string
  power?: string
  toughness?: string
  loyalty?: string
  defense?: string
  cmc?: number
  /** null on double-faced cards; colours live on the faces instead. */
  colors?: string[] | null
  color_identity?: string[]
  /** Absent on double-faced cards; images live on the faces instead. */
  image_uris?: RawImageUris
  card_faces?: RawCardFace[]
}

export interface RawSet {
  code: string
  name: string
  set_type: string
  parent_set_code?: string | null
  card_count: number
  digital: boolean
  released_at?: string
  icon_svg_uri?: string
}

interface SearchPage {
  data: RawCard[]
  has_more: boolean
  next_page?: string
  total_cards?: number
}

interface SetList {
  data: RawSet[]
}

// --- Endpoints ---

export function getSet(code: string): Promise<RawSet> {
  return request<RawSet>(`${API}/sets/${encodeURIComponent(code.toLowerCase())}`)
}

export function listSets(): Promise<RawSet[]> {
  return request<SetList>(`${API}/sets`).then((r) => r.data)
}

export interface SearchOptions {
  unique?: 'cards' | 'prints' | 'art'
  order?: 'set' | 'name' | 'released' | 'rarity' | 'color' | 'cmc'
  /** Called after each page so the UI can show progress. */
  onProgress?: (loaded: number, total: number | undefined) => void
  signal?: AbortSignal
}

/** Runs a search and follows `next_page` to completion.
 *  A search matching nothing resolves to [] rather than throwing. */
export async function searchAll(query: string, opts: SearchOptions = {}): Promise<RawCard[]> {
  const params = new URLSearchParams({
    q: query,
    unique: opts.unique ?? 'cards',
    order: opts.order ?? 'set',
  })
  let url: string | undefined = `${API}/cards/search?${params}`
  const out: RawCard[] = []

  try {
    while (url) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const page: SearchPage = await request<SearchPage>(url)
      out.push(...page.data)
      opts.onProgress?.(out.length, page.total_cards)
      url = page.has_more ? page.next_page : undefined
    }
  } catch (err) {
    if (err instanceof ScryfallError && err.isEmptySearch) return []
    throw err
  }
  return out
}

/** Counts results without downloading every page. Used to decide whether the
 *  `is:booster` filter has usable data for a set. */
export async function countMatches(query: string): Promise<number> {
  const params = new URLSearchParams({ q: query, unique: 'cards' })
  try {
    const page = await request<SearchPage>(`${API}/cards/search?${params}`)
    return page.total_cards ?? page.data.length
  } catch (err) {
    if (err instanceof ScryfallError && err.isEmptySearch) return 0
    throw err
  }
}
