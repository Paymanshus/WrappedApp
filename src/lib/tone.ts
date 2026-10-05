import type { Message, MsgPick } from './types'

// Tone check (optional, on this device). VADER — a published, rule-based sentiment model: a
// ~7,500-word valence list plus grammar rules (negation, "very", CAPS, "!!!") — scores each
// message from -1 to +1. No ML model, no network. VADER is English-only and doesn't read emoji,
// so we map common emoji and romanised Hindi words to English equivalents first.
// On top of the score we count two cue families VADER can't see:
//   • chaos — CAPS, "!!"/"??", stretched words ("noooo"), keyboard smashes, rapid-fire bursts
//   • sarcasm — eye-rolls and upside-down smiles, "/s", "yeah right", praise next to an eye-roll

export type Scorer = (text: string) => number   // VADER compound, -1..1

export interface ToneBucket { n: number; sum: number; pos: number; neg: number; chaos: number; sarcasm: number }
export interface ToneResult {
  version: 1
  total: ToneBucket
  people: Record<string, ToneBucket>
  years: Record<string, ToneBucket>
  peopleYears: Record<string, Record<string, ToneBucket>>
  months: { key: string; n: number; avg: number }[]
  sunny: MsgPick[]       // warmest messages
  sarcastic: MsgPick[]   // clearest sarcasm cues
}

const EMOJI_WORDS: [RegExp, string][] = [
  [/[😂🤣😆😹]/gu, ' lol '], [/❤\uFE0F?|[💕💖💗💓💞😍🥰😘💘]/gu, ' love '], [/☺\uFE0F?|[😊🙂😃😄😁]/gu, ' happy '],
  [/[🙏]/gu, ' thanks '], [/[👍👌💯🔥✨🎉🥳]/gu, ' great '], [/[😢😞😔💔🥺]/gu, ' sad '],
  [/[😡🤬😠]/gu, ' angry '], [/[😱😨😰]/gu, ' scared '], [/[🤢🤮]/gu, ' disgusting '],
]
const HINGLISH: Record<string, string> = {
  accha: 'good', acha: 'good', achha: 'good', mast: 'great', badhiya: 'great', badiya: 'great', zabardast: 'awesome', jhakaas: 'awesome',
  sahi: 'nice', khush: 'happy', khushi: 'happy', pyaar: 'love', pyar: 'love', shukriya: 'thanks', dhanyavad: 'thanks',
  bekar: 'bad', bekaar: 'bad', bakwas: 'nonsense', bura: 'bad', ganda: 'nasty', gussa: 'angry', dukhi: 'sad', pareshan: 'worried',
  pagal: 'crazy', thak: 'tired', bore: 'boring', sorry: 'sorry', jaan: 'darling',
}
const ACK = /^(ok+a*y*|k+|kk+|hm+|hmm+|haan|ha|han|ji|okie|okies)$/i
const SARCASM = /🙄|🙃|😒|😏|🤡|\/s\b|\byeah,? right\b|\bsure,? jan\b|\bwow,? thanks\b|\boh,? great\b|\bthanks a lot\b|\bas if\b|\blove that for me\b|\bcool cool cool\b|\bwhat a surprise\b|\bshocking\b/i
const EYEROLL = /🙄|😒|🙃|😑/

function prep(text: string) {
  let t = text
  for (const [re, w] of EMOJI_WORDS) t = t.replace(re, w)
  return t.replace(/\p{L}+/gu, w => HINGLISH[w.toLowerCase()] ?? w)
}

function chaotic(text: string, burst: boolean) {
  return burst || /\b[A-Z]{4,}\b/.test(text) || /[!?]{2,}/.test(text) || /(\p{L})\1{3,}/u.test(text) || /\b[a-z]{12,}\b/.test(text) && !/[aeiou]{2}/.test(text)
}

const bucket = (): ToneBucket => ({ n: 0, sum: 0, pos: 0, neg: 0, chaos: 0, sarcasm: 0 })
const addTo = (b: ToneBucket, s: number, ch: boolean, sa: boolean) => { b.n++; b.sum += s; if (s >= 0.05) b.pos++; else if (s <= -0.05) b.neg++; if (ch) b.chaos++; if (sa) b.sarcasm++ }

export function analyzeTone(msgs: Message[], score: Scorer, onProgress?: (done: number) => void): ToneResult {
  const total = bucket(), people: Record<string, ToneBucket> = {}, years: Record<string, ToneBucket> = {}, peopleYears: Record<string, Record<string, ToneBucket>> = {}
  const months = new Map<string, { n: number; sum: number }>()
  const sunny: (MsgPick & { s: number })[] = [], sarcastic: MsgPick[] = []
  let runSender = '', runStart = 0, runLen = 0
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m.type !== 'text' || !m.text) continue
    if (m.sender === runSender && m.ts - runStart <= 60_000) runLen++
    else { runSender = m.sender; runStart = m.ts; runLen = 1 }
    const text = m.text.trim()
    const s = ACK.test(text) || !/[\p{L}\p{Extended_Pictographic}]/u.test(text) ? 0 : score(prep(text))
    const sa = SARCASM.test(text) || (s >= 0.4 && EYEROLL.test(text))
    const ch = chaotic(text, runLen >= 4)
    const d = new Date(m.ts), y = String(d.getFullYear()), mk = `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`
    addTo(total, s, ch, sa)
    addTo(people[m.sender] ??= bucket(), s, ch, sa)
    addTo(years[y] ??= bucket(), s, ch, sa)
    addTo((peopleYears[m.sender] ??= {})[y] ??= bucket(), s, ch, sa)
    const mo = months.get(mk) ?? { n: 0, sum: 0 }; mo.n++; mo.sum += s; months.set(mk, mo)
    if (s >= 0.8 && text.length <= 220 && !sunny.some(x => x.text === text)) { sunny.push({ id: m.id, ts: m.ts, sender: m.sender, text, s }); if (sunny.length > 40) { sunny.sort((a, b) => b.s - a.s); sunny.length = 20 } }
    if (sa && sarcastic.length < 12 && text.length <= 200 && !sarcastic.some(x => x.text === text)) sarcastic.push({ id: m.id, ts: m.ts, sender: m.sender, text })
    if (onProgress && i % 5000 === 0) onProgress(i)
  }
  sunny.sort((a, b) => b.s - a.s)
  return {
    version: 1, total, people, years, peopleYears,
    months: [...months].sort((a, b) => a[0].localeCompare(b[0])).map(([key, x]) => ({ key, n: x.n, avg: Math.round((x.sum / x.n) * 1000) / 1000 })),
    sunny: sunny.slice(0, 6).map(({ s: _s, ...p }) => p),
    sarcastic: sarcastic.slice(-6),
  }
}

/** Plain-language read of a bucket: a title and the three numbers it rests on. */
export function verdict(b: ToneBucket): { title: string; positivity: number; chaos: number; sarcasm: number } {
  const positivity = b.n ? (b.pos - b.neg) / b.n : 0
  const chaos = b.n ? b.chaos / b.n : 0
  const sarcasm = b.n ? b.sarcasm / b.n : 0
  // calibrated on real chats: net positivity mostly sits between 5% and 20%; chaos 5–25%;
  // sarcasm cues ~1 per 1,000 messages
  const mood = positivity > 0.15 ? 'sunny' : positivity < 0.04 ? 'salty' : 'balanced'
  const wild = chaos > 0.15
  const base = { sunny: wild ? 'Chaotic good' : 'Sunshine', balanced: wild ? 'Organised chaos' : 'Easy-going', salty: wild ? 'Spicy' : 'Deadpan' }[mood]
  return { title: sarcasm > 0.002 ? `${base}, with a sarcastic streak` : base, positivity, chaos, sarcasm }
}
