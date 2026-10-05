import { fmtDuration, fmtNum } from '../format'
import type { ChatStats, SenderStats } from '../types'
import type { FxName } from './fx'

export interface Award { title: string; name: string; detail: string; fx: FxName }

interface Rule {
  title: string
  fx: FxName
  value: (s: SenderStats) => number | null   // higher wins; null = not eligible
  detail: (s: SenderStats) => string
}

const nightShare = (s: SenderStats) => {
  if (!s.hours) return null
  const n = [22, 23, 0, 1, 2, 3, 4].reduce((x, h) => x + s.hours![h], 0)
  return n / Math.max(1, s.messages)
}

const RULES: Rule[] = [
  { title: 'Chatterbox', fx: 'speech', value: s => s.messages, detail: s => `${fmtNum(s.messages)} messages` },
  { title: 'The Novelist', fx: 'memo', value: s => (s.messages - s.media >= 30 ? s.avgLen : null), detail: s => `${s.avgLen} characters a message` },
  { title: 'Speed Demon', fx: 'zap', value: s => (s.medianReplySec == null ? null : -s.medianReplySec), detail: s => `replies in ${fmtDuration(s.medianReplySec!)}` },
  { title: 'Night Owl', fx: 'owl', value: s => nightShare(s), detail: s => `${Math.round(nightShare(s)! * 100)}% after 10pm` },
  { title: 'Voice-Note Villain', fx: 'mic', value: s => s.voiceNotes || null, detail: s => `${fmtNum(s.voiceNotes)} voice notes` },
  { title: 'Conversation Starter', fx: 'megaphone', value: s => s.initiations || null, detail: s => `started ${fmtNum(s.initiations)} conversations` },
  { title: 'Emoji Monarch', fx: 'crown', value: s => (s.emojis ? s.emojis / s.messages : null), detail: s => `${fmtNum(s.emojis)} emojis` },
  { title: 'The Laugh Track', fx: 'joy', value: s => (s.laughs ? s.laughs / s.messages : null), detail: s => `laughs in ${Math.round((s.laughs / s.messages) * 100)}% of messages` },
  { title: 'The Lurker', fx: 'ghost', value: s => -s.messages, detail: s => `only ${fmtNum(s.messages)} messages` },
]

/** Superlatives for group chats (3+ active members). Nobody wins more than two. */
export function groupAwards(stats: ChatStats, name: (n: string) => string): Award[] {
  const floor = Math.max(20, stats.totalMessages * 0.01)
  const pool = stats.senders.filter(s => s.messages >= floor)
  if (pool.length < 3) return []
  const wins = new Map<string, number>()
  const out: Award[] = []
  for (const r of RULES) {
    const ranked = pool
      .map(s => ({ s, v: r.value(s) }))
      .filter((x): x is { s: SenderStats; v: number } => x.v != null && Number.isFinite(x.v))
      .sort((x, y) => y.v - x.v)
    const pick = ranked.find(x => (wins.get(x.s.name) ?? 0) < 2)
    if (!pick) continue
    wins.set(pick.s.name, (wins.get(pick.s.name) ?? 0) + 1)
    out.push({ title: r.title, fx: r.fx, name: name(pick.s.name), detail: r.detail(pick.s) })
  }
  return out
}
