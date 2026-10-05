import { contextAround, readRange, searchChats, DEFAULT_OPTIONS, period, type Doc, type Kind, type Filters } from '../search'
import { statsFor } from '../importer'
import type { ToolSpec } from './drivers'
import type { Chat } from '../types'

// The agent's tools. Every one runs locally against the search index / stats; what goes back to
// the model is compact text: one message per line as  [m:ID] YYYY-MM-DD HH:MM Name: text

const KINDS: Kind[] = ['text', 'photo', 'video', 'voice', 'sticker', 'doc', 'link', 'location', 'deleted']

const filterProps = {
  from: { type: 'array', items: { type: 'string' }, description: 'Only messages sent by these people (names as listed in the chat overview).' },
  after: { type: 'string', description: 'Only messages on or after this date: YYYY, YYYY-MM or YYYY-MM-DD.' },
  before: { type: 'string', description: 'Only messages before this date: YYYY, YYYY-MM or YYYY-MM-DD.' },
  types: { type: 'array', items: { type: 'string', enum: KINDS }, description: 'Only these kinds of message.' },
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'search_messages',
    description: 'Full-text search over the chat. Ranks by relevance; tolerates typos and matches word prefixes. Supports "exact phrase" and -exclude in the query. Returns matching messages with ids, plus how many matched in total and per person. Run several searches with different wordings, spellings and languages (chats often mix English with transliterated Hindi, Spanish, etc.).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find. Empty string to list messages by filters only.' },
        ...filterProps,
        match: { type: 'string', enum: ['all', 'any'], description: 'all = every word must appear (default); any = at least one.' },
        sort: { type: 'string', enum: ['best', 'newest', 'oldest'], description: 'Default best.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Messages to return (default 20).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_messages',
    description: 'Read the conversation in order. Either around a message id (to see what led up to it and how people replied) or a date range (to read what happened on a day or in a period).',
    parameters: {
      type: 'object',
      properties: {
        around_id: { type: 'integer', description: 'Message id to centre on.' },
        before: { type: 'integer', minimum: 0, maximum: 40, description: 'With around_id: earlier messages to include (default 10).' },
        after: { type: 'integer', minimum: 0, maximum: 40, description: 'With around_id: later messages to include (default 10).' },
        from_date: { type: 'string', description: 'Range start, YYYY-MM-DD (or YYYY-MM).' },
        to_date: { type: 'string', description: 'Range end, inclusive, YYYY-MM-DD (or YYYY-MM).' },
        limit: { type: 'integer', minimum: 1, maximum: 120, description: 'With a date range: messages to return (default 60).' },
        offset: { type: 'integer', minimum: 0, description: 'With a date range: skip this many (to page through a long range).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'count_messages',
    description: 'Count messages matching a query/filters, grouped by month, year, person, hour of day or weekday. Use for "how often", "when did … peak", "who says … more".',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match (empty = all messages that pass the filters).' },
        ...filterProps,
        group_by: { type: 'string', enum: ['none', 'year', 'month', 'person', 'hour', 'weekday'] },
      },
      required: ['query', 'group_by'],
      additionalProperties: false,
    },
  },
  {
    name: 'chat_stats',
    description: 'Statistics for the whole chat or one year: messages, words, media and voice notes per person, reply times, who starts conversations, double texts, laughs, questions, top words and emojis, busiest day, streaks.',
    parameters: {
      type: 'object',
      properties: { year: { type: 'integer', description: 'A calendar year; omit for all time.' } },
      additionalProperties: false,
    },
  },
]

export interface ToolContext {
  chat: Chat
  /** Every message the tools have shown the model, by id — answers may only cite these. */
  seen: Map<number, Doc>
}

const pad = (n: number) => String(n).padStart(2, '0')
export function stamp(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const LABEL: Record<string, string> = { image: 'photo', video: 'video', audio: 'voice note', sticker: 'sticker', gif: 'GIF', doc: 'document', contact: 'contact', location: 'location', deleted: 'deleted message' }

export function line(d: Doc, max = 400) {
  const body = d.text.length > max ? d.text.slice(0, max) + '…' : d.text
  const media = LABEL[d.type] && d.type !== 'location' ? `<${LABEL[d.type]}>${body ? ' ' : ''}` : ''
  return `[m:${d.id}] ${stamp(d.ts)} ${d.sender || '(system)'}: ${media}${body.replace(/\n/g, ' ⏎ ')}`
}

class BadInput extends Error {}
const str = (v: unknown, name: string, opt = false): string | undefined => {
  if (v == null && opt) return undefined
  if (typeof v !== 'string') throw new BadInput(`${name} must be a string`)
  return v
}
const int = (v: unknown, name: string, lo: number, hi: number, dflt: number): number => {
  if (v == null) return dflt
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BadInput(`${name} must be a number`)
  return Math.max(lo, Math.min(hi, Math.round(v)))
}
const strs = (v: unknown, name: string): string[] | undefined => {
  if (v == null) return undefined
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new BadInput(`${name} must be a list of strings`)
  return v as string[]
}
const date = (v: unknown, name: string, edge: 0 | 1): number | undefined => {
  const s = str(v, name, true)
  if (!s) return undefined
  const p = period(s.trim())
  if (!p) throw new BadInput(`${name} must look like YYYY, YYYY-MM or YYYY-MM-DD`)
  return p[edge]
}

function filtersFrom(input: Record<string, unknown>, chat: Chat): Filters {
  const f: Filters = {}
  const from = strs(input.from, 'from')
  if (from?.length) {
    const lower = from.map(n => n.toLowerCase())
    f.people = chat.participants.filter(p => lower.some(n => p.toLowerCase().includes(n) || ((n === 'me' || n === 'you') && p === chat.you)))
    if (!f.people.length) throw new BadInput(`nobody called ${from.join(', ')} — participants are: ${chat.participants.join(', ')}`)
  }
  const after = date(input.after, 'after', 0)
  const before = date(input.before, 'before', 0)
  if (after != null) f.from = after
  if (before != null) f.to = before - 1
  const types = strs(input.types, 'types')
  if (types?.length) {
    const bad = types.filter(t => !KINDS.includes(t as Kind))
    if (bad.length) throw new BadInput(`unknown types: ${bad.join(', ')}`)
    f.kinds = types as Kind[]
  }
  return f
}

/** Run one tool call. Returns the text for the model, or throws BadInput (reported back as an error). */
export async function runTool(name: string, raw: unknown, ctx: ToolContext): Promise<string> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new BadInput('arguments must be an object')
  const input = raw as Record<string, unknown>
  const chatId = ctx.chat.id!
  const remember = (docs: Doc[]) => { for (const d of docs) ctx.seen.set(d.id, d) }

  if (name === 'search_messages') {
    const query = str(input.query, 'query') ?? ''
    const limit = int(input.limit, 'limit', 1, 50, 20)
    const sort = input.sort === 'newest' || input.sort === 'oldest' ? input.sort : 'best'
    const r = await searchChats([chatId], {
      text: query, filters: filtersFrom(input, ctx.chat), limit, you: ctx.chat.you,
      options: { ...DEFAULT_OPTIONS, match: input.match === 'any' ? 'any' : 'all', sort },
    })
    remember(r.hits.map(h => h.doc))
    if (!r.total) return `No messages match${query ? ` "${query}"` : ''} with those filters.`
    const busiest = [...r.months].sort((a, b) => b[1] - a[1]).slice(0, 3).filter(m => m[1]).map(([m, c]) => `${m} (${c})`).join(', ')
    const head = `${r.total} messages match (showing ${r.hits.length}, ${sort === 'best' ? 'most relevant first' : `${sort} first`}). By person: ${r.people.map(([n, c]) => `${n} ${c}`).join(', ')}. First ${r.months[0]?.[0]}, last ${r.months[r.months.length - 1]?.[0]}; busiest months ${busiest}.`
    return [head, ...r.hits.map(h => line(h.doc))].join('\n')
  }

  if (name === 'read_messages') {
    if (input.around_id != null) {
      const id = int(input.around_id, 'around_id', 0, Number.MAX_SAFE_INTEGER, 0)
      const docs = await contextAround(chatId, id, int(input.before, 'before', 0, 40, 10), int(input.after, 'after', 0, 40, 10))
      if (!docs.length) throw new BadInput(`no message with id ${id} in this chat`)
      remember(docs)
      return docs.map(d => line(d)).join('\n')
    }
    const from = date(input.from_date, 'from_date', 0)
    const to = date(input.to_date, 'to_date', 1)
    if (from == null && to == null) throw new BadInput('give around_id, or from_date / to_date')
    const limit = int(input.limit, 'limit', 1, 120, 60)
    const offset = int(input.offset, 'offset', 0, 1e9, 0)
    const r = await readRange(chatId, from ?? -Infinity, to ?? Infinity, limit, offset)
    remember(r.docs)
    if (!r.total) return 'No messages in that range.'
    const more = r.total > offset + r.docs.length ? ` (${r.total - offset - r.docs.length} more after these: use offset ${offset + r.docs.length})` : ''
    return [`${r.total} messages in range; showing ${offset + 1}–${offset + r.docs.length}${more}.`, ...r.docs.map(d => line(d))].join('\n')
  }

  if (name === 'count_messages') {
    const query = str(input.query, 'query') ?? ''
    const by = String(input.group_by ?? 'none')
    const r = await searchChats([chatId], { text: query, filters: filtersFrom(input, ctx.chat), limit: 0, you: ctx.chat.you, options: { ...DEFAULT_OPTIONS, sort: 'newest' } })
    const head = `${r.total} messages${query ? ` matching "${query}"` : ''} on ${r.days} different days.`
    if (by === 'person') return `${head}\n` + r.people.map(([n, c]) => `${n}: ${c}`).join('\n')
    if (by === 'month') return `${head}\n` + r.months.filter(([, c]) => c).map(([m, c]) => `${m}: ${c}`).join('\n')
    if (by === 'year') {
      const years = new Map<string, number>()
      for (const [m, c] of r.months) years.set(m.slice(0, 4), (years.get(m.slice(0, 4)) ?? 0) + c)
      return `${head}\n` + [...years].map(([y, c]) => `${y}: ${c}`).join('\n')
    }
    if (by === 'hour') return `${head}\n` + r.hours.map((c, h) => `${pad(h)}:00 ${c}`).join('\n')
    if (by === 'weekday') return `${head}\n` + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `${d}: ${r.weekdays[i]}`).join('\n')
    return head
  }

  if (name === 'chat_stats') {
    const year = input.year == null ? null : int(input.year, 'year', 1990, 2100, 2000)
    const s = await statsFor(chatId, year)
    if (!s.totalMessages) return `No messages${year ? ` in ${year}` : ''}.`
    const rt = (sec: number | null) => (sec == null ? 'n/a' : sec < 90 ? `${Math.round(sec)}s` : sec < 5400 ? `${Math.round(sec / 60)}m` : `${(sec / 3600).toFixed(1)}h`)
    return [
      `${year ?? 'All time'}: ${s.totalMessages} messages, ${s.totalWords} words, ${s.totalMedia} media, ${s.activeDays} active days of ${s.spanDays}.`,
      `Busiest day ${s.biggestDay.date} (${s.biggestDay.count} messages). Longest daily streak ${s.longestStreakDays} days; longest silence ${s.longestDroughtDays} days. Peak hour ${s.peakHour}:00.`,
      ...s.senders.slice(0, 12).map(p => `${p.name}: ${p.messages} msgs, ${p.words} words (avg ${p.avgLen.toFixed(1)}), ${p.media} media, ${p.voiceNotes} voice notes, ${p.laughs} laughs, ${p.questions} questions, started ${p.initiations} conversations, ${p.doubleTexts} double texts, median reply ${rt(p.medianReplySec)}. Top words: ${p.topWords.slice(0, 8).map(w => w[0]).join(', ')}. Top emoji: ${p.topEmojis.slice(0, 5).map(e => e[0]).join(' ')}`),
    ].join('\n')
  }

  throw new BadInput(`unknown tool ${name}`)
}

export const isBadInput = (e: unknown): e is Error => e instanceof BadInput
