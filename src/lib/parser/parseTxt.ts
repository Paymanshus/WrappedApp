import type { Message, MsgType } from '../types'

// Raw parsed line before chatId assignment
export interface RawMsg {
  ts: number
  sender: string
  text: string
  type: MsgType
  attachment?: string
  mine?: boolean      // a line only the exporter's own phone writes ("You deleted…", "You sent a view once…")
}

/** Strip WhatsApp's invisible direction marks. */
const clean = (s: string) => s.replace(/[‎‏‪-‮﻿]/g, '')

// iOS:     [06/07/24, 11:23:45 PM] Name: text
// Android: 06/07/24, 11:23 pm - Name: text
// separators . / -  |  optional seconds  |  optional am/pm (incl U+202F narrow space)
const HEADER = new RegExp(
  String.raw`^(?:\[)?` +
  String.raw`(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})` +          // d1 sep d2 sep d3
  String.raw`,?\s+` +
  String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?` +                  // h:m(:s)
  String.raw`\s*([ap]\.?m\.?)?` +                               // am/pm
  String.raw`(?:\]|\s+-)\s`,                                    // "] " or " - "
  'i'
)

interface Header { d1: number; d2: number; d3: number; h: number; mi: number; s: number; secs: boolean; pm: boolean | null; rest: string }

function matchHeader(line: string): Header | null {
  const m = HEADER.exec(line)
  if (!m) return null
  const ampm = m[7]?.toLowerCase()
  return {
    d1: +m[1], d2: +m[2], d3: +m[3],
    h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0, secs: m[6] != null,
    pm: ampm ? ampm.startsWith('p') : null,
    rest: line.slice(m[0].length),
  }
}

/** Decide date component order by scanning all headers. */
function inferDateOrder(headers: Header[]): (h: Header) => [number, number, number] {
  // year-first? (2024-06-07)
  if (headers.some(h => h.d1 > 999)) return h => [h.d1, h.d2, h.d3]      // y m d
  const dayFirst = headers.some(h => h.d1 > 12)
  const monthFirst = headers.some(h => h.d2 > 12)
  // default DD/MM unless evidence of MM/DD
  const dm = dayFirst || !monthFirst
  return h => {
    const y = h.d3 < 100 ? 2000 + h.d3 : h.d3
    return dm ? [y, h.d2, h.d1] : [y, h.d1, h.d2]
  }
}

const OMITTED: [RegExp, MsgType][] = [
  [/^<media omitted>$/i, 'image'],
  [/^(image|photo) omitted$/i, 'image'],
  [/^video omitted$/i, 'video'],
  [/^audio omitted$/i, 'audio'],
  [/^sticker omitted$/i, 'sticker'],
  [/^gif omitted$/i, 'gif'],
  [/^document omitted$/i, 'doc'],
  [/^contact card omitted$/i, 'contact'],
]

const DELETED = /^(this message was deleted\.?|you deleted this message\.?|message deleted)$/i
// iOS: view-once media is exported as a notice line, not an attachment
const VIEW_ONCE = /^you (sent|received) a view once (message|photo|video|voice message)/i
// iOS appends this to edited messages
const EDITED = /\s*<This message was edited>\s*$/i
// iOS: captioned media / documents → "caption image omitted", "file.pdf • 3 pages document omitted"
const OMITTED_TAIL = /^([\s\S]*?)\s*\b(image|photo|video|audio|sticker|GIF|document|contact card) omitted$/i
const TAIL_TYPE: Record<string, MsgType> = { image: 'image', photo: 'image', video: 'video', audio: 'audio', sticker: 'sticker', gif: 'gif', document: 'doc', 'contact card': 'contact' }

const EXT_TYPE: Record<string, MsgType> = {
  jpg: 'image', jpeg: 'image', png: 'image', heic: 'image',
  webp: 'sticker', gif: 'gif',
  mp4: 'video', mov: 'video', '3gp': 'video',
  opus: 'audio', mp3: 'audio', m4a: 'audio', ogg: 'audio', aac: 'audio', wav: 'audio',
}

function classifyBody(body: string): { text: string; type: MsgType; attachment?: string } {
  const t = body.replace(EDITED, '').trim()
  if (VIEW_ONCE.test(t)) return { text: '', type: 'image' }
  // iOS: <attached: 00000012-PHOTO-2024-01-01.jpg>
  const ios = /^<attached:\s*(.+?)>$/i.exec(t)
  if (ios) {
    const f = ios[1].trim()
    const ext = f.split('.').pop()?.toLowerCase() ?? ''
    return { text: '', type: EXT_TYPE[ext] ?? 'doc', attachment: f }
  }
  // Android: IMG-20240101-WA0001.jpg (file attached)
  const and = /^(.+?)\s+\(file attached\)$/i.exec(t)
  if (and) {
    const f = and[1].trim()
    const ext = f.split('.').pop()?.toLowerCase() ?? ''
    return { text: '', type: EXT_TYPE[ext] ?? 'doc', attachment: f }
  }
  for (const [re, type] of OMITTED) if (re.test(t)) return { text: '', type }
  const tail = OMITTED_TAIL.exec(t)
  if (tail) return { text: tail[1].replace(/\s*•.*$/, '').trim(), type: TAIL_TYPE[tail[2].toLowerCase()] ?? 'doc' }
  if (DELETED.test(t)) return { text: '', type: 'deleted' }
  if (/^location:\s*https?:\/\//i.test(t)) return { text: t, type: 'location' }
  return { text: t, type: 'text' }
}

/** Parse a whole _chat.txt export (iOS or Android, any locale ordering). */
export function parseTxt(raw: string): RawMsg[] {
  const lines = raw.split(/\r?\n/)
  // pass 1: split into records (header line + continuation lines)
  // lrm: iOS prefixes system lines' bodies with U+200E ("Group: ‎Messages and calls are
  // end-to-end encrypted"), which clean() strips — so detect it on the raw line first.
  const records: { h: Header; body: string[]; lrm: boolean }[] = []
  for (const rawLine of lines) {
    const line = clean(rawLine)
    const h = matchHeader(line)
    if (h) records.push({ h, body: [h.rest], lrm: rawLine.includes(': \u200e') })
    else if (records.length) records[records.length - 1].body.push(line)
  }
  if (!records.length) return []

  const order = inferDateOrder(records.map(r => r.h))
  // people who speak somewhere as "Name: text" — used to trust bare "Name:" lines
  const known = new Set<string>()
  for (const r of records) { const i = r.body[0].indexOf(': '); if (i > 0) known.add(r.body[0].slice(0, i).trim()) }
  const out: RawMsg[] = []
  for (const { h, body, lrm } of records) {
    const [y, mo, d] = order(h)
    let hour = h.h
    if (h.pm === true && hour < 12) hour += 12
    if (h.pm === false && hour === 12) hour = 0
    const ts = new Date(y, mo - 1, d, hour, h.mi, h.s).getTime()
    if (!Number.isFinite(ts)) continue

    const first = body[0]
    // "Name: text", or "Name:" alone when the message itself starts with a line break (iOS)
    let colon = first.indexOf(': ')
    if (colon === -1 && first.endsWith(':') && body.length > 1 && known.has(first.slice(0, -1).trim())) colon = first.length - 1
    if (colon === -1) {
      // system message (encryption notice, group events)
      out.push({ ts, sender: '', text: body.join('\n').trim(), type: 'system' })
      continue
    }
    const sender = first.slice(0, colon).trim()
    const rest = [first.slice(colon + 2), ...body.slice(1)].join('\n').replace(/^\n+/, '')
    const { text, type, attachment } = classifyBody(rest)
    if (lrm && type === 'text') {
      out.push({ ts, sender: '', text: text, type: 'system' })
      continue
    }
    const mine = /^\s*you (deleted this message|sent a view once)/i.test(rest) || undefined
    out.push({ ts, sender, text, type, attachment, mine })
  }
  return dropRepeats(out, records.some(r => r.h.secs)).kept
}

const recordKey = (r: { ts: number; sender: string; text: string; type: string }) => `${r.ts}\u0001${r.sender}\u0001${r.type}\u0001${r.text}`

/**
 * WhatsApp exports sometimes repeat a whole stretch of the chat (seen on iOS: the last ~2,300
 * lines were a copy of an earlier block). Drop records identical to an earlier one: always when
 * timestamps carry seconds (two identical messages in the same second don't happen), otherwise
 * only inside a run of 3+ repeats, so a genuine "ok" sent twice in one minute survives.
 * Works on file order, so it also repairs already-imported chats (rows in insertion order).
 */
export function dropRepeats<T extends { ts: number; sender: string; text: string; type: string }>(rows: T[], secs: boolean): { kept: T[]; dropped: number[] } {
  const seen = new Set<string>()
  const dup = rows.map(r => { const k = recordKey(r); if (seen.has(k)) return true; seen.add(k); return false })
  const drop = dup.slice()
  if (!secs) {
    for (let i = 0; i < rows.length;) {
      if (!dup[i]) { i++; continue }
      let j = i
      while (j < rows.length && dup[j]) j++
      if (j - i < 3) for (let k = i; k < j; k++) drop[k] = false
      i = j
    }
  }
  const kept: T[] = [], dropped: number[] = []
  rows.forEach((r, i) => (drop[i] ? dropped.push(i) : kept.push(r)))
  return { kept, dropped }
}

export function toMessages(raws: RawMsg[], chatId: number, mediaKeys: Set<string>): Message[] {
  return raws.map(r => ({
    chatId,
    ts: r.ts,
    sender: r.sender,
    text: r.text,
    type: r.type,
    mediaKey: r.attachment && mediaKeys.has(r.attachment) ? `${chatId}:${r.attachment}` : undefined,
  }))
}
