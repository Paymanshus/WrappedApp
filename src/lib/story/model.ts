import { DOW, fmtDate, fmtDay, fmtDuration, fmtNum, hourLabel } from '../format'
import { colorMap } from '../colors'
import type { ChatStats } from '../types'
import { archetypeFor } from './archetype'
import { groupAwards } from './awards'
import { isFxName, type FxName } from './fx'
import { SCENE_KEYS, type SceneData, type SceneKey } from './scene'

// One story model, three renderers: the DOM story player, the canvas card/video exporter,
// and the #r= share link (which carries this exact JSON). All copy is decided here, so a
// shared link renders identically on the receiver's device and never needs the raw stats.

/** Text segment. hl: 1 = accent, 2 = alert. */
export interface Seg { t: string; hl?: 1 | 2 }

export type Viz =
  | { kind: 'split'; parts: { label: string; value: number; color: string }[] }
  | { kind: 'emoji'; items: [string, number][] }
  | { kind: 'awards'; items: { title: string; name: string; detail: string; fx: FxName }[] }
  | { kind: 'chips'; items: string[] }

export interface PosterCard {
  id: string
  fx?: FxName
  kicker: string
  big?: string        // static headline
  count?: number      // animated integer headline (rendered with suffix)
  suffix?: string
  body: Seg[]
  viz?: Viz
  scene?: SceneKey    // animated hero (lib/story/scene.ts)
  sd?: SceneData
}

/** Top-line facts for the shareable summary posters (lib/story/posters.ts). Names already masked. */
export interface Summary {
  isGroup: boolean
  span: string
  total: number
  days: number
  perDay: number
  people: { name: string; share: number; color: string; messages: number; replySec: number | null; laughs: number; avgLen: number }[]
  topEmoji: [string, number][]
  peakHour: number
  peakDow: number
  hours: number[]
  streak: number
  bigDay: { count: number; date: string }
  fastest: { name: string; sec: number } | null
  laughs: number
  longest: { words: number; name: string } | null
  archetype: { title: string; fx: FxName; traits: string[]; line: string }
  awards: { title: string; name: string; detail: string; fx: FxName }[]
}

export interface StoryModel {
  v: 1
  title: string
  yearLabel: number | null
  cards: PosterCard[]
  summary?: Summary
}

export interface BuildOpts { hideNames?: boolean; year?: number | null }

export const maskName = (n: string) =>
  n.split(/\s+/).filter(Boolean).map(w => (w[0] ?? '').toUpperCase() + '.').join(' ') || '•'

/** 0–100 ints: compact enough for share links, plenty for the animation. */
const norm = (xs: number[]) => {
  const max = Math.max(1, ...xs)
  return xs.map(x => Math.round((x / max) * 100))
}
const hourShape = (stats: ChatStats) => norm(Array.from({ length: 24 }, (_, h) => stats.heatmap.reduce((x, row) => x + row[h], 0)))

export function buildStory(chat: { name: string; isGroup: boolean; colors?: Record<string, string> }, stats: ChatStats, opts: BuildOpts = {}): StoryModel {
  const cmap = colorMap(chat, stats)
  const name = (n: string) => (opts.hideNames ? maskName(n) : n)
  const year = opts.year ?? null
  const title = opts.hideNames ? (chat.isGroup ? 'A group chat' : maskName(chat.name)) : chat.name
  const [a, b] = stats.senders
  const isGroup = chat.isGroup || stats.senders.length > 2
  const total = stats.totalMessages
  const cards: PosterCard[] = []
  const years = (stats.lastTs - stats.firstTs) / 31557600000

  cards.push({
    id: 'intro', fx: 'sparkles', scene: 'stream',
    kicker: year ? `Your ${year}, rewound` : 'Your chat, rewound',
    big: title,
    body: [
      { t: `${fmtDate(stats.firstTs)} → ${fmtDate(stats.lastTs)}` },
      ...(years >= 1 && !year ? [{ t: ' · ' }, { t: `${years.toFixed(1)} years`, hl: 1 as const }, { t: ' of history' }] : []),
    ],
  })

  cards.push({
    id: 'total', fx: 'speech', scene: 'mosaic', sd: { n: total },
    kicker: isGroup ? 'This group said a lot' : 'You two said a lot',
    count: total,
    body: [
      { t: 'messages across ' }, { t: fmtNum(stats.activeDays), hl: 1 }, { t: ' different days. About ' },
      { t: fmtNum(Math.round(total / Math.max(1, stats.activeDays))), hl: 1 }, { t: ' a day when you talked.' },
    ],
  })

  if (a && b && !isGroup) {
    const pct = Math.round((a.messages / Math.max(1, a.messages + b.messages)) * 100)
    const carrier = pct > 60 ? a : pct < 40 ? b : null
    cards.push({
      id: 'balance', fx: carrier ? 'biceps' : 'scale', scene: 'balance',
      kicker: 'The balance of power',
      big: `${pct}% · ${100 - pct}%`,
      body: carrier
        ? [{ t: name(carrier.name), hl: 1 }, { t: ' carries this chat.' }]
        : [{ t: 'Perfectly balanced. ' }, { t: 'Nobody carries anybody.' }],
      viz: { kind: 'split', parts: [
        { label: name(a.name), value: a.messages, color: cmap[a.name] },
        { label: name(b.name), value: b.messages, color: cmap[b.name] },
      ] },
    })
  } else if (a && isGroup) {
    const top = stats.senders.slice(0, 3)
    const rest = total - top.reduce((x, s) => x + s.messages, 0)
    cards.push({
      id: 'balance', fx: 'megaphone', scene: 'balance',
      kicker: 'Who carries the group',
      big: `${Math.round((a.messages / Math.max(1, total)) * 100)}%`,
      body: [{ t: 'of everything comes from ' }, { t: name(a.name), hl: 1 }, { t: `, out of ${stats.senders.length} people.` }],
      viz: { kind: 'split', parts: [
        ...top.map(s => ({ label: name(s.name), value: s.messages, color: cmap[s.name] })),
        ...(rest > 0 ? [{ label: 'Everyone else', value: rest, color: '#667781' }] : []),
      ] },
    })
  }

  // message length — who writes essays, who sends one-liners
  const writers = stats.senders.filter(s => s.messages - s.media >= 20 && s.avgLen > 0)
  if (writers.length >= 2) {
    const byLen = [...writers].sort((x, y) => y.avgLen - x.avgLen)
    const shown = byLen.slice(0, isGroup ? 4 : 2)
    const long = byLen[0], short = byLen[byLen.length - 1]
    const ratio = long.avgLen / Math.max(1, short.avgLen)
    const lm = stats.longestMessage
    let big: string
    let body: Seg[]
    if (isGroup) {
      big = `${long.avgLen} chars`
      body = [{ t: name(long.name), hl: 1 }, { t: ' writes the longest messages in the group. ' }, { t: name(short.name), hl: 1 }, { t: ` keeps it to ${short.avgLen} characters.` }]
    } else if (ratio >= 1.15) {
      big = `${ratio.toFixed(1)}×`
      body = [{ t: name(long.name), hl: 1 }, { t: ' writes longer messages: ' }, { t: `${long.avgLen} characters`, hl: 1 }, { t: ` on average, to ${name(short.name)}'s ${short.avgLen}.` }]
    } else {
      big = `${Math.round((long.avgLen + short.avgLen) / 2)} chars`
      body = [{ t: 'Evenly matched. ' }, { t: `${name(long.name)} and ${name(short.name)}`, hl: 1 }, { t: ' write about the same per message.' }]
    }
    cards.push({
      id: 'length', fx: 'memo',
      kicker: 'Who writes the essays',
      big, body,
      scene: 'lengths',
      sd: {
        lens: shown.map(s => s.avgLen),
        labels: shown.map(s => name(s.name)),
        ci: shown.map(s => stats.senders.indexOf(s) % 5),
        cols: shown.map(s => cmap[s.name]),
      },
      viz: lm && lm.words > 20 ? { kind: 'chips', items: [`Longest message: ${fmtNum(lm.words)} words`, `by ${name(lm.sender)}`] } : undefined,
    })
  }

  const nocturnal = stats.peakHour >= 22 || stats.peakHour < 5
  const early = stats.peakHour >= 5 && stats.peakHour < 10
  cards.push({
    id: 'clock', fx: nocturnal ? 'owl' : early ? 'sun' : 'tv', scene: 'clock', sd: { hours: hourShape(stats), peak: stats.peakHour },
    kicker: "The chat's body clock",
    big: hourLabel(stats.peakHour),
    body: [
      { t: 'is when this chat comes alive, especially on ' }, { t: `${DOW[stats.peakDow]}s`, hl: 1 },
      { t: nocturnal ? '. Certified night owls.' : early ? '. Early birds.' : '. Prime-time texters.' },
    ],
  })

  const repliers = stats.senders.filter(s => s.medianReplySec != null).slice(0, 8)
  if (!isGroup && a?.medianReplySec && b?.medianReplySec) {
    const [fast, slow] = a.medianReplySec <= b.medianReplySec ? [a, b] : [b, a]
    const close = slow.medianReplySec! / fast.medianReplySec! < 1.15
    cards.push({
      id: 'reply', fx: close ? 'scale' : 'zap', scene: 'ticks', sd: { sec: Math.round(fast.medianReplySec!) },
      kicker: 'The reply-speed duel',
      big: fmtDuration(fast.medianReplySec!),
      body: close
        ? [{ t: 'Dead heat. ' }, { t: `${name(fast.name)} and ${name(slow.name)}`, hl: 1 }, { t: ' both reply in about that.' }]
        : [
            { t: name(fast.name), hl: 1 }, { t: ` typically replies in ${fmtDuration(fast.medianReplySec!)}. ${name(slow.name)} takes ` },
            { t: fmtDuration(slow.medianReplySec!), hl: 2 }, { t: '.' },
          ],
    })
  } else if (isGroup && repliers.length >= 2) {
    const fast = [...repliers].sort((x, y) => x.medianReplySec! - y.medianReplySec!)[0]
    cards.push({
      id: 'reply', fx: 'zap', scene: 'ticks', sd: { sec: Math.round(fast.medianReplySec!) },
      kicker: 'Fastest thumbs in the group',
      big: fmtDuration(fast.medianReplySec!),
      body: [{ t: name(fast.name), hl: 1 }, { t: ' answers before anyone else has unlocked their phone.' }],
    })
  }

  if (stats.longestStreakDays > 1) {
    cards.push({
      id: 'streak', fx: 'fire', scene: 'calendar', sd: { days: stats.longestStreakDays },
      kicker: 'Dedication',
      count: stats.longestStreakDays, suffix: ' days',
      body: [
        { t: 'in a row, talking every single day' },
        ...(stats.streakStart ? [{ t: ` (${fmtDate(stats.streakStart)} → ${fmtDate(stats.streakEnd)})` }] : []),
        { t: '.' },
        ...(stats.longestDroughtDays > 3 ? [{ t: ' Longest silence: ' }, { t: `${stats.longestDroughtDays} days`, hl: 2 as const }, { t: '.' }] : []),
      ],
    })
  }

  if (stats.biggestDay.count) {
    cards.push({
      id: 'bigday', fx: 'collision', scene: 'spike', sd: { spark: norm(stats.dayWindow ?? []) },
      kicker: 'One day went off',
      count: stats.biggestDay.count,
      body: [{ t: 'messages on ' }, { t: fmtDay(stats.biggestDay.ts), hl: 1 }, { t: '. The biggest day this chat ever had.' }],
    })
  }

  if (stats.topEmojis.length >= 3) {
    const [em, c] = stats.topEmojis[0]
    cards.push({
      id: 'emoji', scene: 'reactions',
      kicker: 'Emoji hall of fame',
      body: [{ t: `${em} alone showed up ` }, { t: `${fmtNum(c)} times`, hl: 1 }, { t: '.' }],
      viz: { kind: 'emoji', items: stats.topEmojis.slice(0, 3) },
    })
  }

  const laughs = stats.senders.reduce((x, s) => x + s.laughs, 0)
  if (laughs > 10) {
    const rate = (s: typeof a) => s.laughs / Math.max(1, s.messages)
    cards.push({
      id: 'laugh', fx: 'joy', scene: 'marquee',
      kicker: 'Comedy club',
      count: laughs,
      body: [
        { t: 'messages had a laugh in them, ' }, { t: `${((laughs / Math.max(1, total)) * 100).toFixed(1)}%`, hl: 1 },
        { t: ' of everything said.' },
        ...(!isGroup && a && b ? [{ t: ' Funnier one: ' }, { t: name(rate(a) < rate(b) ? a.name : b.name), hl: 1 as const }, { t: '.' }] : []),
      ],
    })
  }

  const arch = archetypeFor(stats, name)
  cards.push({
    id: 'archetype', fx: arch.fx, scene: 'status', sd: { segments: arch.traits.length + 3 },
    kicker: isGroup ? 'Your group personality' : 'Your chat personality',
    big: arch.title,
    body: arch.blurb,
    viz: arch.traits.length ? { kind: 'chips', items: arch.traits } : undefined,
  })

  if (isGroup) {
    const awards = groupAwards(stats, name)
    if (awards.length) cards.push({ id: 'awards', kicker: 'The group awards', body: [], viz: { kind: 'awards', items: awards.slice(0, 5) } })
  }

  cards.push({
    id: 'outro', fx: 'party', scene: 'ripples',
    kicker: "That's the highlight reel",
    big: year ? `${year}, done.` : 'Now dig in.',
    body: [{ t: `${fmtNum(total)} messages · ${fmtNum(stats.activeDays)} days · one chat.` }],
  })

  const fastestPerson = [...stats.senders].filter(x => x.medianReplySec != null && x.messages >= 20).sort((x, y) => x.medianReplySec! - y.medianReplySec!)[0]
  const lm = stats.longestMessage
  const summary: Summary = {
    isGroup,
    span: `${fmtDate(stats.firstTs)} → ${fmtDate(stats.lastTs)}`,
    total,
    days: stats.activeDays,
    perDay: Math.round(total / Math.max(1, stats.activeDays)),
    people: stats.senders.slice(0, 4).map(x => ({
      name: name(x.name), share: x.messages / Math.max(1, total), color: cmap[x.name], messages: x.messages,
      replySec: x.medianReplySec, laughs: x.laughs, avgLen: x.avgLen,
    })),
    topEmoji: stats.topEmojis.slice(0, 5),
    peakHour: stats.peakHour,
    peakDow: stats.peakDow,
    hours: hourShape(stats),
    streak: stats.longestStreakDays,
    bigDay: { count: stats.biggestDay.count, date: stats.biggestDay.ts ? fmtDate(stats.biggestDay.ts) : '' },
    fastest: fastestPerson ? { name: name(fastestPerson.name), sec: Math.round(fastestPerson.medianReplySec!) } : null,
    laughs,
    longest: lm ? { words: lm.words, name: name(lm.sender) } : null,
    archetype: { title: arch.title, fx: arch.fx, traits: arch.traits, line: arch.blurb.map(b => b.t).join('') },
    awards: isGroup ? groupAwards(stats, name).slice(0, 3) : [],
  }

  return { v: 1, title, yearLabel: year, cards, summary }
}

// ---------- share-link validation (payload is untrusted input) ----------

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#667781')

function segs(v: unknown): Seg[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 24).map(s => ({ t: str((s as Seg)?.t, 240), hl: (s as Seg)?.hl === 1 || (s as Seg)?.hl === 2 ? (s as Seg).hl : undefined }))
}

function viz(v: unknown): Viz | undefined {
  const o = v as { kind?: string; parts?: unknown[]; items?: unknown[] } | null
  if (!o || !Array.isArray(o.parts ?? o.items)) return undefined
  if (o.kind === 'split') return { kind: 'split', parts: o.parts!.slice(0, 6).map(p => { const q = p as Record<string, unknown>; return { label: str(q.label, 60), value: num(q.value), color: color(q.color) } }) }
  if (o.kind === 'emoji') return { kind: 'emoji', items: o.items!.slice(0, 5).map(p => [str((p as unknown[])?.[0], 16), num((p as unknown[])?.[1])] as [string, number]) }
  if (o.kind === 'chips') return { kind: 'chips', items: o.items!.slice(0, 4).map(x => str(x, 40)) }
  if (o.kind === 'awards') return { kind: 'awards', items: o.items!.slice(0, 6).map(p => { const q = p as Record<string, unknown>; return { title: str(q.title, 40), name: str(q.name, 60), detail: str(q.detail, 60), fx: isFxName(q.fx) ? q.fx : 'trophy' } }) }
  return undefined
}

function sceneData(v: unknown): SceneData | undefined {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return undefined
  const ints = (a: unknown, n: number) => (Array.isArray(a) ? a.slice(0, n).map(x => Math.max(0, Math.min(100, Math.round(num(x))))) : undefined)
  return {
    n: o.n != null ? num(o.n) : undefined,
    hours: ints(o.hours, 24),
    peak: o.peak != null ? Math.max(0, Math.min(23, Math.round(num(o.peak)))) : undefined,
    sec: o.sec != null ? num(o.sec) : undefined,
    days: o.days != null ? num(o.days) : undefined,
    spark: ints(o.spark, 31),
    segments: o.segments != null ? num(o.segments) : undefined,
    lens: Array.isArray(o.lens) ? o.lens.slice(0, 4).map(x => Math.max(0, Math.min(5000, Math.round(num(x))))) : undefined,
    labels: Array.isArray(o.labels) ? o.labels.slice(0, 4).map(x => str(x, 40)) : undefined,
    ci: Array.isArray(o.ci) ? o.ci.slice(0, 4).map(x => Math.max(0, Math.min(4, Math.round(num(x))))) : undefined,
    cols: Array.isArray(o.cols) ? o.cols.slice(0, 4).map(color) : undefined,
  }
}

function summary(v: unknown): Summary | undefined {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return undefined
  const arr = (a: unknown, n: number) => (Array.isArray(a) ? a.slice(0, n) : [])
  const rec = (a: unknown) => (a && typeof a === 'object' ? a as Record<string, unknown> : {})
  const arch = rec(o.archetype), big = rec(o.bigDay), fast = o.fastest ? rec(o.fastest) : null, lon = o.longest ? rec(o.longest) : null
  return {
    isGroup: !!o.isGroup,
    span: str(o.span, 60),
    total: num(o.total), days: num(o.days), perDay: num(o.perDay),
    people: arr(o.people, 4).map(p => { const q = rec(p); return { name: str(q.name, 40), share: Math.max(0, Math.min(1, num(q.share))), color: color(q.color), messages: num(q.messages), replySec: q.replySec == null ? null : num(q.replySec), laughs: num(q.laughs), avgLen: num(q.avgLen) } }),
    topEmoji: arr(o.topEmoji, 5).map(p => [str((p as unknown[])?.[0], 16), num((p as unknown[])?.[1])] as [string, number]),
    peakHour: Math.max(0, Math.min(23, Math.round(num(o.peakHour)))),
    peakDow: Math.max(0, Math.min(6, Math.round(num(o.peakDow)))),
    hours: arr(o.hours, 24).map(x => Math.max(0, Math.min(100, Math.round(num(x))))),
    streak: num(o.streak),
    bigDay: { count: num(big.count), date: str(big.date, 30) },
    fastest: fast ? { name: str(fast.name, 40), sec: num(fast.sec) } : null,
    laughs: num(o.laughs),
    longest: lon ? { words: num(lon.words), name: str(lon.name, 40) } : null,
    archetype: { title: str(arch.title, 60), fx: isFxName(arch.fx) ? arch.fx : 'sparkles', traits: arr(arch.traits, 4).map(x => str(x, 40)), line: str(arch.line, 200) },
    awards: arr(o.awards, 3).map(p => { const q = rec(p); return { title: str(q.title, 40), name: str(q.name, 40), detail: str(q.detail, 60), fx: isFxName(q.fx) ? q.fx : 'trophy' } }),
  }
}

export function sanitizeModel(raw: unknown): StoryModel | null {
  const m = raw as Partial<StoryModel> | null
  if (!m || m.v !== 1 || !Array.isArray(m.cards) || !m.cards.length) return null
  return {
    v: 1,
    title: str(m.title, 80),
    yearLabel: typeof m.yearLabel === 'number' ? m.yearLabel : null,
    cards: m.cards.slice(0, 16).map((c, i) => ({
      id: str(c?.id, 20) || `c${i}`,
      fx: isFxName(c?.fx) ? c.fx : undefined,
      kicker: str(c?.kicker, 80),
      big: c?.big != null ? str(c.big, 60) : undefined,
      count: c?.count != null ? num(c.count) : undefined,
      suffix: c?.suffix != null ? str(c.suffix, 20) : undefined,
      body: segs(c?.body),
      viz: viz(c?.viz),
      scene: SCENE_KEYS.includes(c?.scene as SceneKey) ? c.scene : undefined,
      sd: sceneData(c?.sd),
    })),
    summary: summary(m.summary),
  }
}
