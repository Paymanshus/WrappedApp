import emojiRegex from 'emoji-regex'
import { isLaugh } from './laugh'
import { contentWords } from './words'
import { hallOfFame, telepathy, vocabulary } from './insights'
import type { Message, ChatStats, SenderStats, MsgPick } from './types'

const eRe = emojiRegex()

const GAP_SESSION = 60 * 60 * 1000       // 1h  → new session
const GAP_INITIATE = 6 * 60 * 60 * 1000  // 6h  → whoever speaks "initiated"
const MAX_REPLY = 12 * 60 * 60 * 1000    // cap for reply-latency samples

const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function top<T extends string>(m: Map<T, number>, n: number): [T, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

/** Bump when ChatStats gains fields; stored rows below this are recomputed on open. */
export const STATS_VERSION = 5

export function computeStats(chatId: number, msgs: Message[], year: number | null = null): ChatStats {
  const real = msgs.filter(m => m.type !== 'system')
  const senders = new Map<string, {
    n: number; words: number; chars: number; media: number; voice: number; stickers: number
    emojis: number; laughs: number; questions: number; initiations: number
    replies: number[]; doubleTexts: number; hours: number[]
    wordFreq: Map<string, number>; emojiFreq: Map<string, number>
    longest: (MsgPick & { words: number }) | null
  }>()
  const S = (name: string) => {
    let s = senders.get(name)
    if (!s) { s = { n: 0, words: 0, chars: 0, media: 0, voice: 0, stickers: 0, emojis: 0, laughs: 0, questions: 0, initiations: 0, replies: [], doubleTexts: 0, hours: Array(24).fill(0), wordFreq: new Map(), emojiFreq: new Map(), longest: null }; senders.set(name, s) }
    return s
  }

  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  const byDay = new Map<string, number>()
  const byMonth = new Map<string, Map<string, number>>()
  const byYear = new Map<number, number>()
  const globalEmoji = new Map<string, number>()

  let sessions = 0
  let prev: Message | null = null
  let firstMessage: ChatStats['firstMessage'] = null
  let longestMessage: ChatStats['longestMessage'] = null
  let runSender = ''
  let runLen = 0

  for (const m of real) {
    const s = S(m.sender)
    s.n++
    const d = new Date(m.ts)
    heatmap[d.getDay()][d.getHours()]++
    s.hours[d.getHours()]++
    const dk = dayKey(m.ts)
    byDay.set(dk, (byDay.get(dk) ?? 0) + 1)
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!byMonth.has(mk)) byMonth.set(mk, new Map())
    const mm = byMonth.get(mk)!
    mm.set(m.sender, (mm.get(m.sender) ?? 0) + 1)
    byYear.set(d.getFullYear(), (byYear.get(d.getFullYear()) ?? 0) + 1)

    if (!prev || m.ts - prev.ts > GAP_SESSION) sessions++
    if (!prev || m.ts - prev.ts > GAP_INITIATE) s.initiations++
    if (prev && prev.sender !== m.sender && m.ts - prev.ts < MAX_REPLY) s.replies.push((m.ts - prev.ts) / 1000)

    // double-text: same sender run of >=2 after a previous different sender
    if (m.sender === runSender) { runLen++; if (runLen === 2) s.doubleTexts++ }
    else { runSender = m.sender; runLen = 1 }

    if (m.type === 'audio') s.voice++
    if (m.type === 'sticker') s.stickers++
    if (m.type !== 'text' && m.type !== 'deleted') s.media++

    if (m.type === 'text' && m.text) {
      if (!firstMessage) firstMessage = { sender: m.sender, text: m.text, ts: m.ts }
      s.chars += m.text.length
      const words = contentWords(m.text)
      s.words += m.text.split(/\s+/).length
      for (const w of words) s.wordFreq.set(w, (s.wordFreq.get(w) ?? 0) + 1)
      const wc = m.text.split(/\s+/).length
      if (!longestMessage || wc > longestMessage.words) longestMessage = { sender: m.sender, text: m.text, ts: m.ts, words: wc }
      if (!s.longest || wc > s.longest.words) s.longest = { id: m.id, ts: m.ts, sender: m.sender, text: m.text.length > 1500 ? m.text.slice(0, 1500) + '…' : m.text, words: wc }
      if (isLaugh(m.text)) s.laughs++
      if (m.text.includes('?')) s.questions++
      for (const em of m.text.match(eRe) ?? []) {
        s.emojis++
        s.emojiFreq.set(em, (s.emojiFreq.get(em) ?? 0) + 1)
        globalEmoji.set(em, (globalEmoji.get(em) ?? 0) + 1)
      }
    }
    prev = m
  }

  // signature words: heavily used by this sender relative to others
  const totalWordFreq = new Map<string, number>()
  for (const s of senders.values()) for (const [w, c] of s.wordFreq) totalWordFreq.set(w, (totalWordFreq.get(w) ?? 0) + c)

  const senderStats: SenderStats[] = [...senders.entries()].map(([name, s]) => ({
    name,
    messages: s.n,
    words: s.words,
    chars: s.chars,
    avgLen: s.n ? Math.round(s.chars / Math.max(1, s.n - s.media)) : 0,
    media: s.media,
    voiceNotes: s.voice,
    stickers: s.stickers,
    emojis: s.emojis,
    laughs: s.laughs,
    questions: s.questions,
    initiations: s.initiations,
    medianReplySec: median(s.replies),
    doubleTexts: s.doubleTexts,
    topWords: top(s.wordFreq, 12),
    topEmojis: top(s.emojiFreq, 8),
    hours: s.hours,
    longest: s.longest ?? undefined,
  })).sort((a, b) => b.messages - a.messages)

  // streaks & droughts over active days
  const days = [...byDay.keys()].sort()
  let longestStreak = 0, streakStart = 0, streakEnd = 0
  let curStreak = 0, curStart = 0
  let longestDrought = 0, droughtStart = 0, droughtEnd = 0
  let prevTs = 0
  for (const dk of days) {
    const ts = new Date(dk + 'T12:00:00').getTime()
    const gap = prevTs ? Math.round((ts - prevTs) / 86400000) : 1
    if (gap === 1) { curStreak++; } else {
      if (prevTs && gap - 1 > longestDrought) { longestDrought = gap - 1; droughtStart = prevTs; droughtEnd = ts }
      curStreak = 1; curStart = ts
    }
    if (curStreak === 1) curStart = ts
    if (curStreak > longestStreak) { longestStreak = curStreak; streakStart = curStart; streakEnd = ts }
    prevTs = ts
  }

  let biggestDay = { date: '', ts: 0, count: 0 }
  for (const [dk, c] of byDay) if (c > biggestDay.count) biggestDay = { date: dk, ts: new Date(dk + 'T12:00:00').getTime(), count: c }
  // daily counts for the 31 days centred on the biggest day (story spike chart)
  const dayWindow: number[] = []
  if (biggestDay.ts) {
    for (let d = -15; d <= 15; d++) {
      const day = new Date(biggestDay.ts)
      day.setDate(day.getDate() + d)
      dayWindow.push(byDay.get(dayKey(day.getTime())) ?? 0)
    }
  }

  let peakHour = 0, peakDow = 0, peakVal = -1
  const hourTotals = Array(24).fill(0)
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    hourTotals[h] += heatmap[d][h]
    if (heatmap[d][h] > peakVal) { peakVal = heatmap[d][h]; peakDow = d; peakHour = h }
  }
  peakHour = hourTotals.indexOf(Math.max(...hourTotals))

  const firstTs = real[0]?.ts ?? 0
  const lastTs = real[real.length - 1]?.ts ?? 0

  return {
    chatId,
    version: STATS_VERSION,
    year,
    totalMessages: real.length,
    totalWords: senderStats.reduce((a, s) => a + s.words, 0),
    totalMedia: senderStats.reduce((a, s) => a + s.media, 0),
    firstTs, lastTs,
    spanDays: Math.max(1, Math.round((lastTs - firstTs) / 86400000)),
    activeDays: byDay.size,
    senders: senderStats,
    monthly: [...byMonth.entries()].sort().map(([key, m]) => ({ key, ts: new Date(key + '-01T12:00:00').getTime(), counts: Object.fromEntries(m) })),
    yearly: [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count })),
    heatmap,
    peakHour, peakDow,
    longestStreakDays: longestStreak, streakStart, streakEnd,
    longestDroughtDays: longestDrought, droughtStart, droughtEnd,
    biggestDay,
    dayWindow,
    sessions,
    firstMessage,
    longestMessage,
    topEmojis: top(globalEmoji, 10),
    hallOfFame: hallOfFame(real),
    telepathy: senderStats.length > 1 ? telepathy(real) : undefined,
    vocab: vocabulary(real, senderStats.map(s => s.name)),
  }
}
