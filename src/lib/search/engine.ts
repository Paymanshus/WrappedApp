import type { MsgType } from '../types'

// Find: full-text search over a chat, built for chat language. Pure (no DB), so it runs in the
// search worker and in node tests.
//
//  • Index: an inverted index per chat (term → doc ids + term frequency), a sorted vocabulary for
//    prefix matches, and per-message hour/weekday/kind flags for filters.
//  • Ranking: BM25 tuned for short texts, where every query word picks its best match among
//    exact (1.0), prefix (0.7, "goa" → "goan") and typo-tolerant (0.45, "achha" ≈ "acha")
//    spellings, plus a phrase bonus, a gentle recency lift and a penalty for system lines.
//  • Query syntax: "exact phrase", -exclude, from:name, before:/after:/during: dates,
//    has:photo|video|voice|sticker|doc|link|location|media, is:question|deleted.

export type Kind = 'text' | 'photo' | 'video' | 'voice' | 'sticker' | 'doc' | 'link' | 'location' | 'deleted'

export interface Filters {
  people?: string[]
  from?: number            // epoch ms, inclusive
  to?: number              // epoch ms, inclusive
  kinds?: Kind[]           // any of
  hours?: [number, number] // [start, end) local hours; wraps past midnight when start > end
  days?: number[]          // weekdays, 0 = Sunday
  minWords?: number
  questions?: boolean
  system?: boolean         // include system lines ("X added Y")
}

export interface SearchOptions {
  match: 'all' | 'any' | 'phrase'
  fuzzy: boolean
  whole: boolean           // whole words only: no prefix matches
  sort: 'best' | 'newest' | 'oldest' | 'longest'
}

export const DEFAULT_OPTIONS: SearchOptions = { match: 'all', fuzzy: true, whole: false, sort: 'best' }

export interface Doc { id: number; chatId: number; ts: number; sender: string; text: string; type: MsgType; mediaKey?: string }
export interface Hit { doc: Doc; score: number }

export interface ParsedQuery {
  terms: string[]
  phrases: string[][]
  not: string[]
  filters: Filters          // from operators typed in the box
  people: string[]          // raw from: values, before resolving to names
}

export interface SearchResult {
  total: number
  hits: Hit[]
  terms: string[]           // every spelling that matched, for highlighting
  months: [string, number][]   // 'YYYY-MM' → matches, chronological, gaps filled
  people: [string, number][]   // sender → matches, most first
  chats: [number, number][]
  hours: number[]           // 24 buckets
  weekdays: number[]        // 7 buckets, 0 = Sunday
  days: number              // distinct calendar days with a match
  parsed: ParsedQuery
  ms: number
}

// ---------- text ----------

/** Lowercase, strip Latin accents (é → e) without touching other scripts' vowel marks. */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*|\p{Extended_Pictographic}/gu

/** Words (apostrophes dropped, so "don't" = "dont") and emoji, each its own token. */
export function tokenize(s: string): string[] {
  const out: string[] = []
  for (const m of fold(s).matchAll(WORD)) out.push(m[0].replace(/['’]/g, ''))
  return out
}

const LINK = /https?:\/\/\S+/i

export function kindsOf(d: Pick<Doc, 'type' | 'text'>): Kind[] {
  switch (d.type) {
    case 'image': return ['photo']
    case 'video': return ['video']
    case 'audio': return ['voice']
    case 'sticker': case 'gif': return ['sticker']
    case 'doc': case 'contact': return ['doc']
    case 'location': return ['location']
    case 'deleted': return ['deleted']
    case 'system': return []
    default: return LINK.test(d.text) ? ['text', 'link'] : ['text']
  }
}

// ---------- index ----------

const KIND_BIT: Record<Kind, number> = { text: 1, photo: 2, video: 4, voice: 8, sticker: 16, doc: 32, link: 64, location: 128, deleted: 256 }

export class ChatIndex {
  readonly docs: Doc[]
  readonly norm: string[]
  readonly len: Uint16Array
  readonly hour: Uint8Array
  readonly dow: Uint8Array
  readonly kind: Uint16Array
  readonly byId = new Map<number, number>()
  readonly post = new Map<string, { ids: Int32Array; tf: Uint8Array }>()
  readonly vocab: string[]
  readonly avgLen: number
  readonly senders: string[]

  /** docs must be sorted by ts ascending. */
  constructor(docs: Doc[]) {
    this.docs = docs
    const n = docs.length
    this.norm = new Array(n)
    this.len = new Uint16Array(n)
    this.hour = new Uint8Array(n)
    this.dow = new Uint8Array(n)
    this.kind = new Uint16Array(n)
    const ids = new Map<string, number[]>(), tfs = new Map<string, number[]>()
    const senders = new Set<string>()
    let total = 0
    for (let i = 0; i < n; i++) {
      const d = docs[i]
      this.byId.set(d.id, i)
      if (d.sender) senders.add(d.sender)
      const date = new Date(d.ts)
      this.hour[i] = date.getHours()
      this.dow[i] = date.getDay()
      this.kind[i] = kindsOf(d).reduce((b, k) => b | KIND_BIT[k], 0)
      this.norm[i] = fold(d.text)
      const toks = tokenize(d.text)
      this.len[i] = Math.min(65535, toks.length)
      total += toks.length
      for (const t of toks) {
        let a = ids.get(t)
        if (!a) { a = []; ids.set(t, a); tfs.set(t, []) }
        const f = tfs.get(t)!
        if (a[a.length - 1] === i) f[f.length - 1] = Math.min(255, f[f.length - 1] + 1)
        else { a.push(i); f.push(1) }
      }
    }
    for (const [t, a] of ids) this.post.set(t, { ids: Int32Array.from(a), tf: Uint8Array.from(tfs.get(t)!) })
    this.vocab = [...ids.keys()].sort()
    this.avgLen = n ? Math.max(1, total / n) : 1
    this.senders = [...senders]
  }

  /** Vocabulary words starting with p (binary search on the sorted vocab). */
  prefixed(p: string, cap = 40): string[] {
    let lo = 0, hi = this.vocab.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.vocab[mid] < p) lo = mid + 1; else hi = mid }
    const out: string[] = []
    for (let i = lo; i < this.vocab.length && this.vocab[i].startsWith(p); i++) if (this.vocab[i] !== p) out.push(this.vocab[i])
    // keep the most common spellings when a short prefix matches thousands
    return out.length > cap ? out.sort((a, b) => this.post.get(b)!.ids.length - this.post.get(a)!.ids.length).slice(0, cap) : out
  }

  /** Vocabulary words within a small edit distance (typos, transliteration variants). */
  near(t: string, cap = 20): string[] {
    if (t.length < 4 || /\p{Extended_Pictographic}/u.test(t)) return []
    const max = t.length >= 8 ? 2 : 1
    const out: string[] = []
    for (const v of this.vocab) {
      if (v === t || Math.abs(v.length - t.length) > max) continue
      if (v[0] !== t[0] && max === 1) continue
      if (osa(t, v, max) <= max) out.push(v)
    }
    return out.sort((a, b) => this.post.get(b)!.ids.length - this.post.get(a)!.ids.length).slice(0, cap)
  }

  /** Messages around a message (by id): `before` older ones, the message, `after` newer ones. */
  context(id: number, before: number, after: number): Doc[] {
    const i = this.byId.get(id)
    if (i == null) return []
    return this.docs.slice(Math.max(0, i - before), i + after + 1)
  }

  /** Messages in a time range, oldest first. */
  range(from: number, to: number, limit: number, offset = 0): { docs: Doc[]; total: number } {
    const a = lowerBound(this.docs, from), b = lowerBound(this.docs, to + 1)
    return { docs: this.docs.slice(a + offset, Math.min(b, a + offset + limit)), total: b - a }
  }
}

function lowerBound(docs: Doc[], ts: number) {
  let lo = 0, hi = docs.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (docs[mid].ts < ts) lo = mid + 1; else hi = mid }
  return lo
}

/** Optimal-string-alignment distance with an early exit once every cell exceeds max. */
export function osa(a: string, b: string, max: number): number {
  const m = a.length, n = b.length
  let prev2 = new Array(n + 1).fill(0), prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    let best = cur[0]
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < best) best = v
    }
    if (best > max) return max + 1
    ;[prev2, prev, cur] = [prev, cur, prev2]
  }
  return prev[n]
}

// ---------- query ----------

const HAS: Record<string, Kind[]> = {
  photo: ['photo'], photos: ['photo'], image: ['photo'], images: ['photo'], pic: ['photo'],
  video: ['video'], videos: ['video'], voice: ['voice'], audio: ['voice'], 'voice-note': ['voice'],
  sticker: ['sticker'], stickers: ['sticker'], gif: ['sticker'], doc: ['doc'], document: ['doc'], file: ['doc'],
  link: ['link'], links: ['link'], url: ['link'], location: ['location'],
  media: ['photo', 'video', 'voice', 'sticker', 'doc'],
}

/** "2024", "2024-03", "2024-03-15" → [start, end] of that period, local time. */
export function period(s: string): [number, number] | null {
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const y = +m[1], mo = m[2] ? +m[2] - 1 : null, d = m[3] ? +m[3] : null
  const start = new Date(y, mo ?? 0, d ?? 1).getTime()
  const end = (d != null ? new Date(y, mo!, d + 1) : mo != null ? new Date(y, mo + 1, 1) : new Date(y + 1, 0, 1)).getTime() - 1
  return [start, end]
}

export function parseQuery(text: string): ParsedQuery {
  const q: ParsedQuery = { terms: [], phrases: [], not: [], filters: {}, people: [] }
  const re = /(-)?(?:(\w+):)?(?:"([^"]*)"?|(\S+))/g
  for (const m of text.matchAll(re)) {
    const [, neg, op, quoted, bare] = m
    const val = quoted ?? bare ?? ''
    const key = op?.toLowerCase()
    if (key === 'from') { if (val) q.people.push(val.toLowerCase()); continue }
    if (key === 'before' || key === 'after' || key === 'during' || key === 'in' || key === 'on' || key === 'year') {
      const p = period(val)
      if (p) {
        if (key === 'before') q.filters.to = p[0] - 1
        else if (key === 'after') q.filters.from = p[0]
        else { q.filters.from = p[0]; q.filters.to = p[1] }
        continue
      }
    }
    if (key === 'has' && HAS[val.toLowerCase()]) { q.filters.kinds = [...(q.filters.kinds ?? []), ...HAS[val.toLowerCase()]]; continue }
    if (key === 'is' && /^questions?$/i.test(val)) { q.filters.questions = true; continue }
    if (key === 'is' && /^deleted$/i.test(val)) { q.filters.kinds = [...(q.filters.kinds ?? []), 'deleted']; continue }
    const toks = tokenize(op && !quoted ? `${op}:${val}` : val)
    if (!toks.length) continue
    if (neg) q.not.push(...toks)
    else if (quoted != null && toks.length > 1) q.phrases.push(toks)
    else q.terms.push(...toks)
  }
  return q
}

/** from: values → real names (case-insensitive, any part of the name; "me"/"you" → you). */
export function resolvePeople(values: string[], senders: string[], you?: string | null): string[] {
  const out = new Set<string>()
  for (const v of values) {
    if ((v === 'me' || v === 'you' || v === 'i') && you) { out.add(you); continue }
    for (const s of senders) if (fold(s).includes(fold(v))) out.add(s)
  }
  return [...out]
}

function mergeFilters(a: Filters, b: Filters): Filters {
  const out: Filters = { ...a }
  if (b.from != null) out.from = Math.max(out.from ?? -Infinity, b.from)
  if (b.to != null) out.to = Math.min(out.to ?? Infinity, b.to)
  if (b.kinds?.length) out.kinds = [...new Set([...(out.kinds ?? []), ...b.kinds])]   // types: any of
  if (b.questions) out.questions = true
  if (b.people?.length) {                                                              // people: both must allow
    const both = out.people?.length ? out.people.filter(p => b.people!.includes(p)) : b.people
    out.people = both.length ? both : ['\u0000nobody']
  }
  return out
}

// ---------- search ----------

const K1 = 1.2, B = 0.5
const W_EXACT = 1, W_PREFIX = 0.7, W_FUZZY = 0.45

export interface SearchInput {
  text: string
  filters: Filters
  options: SearchOptions
  limit: number
  offset?: number
  you?: string | null
}

/** Search one or more chats' indexes. Scores are comparable across chats (same formula). */
export function search(indexes: ChatIndex[], input: SearchInput): SearchResult {
  const t0 = performance.now()
  const { options } = input
  const parsed = parseQuery(options.match === 'phrase' && !input.text.includes('"') ? `"${input.text}"` : input.text)
  const terms = new Set<string>()
  const scored: { ix: ChatIndex; i: number; score: number }[] = []

  for (const ix of indexes) {
    const people = parsed.people.length ? resolvePeople(parsed.people, ix.senders, input.you) : null
    let filters = mergeFilters(input.filters, parsed.filters)
    if (people) filters = mergeFilters(filters, { people: people.length ? people : ['\u0000nobody'] })
    const pass = filterFn(ix, filters)

    const words = [...parsed.terms, ...parsed.phrases.flat()]
    if (!words.length) {
      for (let i = 0; i < ix.docs.length; i++) if (pass(i)) scored.push({ ix, i, score: 0 })
      continue
    }

    // each query word → its spellings in this chat, each with a weight
    const per = words.map((w, wi) => {
      const exp = new Map<string, number>()
      if (ix.post.has(w)) exp.set(w, W_EXACT)
      const isPhraseWord = wi >= parsed.terms.length
      if (!isPhraseWord && !options.whole && w.length >= 2) for (const p of ix.prefixed(w)) exp.set(p, Math.max(exp.get(p) ?? 0, W_PREFIX * Math.min(1, (w.length + 1) / p.length)))
      if (!isPhraseWord && options.fuzzy) for (const f of ix.near(w)) if (!exp.has(f)) exp.set(f, W_FUZZY)
      // best contribution per doc for this word
      const best = new Map<number, number>()
      const N = ix.docs.length
      for (const [term, wgt] of exp) {
        const p = ix.post.get(term)!
        const idf = Math.log(1 + (N - p.ids.length + 0.5) / (p.ids.length + 0.5))
        for (let k = 0; k < p.ids.length; k++) {
          const d = p.ids[k], tf = p.tf[k]
          const s = wgt * idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * ix.len[d] / ix.avgLen))
          if (s > (best.get(d) ?? 0)) best.set(d, s)
        }
      }
      return { exp, best }
    })

    const notIds = new Set<number>()
    for (const n of parsed.not) { const p = ix.post.get(n); if (p) for (const d of p.ids) notIds.add(d) }

    // candidates: every word (all / phrases) or any word
    const any = options.match === 'any' && !parsed.phrases.length
    let cand: Iterable<number>
    if (any) {
      const u = new Set<number>()
      for (const p of per) for (const d of p.best.keys()) u.add(d)
      cand = u
    } else {
      const sorted = [...per].sort((a, b) => a.best.size - b.best.size)
      cand = [...sorted[0].best.keys()].filter(d => sorted.every(p => p.best.has(d)))
    }

    const phraseStr = parsed.phrases.map(p => p.join(' '))
    const whole = parsed.terms.length > 1 ? parsed.terms.join(' ') : null
    const span = Math.max(1, (ix.docs[ix.docs.length - 1]?.ts ?? 0) - (ix.docs[0]?.ts ?? 0))
    for (const d of cand) {
      if (notIds.has(d) || !pass(d)) continue
      const tokNorm = phraseStr.length || whole ? tokenize(ix.docs[d].text).join(' ') : ''
      if (phraseStr.length && !phraseStr.every(ph => (' ' + tokNorm + ' ').includes(' ' + ph + ' '))) continue
      let score = 0
      for (const p of per) score += p.best.get(d) ?? 0
      if (whole && tokNorm.includes(whole)) score *= 1.4
      if (phraseStr.length) score *= 1.25
      score *= 1 + 0.1 * (ix.docs[d].ts - ix.docs[0].ts) / span
      if (ix.docs[d].type === 'system') score *= 0.3
      scored.push({ ix, i: d, score })
    }
    for (const p of per) for (const [term] of p.exp) terms.add(term)
  }

  // facets over every match
  const months = new Map<string, number>(), people = new Map<string, number>(), chats = new Map<number, number>(), dayset = new Set<number>()
  const hours = new Array(24).fill(0), weekdays = new Array(7).fill(0)
  let minTs = Infinity, maxTs = -Infinity
  for (const { ix, i } of scored) {
    const doc = ix.docs[i]
    const dt = new Date(doc.ts)
    const mk = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    months.set(mk, (months.get(mk) ?? 0) + 1)
    if (doc.sender) people.set(doc.sender, (people.get(doc.sender) ?? 0) + 1)
    chats.set(doc.chatId, (chats.get(doc.chatId) ?? 0) + 1)
    dayset.add(dt.getFullYear() * 400 + dt.getMonth() * 32 + dt.getDate())
    hours[ix.hour[i]]++
    weekdays[ix.dow[i]]++
    if (doc.ts < minTs) minTs = doc.ts
    if (doc.ts > maxTs) maxTs = doc.ts
  }

  const ts = (s: { ix: ChatIndex; i: number }) => s.ix.docs[s.i].ts
  const noWords = !parsed.terms.length && !parsed.phrases.length
  const sort = options.sort === 'best' && noWords ? 'newest' : options.sort
  scored.sort(
    sort === 'newest' ? (a, b) => ts(b) - ts(a)
      : sort === 'oldest' ? (a, b) => ts(a) - ts(b)
        : sort === 'longest' ? (a, b) => b.ix.len[b.i] - a.ix.len[a.i] || ts(b) - ts(a)
          : (a, b) => b.score - a.score || ts(b) - ts(a),
  )
  const off = input.offset ?? 0
  return {
    total: scored.length,
    hits: scored.slice(off, off + input.limit).map(s => ({ doc: s.ix.docs[s.i], score: s.score })),
    terms: [...terms],
    months: fillMonths(months, minTs, maxTs),
    people: [...people].sort((a, b) => b[1] - a[1]),
    chats: [...chats].sort((a, b) => b[1] - a[1]),
    hours, weekdays,
    days: dayset.size,
    parsed,
    ms: Math.round(performance.now() - t0),
  }
}

function fillMonths(m: Map<string, number>, lo: number, hi: number): [string, number][] {
  if (!m.size) return []
  const out: [string, number][] = []
  const a = new Date(lo), b = new Date(hi)
  for (let y = a.getFullYear(), mo = a.getMonth(); y < b.getFullYear() || (y === b.getFullYear() && mo <= b.getMonth());) {
    const k = `${y}-${String(mo + 1).padStart(2, '0')}`
    out.push([k, m.get(k) ?? 0])
    if (++mo > 11) { mo = 0; y++ }
  }
  return out
}

function filterFn(ix: ChatIndex, f: Filters): (i: number) => boolean {
  const people = f.people?.length ? new Set(f.people) : null
  const kindMask = f.kinds?.length ? f.kinds.reduce((b, k) => b | KIND_BIT[k], 0) : 0
  const days = f.days?.length && f.days.length < 7 ? new Set(f.days) : null
  const [h0, h1] = f.hours ?? [0, 24]
  const hoursOn = !!f.hours && !(h0 === 0 && h1 === 24)
  return i => {
    const d = ix.docs[i]
    if (d.type === 'system' && !f.system) return false
    if (f.from != null && d.ts < f.from) return false
    if (f.to != null && d.ts > f.to) return false
    if (people && !people.has(d.sender)) return false
    if (kindMask && !(ix.kind[i] & kindMask)) return false
    if (days && !days.has(ix.dow[i])) return false
    if (hoursOn) { const h = ix.hour[i]; if (h0 <= h1 ? h < h0 || h >= h1 : h < h0 && h >= h1) return false }
    if (f.minWords && ix.len[i] < f.minWords) return false
    if (f.questions && !d.text.includes('?')) return false
    return true
  }
}
