import { isLaugh } from './laugh'
import { EVERYDAY, contentWords, wordCount } from './words'
import type { HallEntry, Message, MsgPick, Telepathy, VocabStats } from './types'

// Deterministic, zero-setup insights computed with the rest of the stats (stats.ts):
// Hall of Fame, Telepathy, and shared vocabulary. Pure functions over messages sorted by time.

const MIN = 60_000
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s)
const pick = (m: Message, n = 600): MsgPick => ({ id: m.id, ts: m.ts, sender: m.sender, text: cap(m.text, n), type: m.type, mediaKey: m.mediaKey })

// ---------- Hall of Fame ----------

const VISUAL = new Set(['image', 'video', 'gif', 'sticker'])

/**
 * Exports carry no reactions, so "landed" is inferred from what happened next:
 *  • laughs — each laugh from someone else within 10 min is credited to the last non-laugh
 *    message before it (text, photo, video, sticker) by a different person;
 *  • openers — the first message after 3h+ of silence, ranked by the conversation it started;
 *  • rants — one person, back-to-back (≤3 min apart), ranked by words.
 */
/** How big a laugh is: "haha" 1 … "HAHAHAHAHAHA" / 😂😂😂 up to 3. */
function laughWeight(text: string) {
  const run = Math.max(0, ...(text.toLowerCase().match(/[ha]{4,}|(?:lo)+l|l+m+a+o+/g) ?? []).map(r => r.length))
  const emoji = (text.match(/[\u{1F602}\u{1F923}\u{1F480}\u{1F606}]/gu) ?? []).length
  return 1 + Math.min(2, Math.max(0, run - 4) / 6 + Math.max(0, emoji - 1) * 0.5 + (/[A-Z]{4,}/.test(text) ? 0.5 : 0))
}

export function hallOfFame(real: Message[]): HallEntry[] {
  const laughs = new Map<number, { n: number; w: number; who: Set<string> }>()
  let joke = -1
  for (let i = 0; i < real.length; i++) {
    const m = real[i]
    const laugh = m.type === 'text' && isLaugh(m.text)
    if (laugh) {
      const j = joke >= 0 ? real[joke] : null
      if (j && j.sender !== m.sender && m.ts - j.ts <= 10 * MIN) {
        const c = laughs.get(joke) ?? { n: 0, w: 0, who: new Set() }
        c.n++; c.w += laughWeight(m.text); c.who.add(m.sender)
        laughs.set(joke, c)
      }
    } else if ((m.type === 'text' && m.text.trim()) || VISUAL.has(m.type)) {
      joke = i
    }
  }
  const out: HallEntry[] = [...laughs]
    .filter(([, c]) => c.w >= 1.5)
    .sort((a, b) => b[1].w - a[1].w || b[1].who.size - a[1].who.size || real[b[0]].ts - real[a[0]].ts)
    .slice(0, 6)
    .map(([i, c]) => ({ ...pick(real[i]), kind: 'laughs' as const, score: c.n, people: c.who.size }))

  // openers: sessions after 3h+ silence (a session ends at a 1h gap)
  const sessions: { start: number; n: number; end: number }[] = []
  for (let i = 0; i < real.length; i++) {
    const gap = i ? real[i].ts - real[i - 1].ts : Infinity
    if (gap > 60 * MIN) sessions.push({ start: i, n: 0, end: i })
    const s = sessions[sessions.length - 1]
    s.n++; s.end = i
  }
  out.push(...sessions
    .filter(s => (s.start === 0 || real[s.start].ts - real[s.start - 1].ts >= 180 * MIN) && real[s.start].type === 'text' && real[s.start].text.trim() && s.n >= 30)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map(s => ({ ...pick(real[s.start]), kind: 'opener' as const, score: s.n, minutes: Math.round((real[s.end].ts - real[s.start].ts) / MIN) })))

  // rants
  const rants: { start: number; n: number; words: number; text: string[] }[] = []
  let run: (typeof rants)[number] | null = null
  for (let i = 0; i < real.length; i++) {
    const m = real[i]
    const cont = run && real[i - 1].sender === m.sender && m.ts - real[i - 1].ts <= 3 * MIN
    if (!cont) { if (run) rants.push(run); run = { start: i, n: 0, words: 0, text: [] } }
    run!.n++
    if (m.type === 'text') { run!.words += wordCount(m.text); if (run!.text.join('\n').length < 700) run!.text.push(m.text) }
  }
  if (run) rants.push(run)
  out.push(...rants
    .filter(r => r.words >= 80 && r.n >= 3)
    .sort((a, b) => b.words - a.words)
    .slice(0, 3)
    .map(r => ({ ...pick(real[r.start]), text: cap(r.text.join('\n'), 700), kind: 'rant' as const, score: r.words, count: r.n })))
  return out
}

// ---------- Telepathy ----------

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, ' ').trim()

/**
 * Two kinds of "same time, unprompted":
 *  • together — after 10+ minutes of silence, two people both write within 10 s (or in the same
 *    minute when the export has no seconds), i.e. neither could have been answering the other;
 *  • jinx — two people send the exact same text within 10 s / the same minute (laughs excluded).
 */
export function telepathy(real: Message[]): Telepathy {
  const precise = real.some(m => m.ts % MIN !== 0)
  const close = (a: Message, b: Message) => (precise ? Math.abs(b.ts - a.ts) <= 10_000 : Math.floor(a.ts / MIN) === Math.floor(b.ts / MIN))
  let together = 0, jinx = 0
  const words = new Map<string, number>(), pairs = new Map<string, number>()
  const examples: Telepathy['examples'] = []
  const pair = (a: string, b: string) => { const k = [a, b].sort().join('\u0001'); pairs.set(k, (pairs.get(k) ?? 0) + 1) }

  for (let i = 1; i < real.length; i++) {
    const m = real[i]
    // together: m breaks a silence, and someone else writes right away (not a reply: no time to read)
    if (m.ts - real[i - 1].ts >= 10 * MIN) {
      const n = real[i + 1]
      if (n && n.sender !== m.sender && close(m, n)) {
        together++; pair(m.sender, n.sender)
        if (examples.filter(e => e.kind === 'together').length < 3) examples.push({ kind: 'together', a: pick(m, 160), b: pick(n, 160) })
      }
    }
    // jinx: same text from someone else in the last couple of messages, within the window
    if (m.type !== 'text' || !m.text || isLaugh(m.text)) continue
    const t = norm(m.text)
    if (!t || t.length > 60) continue
    for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
      const p = real[k]
      if (p.sender === m.sender || p.type !== 'text' || !close(p, m)) continue
      if (norm(p.text) === t) {
        jinx++; pair(p.sender, m.sender)
        words.set(t, (words.get(t) ?? 0) + 1)
        if (examples.filter(e => e.kind === 'jinx').length < 4) examples.push({ kind: 'jinx', a: pick(p, 160), b: pick(m, 160) })
        break
      }
    }
  }
  return {
    together, jinx, precise,
    jinxWords: [...words].sort((a, b) => b[1] - a[1]).slice(0, 8),
    examples,
    pairs: [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => { const [a, b] = k.split('\u0001'); return { a, b, n } }),
  }
}

// ---------- shared vocabulary ----------

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0
  for (const [w, x] of a) { na += x * x; const y = b.get(w); if (y) dot += x * y }
  for (const y of b.values()) nb += y * y
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/**
 * Vocabulary blend between the top people (both people in a 1:1, the top four in a group):
 * cosine similarity of their content-word counts per month or quarter, the words they share
 * most, how the top shared words trend, and who used a shared word first and who picked it up.
 */
export function vocabulary(real: Message[], ranked: string[]): VocabStats | undefined {
  const people = ranked.slice(0, ranked.length > 2 ? 4 : 2)
  if (people.length < 2 || !real.length) return undefined
  const names = new Set(ranked.flatMap(n => n.toLowerCase().split(/\s+/)))   // people's names aren't "vocabulary"
  const span = real[real.length - 1].ts - real[0].ts
  const period: VocabStats['period'] = span > 548 * 86400_000 ? 'quarter' : 'month'
  const keyOf = (ts: number) => { const d = new Date(ts); return period === 'month' ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}` }

  const idx = new Map(people.map((p, i) => [p, i]))
  const all = people.map(() => new Map<string, number>())
  const first = people.map(() => new Map<string, number>())
  const per = new Map<string, { freq: Map<string, number>[]; words: number[] }>()
  const periods: string[] = []
  for (const m of real) {
    const i = idx.get(m.sender)
    if (i == null || m.type !== 'text' || !m.text) continue
    const k = keyOf(m.ts)
    let p = per.get(k)
    if (!p) { p = { freq: people.map(() => new Map()), words: people.map(() => 0) }; per.set(k, p); periods.push(k) }
    p.words[i] += wordCount(m.text)
    for (const w of contentWords(m.text)) {
      if (names.has(w)) continue
      all[i].set(w, (all[i].get(w) ?? 0) + 1)
      p.freq[i].set(w, (p.freq[i].get(w) ?? 0) + 1)
      if (!first[i].has(w)) first[i].set(w, m.ts)
    }
  }
  const totals = all.map(f => [...f.values()].reduce((a, b) => a + b, 0) || 1)

  // shared words: used 3+ times by at least two people (both, in a 1:1); ranked by how much the
  // second-keenest user uses it relative to their own vocabulary, lifted when more people share it
  const cand = new Set(all.flatMap(f => [...f.keys()]))
  const scored: [string, number][] = []
  for (const w of cand) {
    const shares = people.map((_, i) => (all[i].get(w) ?? 0) >= 3 ? (all[i].get(w)! / totals[i]) : 0).filter(x => x > 0).sort((a, b) => b - a)
    if (shares.length < 2) continue
    scored.push([w, shares[1] * Math.sqrt(shares.length) * (EVERYDAY.has(w) ? 0.25 : 1)])
  }
  scored.sort((a, b) => b[1] - a[1])
  const shared = scored.slice(0, 12).map(([word]) => ({ word, counts: Object.fromEntries(people.map((p, i) => [p, all[i].get(word) ?? 0])) }))

  // similarity per period (pairs averaged), skipping thin periods
  const pairsSim = (freq: Map<string, number>[], ok: (i: number) => boolean) => {
    const sims: number[] = []
    for (let a = 0; a < people.length; a++) for (let b = a + 1; b < people.length; b++) if (ok(a) && ok(b)) sims.push(cosine(freq[a], freq[b]))
    return sims.length ? Math.round((sims.reduce((x, y) => x + y, 0) / sims.length) * 100) : null
  }
  const match = periods.map(k => { const p = per.get(k)!; return pairsSim(p.freq, i => p.words[i] >= 150) })
  const overall = pairsSim(all, () => true) ?? 0

  // trends: top 3 shared words, uses per 1,000 words per person per period
  const trends = shared.slice(0, 3).map(({ word }) => ({
    word,
    perK: Object.fromEntries(people.map((p, i) => [p, periods.map(k => {
      const x = per.get(k)!
      return x.words[i] >= 50 ? Math.round(((x.freq[i].get(word) ?? 0) / x.words[i]) * 10000) / 10 : 0
    })])),
  }))

  // picked up: first user vs a later adopter (30+ days later) who now uses it a lot
  const adopted: VocabStats['adopted'] = []
  for (const [word] of scored.slice(0, 80)) {
    if (EVERYDAY.has(word)) continue
    const firsts = people.map((p, i) => ({ p, i, ts: first[i].get(word) })).filter(x => x.ts != null).sort((a, b) => a.ts! - b.ts!)
    if (firsts.length < 2) continue
    const origin = firsts[0]
    const later = firsts.slice(1).filter(x => x.ts! - origin.ts! >= 30 * 86400_000).sort((a, b) => (all[b.i].get(word) ?? 0) - (all[a.i].get(word) ?? 0))[0]
    if (!later || (all[later.i].get(word) ?? 0) < 5) continue
    adopted.push({ word, from: origin.p, to: later.p, firstTs: origin.ts!, adoptedTs: later.ts!, uses: all[later.i].get(word)! })
  }
  adopted.sort((a, b) => b.uses - a.uses)

  return { period, periods, people, match, overall, shared, trends, adopted: adopted.slice(0, 5) }
}
