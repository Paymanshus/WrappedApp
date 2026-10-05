import { fmtDuration, fmtNum } from '../format'
import type { ChatStats } from '../types'
import type { FxName } from './fx'
import type { Seg } from './model'

// Chat "personality": every candidate scores ~0–1 from stats we already compute; the
// winner names the chat, the runners-up become trait chips.

export interface Archetype {
  id: string
  title: string
  fx: FxName
  blurb: Seg[]
  traits: string[]
}

interface Candidate { id: string; score: number; pair: string; group: string; fx: FxName; blurb: Seg[]; chip: string }

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const pct = (x: number) => `${Math.round(x * 100)}%`

function hourShare(stats: ChatStats, hours: number[]) {
  const total = Math.max(1, stats.totalMessages)
  let n = 0
  for (const row of stats.heatmap) for (const h of hours) n += row[h]
  return n / total
}

export function archetypeFor(stats: ChatStats, name: (n: string) => string): Archetype {
  const total = Math.max(1, stats.totalMessages)
  const isGroup = stats.senders.length > 2
  const [a, b] = stats.senders

  const night = hourShare(stats, [22, 23, 0, 1, 2, 3, 4])
  const morning = hourShare(stats, [5, 6, 7, 8])
  const replies = stats.senders.map(s => s.medianReplySec).filter((x): x is number => x != null).sort((x, y) => x - y)
  const reply = replies.length ? replies[Math.floor(replies.length / 2)] : null
  const laughs = stats.senders.reduce((x, s) => x + s.laughs, 0)
  const voice = stats.senders.reduce((x, s) => x + s.voiceNotes, 0)
  const textMsgs = stats.senders.reduce((x, s) => x + Math.max(0, s.messages - s.media), 0)
  const avgLen = textMsgs ? Math.round(stats.senders.reduce((x, s) => x + s.chars, 0) / textMsgs) : 0
  const active = stats.activeDays / Math.max(1, stats.spanDays)
  const perDay = Math.round(total / Math.max(1, stats.activeDays))

  const cands: Candidate[] = [
    {
      id: 'night', score: night * 2.4, pair: 'The Night Owls', group: 'The Night Shift', fx: 'owl',
      blurb: [{ t: pct(night), hl: 1 }, { t: ' of messages land between 10pm and 5am. Sleep is optional.' }],
      chip: `${pct(night)} after 10pm`,
    },
    {
      id: 'early', score: morning * 3.5, pair: 'The Early Birds', group: 'The Morning Crew', fx: 'sun',
      blurb: [{ t: pct(morning), hl: 1 }, { t: ' of messages arrive before 9am. Coffee and catch-ups.' }],
      chip: `${pct(morning)} before 9am`,
    },
    {
      id: 'speed', score: reply == null ? 0 : clamp((180 - reply) / 180) * 0.9, pair: 'The Speed Demons', group: 'The Rapid-Fire Room', fx: 'zap',
      blurb: [{ t: 'A typical reply lands in ' }, { t: reply == null ? '—' : fmtDuration(reply), hl: 1 }, { t: '. Nobody gets left on read.' }],
      chip: reply == null ? '' : `Replies in ${fmtDuration(reply)}`,
    },
    {
      id: 'comedy', score: (laughs / total) * 5, pair: 'The Comedy Club', group: 'The Comedy Club', fx: 'joy',
      blurb: [{ t: pct(laughs / total), hl: 1 }, { t: ' of messages have a laugh in them. Everything is a bit.' }],
      chip: `${pct(laughs / total)} laughing`,
    },
    {
      id: 'voice', score: (voice / total) * 7, pair: 'The Podcasters', group: 'The Radio Station', fx: 'mic',
      blurb: [{ t: fmtNum(voice), hl: 1 }, { t: ' voice notes. Typing is for other people.' }],
      chip: `${fmtNum(voice)} voice notes`,
    },
    {
      id: 'novel', score: clamp((avgLen - 60) / 80), pair: 'The Novelists', group: 'The Book Club', fx: 'memo',
      blurb: [{ t: 'The average message runs ' }, { t: `${avgLen} characters`, hl: 1 }, { t: '. Paragraphs, not texts.' }],
      chip: `${avgLen}-char messages`,
    },
    {
      id: 'inseparable', score: active > 0.5 ? active : 0, pair: 'The Inseparables', group: 'The Always-On Crew', fx: 'hearts',
      blurb: [{ t: 'You talked on ' }, { t: pct(active), hl: 1 }, { t: ' of all days. Barely a day apart.' }],
      chip: `Active ${pct(active)} of days`,
    },
    {
      id: 'comeback', score: stats.longestDroughtDays >= 45 ? 0.55 : 0, pair: 'The Comeback Kids', group: 'The Comeback Crew', fx: 'boomerang',
      blurb: [{ t: 'Went quiet for ' }, { t: `${stats.longestDroughtDays} days`, hl: 1 }, { t: ', then picked right back up.' }],
      chip: `${stats.longestDroughtDays}-day comeback`,
    },
    {
      id: 'steady', score: 0.35, pair: 'The Steady Ones', group: 'The Steady Crew', fx: 'calendar',
      blurb: [{ t: fmtNum(perDay), hl: 1 }, { t: ' messages on an average active day. Consistent, not chaotic.' }],
      chip: `${fmtNum(perDay)} a day`,
    },
  ]

  if (!isGroup && a && b && a.doubleTexts + b.doubleTexts > 20 && a.medianReplySec && b.medianReplySec) {
    const [dbl, other] = a.doubleTexts / a.messages >= b.doubleTexts / b.messages ? [a, b] : [b, a]
    const ratio = (dbl.doubleTexts / dbl.messages) / Math.max(0.001, other.doubleTexts / other.messages)
    const slowRatio = other.medianReplySec! / Math.max(1, dbl.medianReplySec!)
    cands.push({
      id: 'ghost', score: clamp((ratio - 1.5) / 3) * 0.6 + (slowRatio > 4 ? 0.35 : 0),
      pair: 'The Double-Texter & The Ghost', group: '', fx: 'ghost',
      blurb: [
        { t: name(dbl.name), hl: 1 }, { t: ` double-texts ${ratio.toFixed(1)}× more, while ` },
        { t: name(other.name), hl: 1 }, { t: ' takes their sweet time.' },
      ],
      chip: 'Double-texting',
    })
  }

  const ranked = cands.filter(c => c.chip && (!isGroup || c.group)).sort((x, y) => y.score - x.score)
  const win = ranked[0]
  return {
    id: win.id,
    title: isGroup ? win.group : win.pair,
    fx: win.fx,
    blurb: win.blurb,
    traits: ranked.slice(1).filter(c => c.score > 0.2).slice(0, 3).map(c => c.chip),
  }
}
