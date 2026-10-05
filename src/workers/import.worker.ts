/// <reference lib="webworker" />
// Import + stats pipeline, off the main thread. Owns every heavy step: random-access unzip,
// parsing, streaming media into OPFS, bulk Dexie writes and stats. The main thread only
// creates the placeholder chat row and mirrors progress into it (see lib/importer.ts).

import { db } from '../lib/db'
import { readEntries, entryStream, entryBytes, type ZipEntry } from '../lib/zip'
import { parseTxt, toMessages, dropRepeats } from '../lib/parser/parseTxt'
import { computeStats } from '../lib/stats'
import { canWriteOPFS, writeToOPFS, safeName } from '../lib/opfs'
import type { Chat, ChatStats, MediaItem } from '../lib/types'

export type WorkerRequest =
  | { id: number; op: 'import'; file: File; chatId: number; placeholderName: string }
  | { id: number; op: 'stats'; chatId: number; year: number | null; persist: boolean }
  | { id: number; op: 'repair'; chatId: number }
  | { id: number; op: 'tone'; chatId: number }

export type WorkerResponse =
  | { id: number; progress: string }
  | { id: number; done: unknown }
  | { id: number; error: string }

export type ImportSummary = Pick<Chat, 'name' | 'participants' | 'isGroup' | 'messageCount' | 'firstTs' | 'lastTs' | 'lastPreview'> & {
  mine: Record<string, number>   // exporter-only lines per sender → who "you" are (lib/people.ts)
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp',
  opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  pdf: 'application/pdf', vcf: 'text/vcard',
}
const mimeOf = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  const post = (m: Omit<WorkerResponse, 'id'>) => scope.postMessage({ id: req.id, ...m })
  let last = 0
  const progress = (label: string, force = false) => {
    const now = performance.now()
    if (force || now - last > 120) { last = now; post({ progress: label }) }
  }
  try {
    const done = req.op === 'import'
      ? await runImport(req.file, req.chatId, req.placeholderName, progress)
      : req.op === 'repair'
        ? await runRepair(req.chatId)
        : req.op === 'tone'
          ? await runTone(req.chatId, progress)
          : await runStats(req.chatId, req.year, req.persist)
    post({ done })
  } catch (e) {
    post({ error: e instanceof Error ? e.message : String(e) })
  }
}

async function runImport(file: File, chatId: number, placeholderName: string, progress: (l: string, force?: boolean) => void): Promise<ImportSummary> {
  let txt = ''
  let media: ZipEntry[] = []

  if (/\.zip$/i.test(file.name)) {
    progress('Reading archive…', true)
    const entries = await readEntries(file)
    const base = (e: ZipEntry) => e.name.split('/').pop() ?? ''
    const txts = entries.filter(e => /\.txt$/i.test(base(e)) && !base(e).startsWith('._'))
    const chatTxt = txts.find(e => base(e) === '_chat.txt') ?? txts[0]
    if (!chatTxt) throw new Error('No chat .txt found inside the zip. Export the chat again from WhatsApp.')
    txt = new TextDecoder('utf-8').decode(await entryBytes(file, chatTxt))
    media = entries.filter(e => e !== chatTxt && !base(e).startsWith('._') && !e.name.startsWith('__MACOSX/'))
  } else {
    txt = await file.text()
  }

  progress('Parsing messages…', true)
  const raws = parseTxt(txt)
  if (!raws.length) throw new Error('No messages found. Is this a WhatsApp chat export?')

  const participants = [...new Set(raws.filter(r => r.sender).map(r => r.sender))]
  const name = placeholderName !== file.name.replace(/\.(zip|txt)$/i, '')
    ? placeholderName
    : (participants.length === 2 ? participants.join(' & ') : placeholderName)

  // media: stream each entry straight to OPFS (or an ArrayBuffer row when OPFS sync handles are missing)
  const mediaKeys = new Set<string>()
  if (media.length) {
    const opfs = await canWriteOPFS()
    const batch: MediaItem[] = []
    for (let i = 0; i < media.length; i++) {
      const e = media[i]
      const fn = e.name.split('/').pop()!
      const mime = mimeOf(fn)
      progress(`Saving media ${i + 1} of ${media.length}…`)
      const stream = await entryStream(file, e)
      if (opfs) {
        const size = await writeToOPFS(chatId, fn, stream)
        batch.push({ key: `${chatId}:${fn}`, chatId, name: fn, mime, opfs: safeName(fn), size })
      } else {
        const bytes = await new Response(stream).arrayBuffer()
        batch.push({ key: `${chatId}:${fn}`, chatId, name: fn, mime, bytes, size: bytes.byteLength })
      }
      mediaKeys.add(fn)
      if (batch.length >= (opfs ? 50 : 8)) await db.media.bulkPut(batch.splice(0))
    }
    if (batch.length) await db.media.bulkPut(batch)
  }

  const messages = toMessages(raws, chatId, mediaKeys)
  const CHUNK = 5000
  for (let i = 0; i < messages.length; i += CHUNK) {
    progress(`Saving messages ${Math.min(i + CHUNK, messages.length).toLocaleString('en-US')} of ${messages.length.toLocaleString('en-US')}…`, true)
    await db.messages.bulkAdd(messages.slice(i, i + CHUNK))
  }

  progress('Crunching numbers…', true)
  await db.stats.put(computeStats(chatId, messages))

  const mine: Record<string, number> = {}
  for (const r of raws) if (r.mine && r.sender) mine[r.sender] = (mine[r.sender] ?? 0) + 1
  const real = raws.filter(r => r.type !== 'system')
  const lastReal = real[real.length - 1]
  return {
    name,
    participants,
    isGroup: participants.length > 2,
    messageCount: real.length,
    firstTs: raws[0].ts,
    lastTs: raws[raws.length - 1].ts,
    lastPreview: lastReal ? (lastReal.text || `[${lastReal.type}]`).slice(0, 80) : '',
    mine,
  }
}

async function runStats(chatId: number, year: number | null, persist: boolean): Promise<ChatStats> {
  const lo = year == null ? -Infinity : new Date(year, 0, 1).getTime()
  const hi = year == null ? Infinity : new Date(year + 1, 0, 1).getTime() - 1
  const msgs = await db.messages.where('[chatId+ts]').between([chatId, lo], [chatId, hi], true, true).toArray()
  const stats = computeStats(chatId, msgs, year)
  if (persist && year == null) await db.stats.put(stats)
  return stats
}

export interface RepairResult { removed: number; messageCount: number }

/** Chats imported before the parser dropped repeated export blocks: remove the copies in place. */
async function runRepair(chatId: number): Promise<RepairResult> {
  const rows = await db.messages.where('chatId').equals(chatId).toArray()   // primary-key (= file) order
  rows.sort((a, b) => a.id! - b.id!)
  const { kept, dropped } = dropRepeats(rows, rows.some(r => r.ts % 60000 !== 0))
  const messageCount = kept.filter(r => r.type !== 'system').length
  if (dropped.length) {
    await db.messages.bulkDelete(dropped.map(i => rows[i].id!))
    const kept = await db.messages.where('[chatId+ts]').between([chatId, -Infinity], [chatId, Infinity]).toArray()
    await db.stats.put(computeStats(chatId, kept))
  }
  return { removed: dropped.length, messageCount }
}

/** Opt-in tone check (VADER, loaded only now). Stored in insights so it runs once per chat. */
async function runTone(chatId: number, progress: (l: string, force?: boolean) => void) {
  progress('Loading the word list…', true)
  const [{ default: vader }, { analyzeTone }] = await Promise.all([import('vader-sentiment'), import('../lib/tone')])
  const msgs = await db.messages.where('[chatId+ts]').between([chatId, -Infinity], [chatId, Infinity]).toArray()
  const score = (t: string) => vader.SentimentIntensityAnalyzer.polarity_scores(t).compound
  const value = analyzeTone(msgs, score, done => progress(`Reading the room… ${Math.round((done / msgs.length) * 100)}%`))
  const msgCount = (await db.chats.get(chatId))?.messageCount ?? 0
  await db.insights.put({ chatId, key: 'tone', value, at: Date.now(), msgCount })
  return value
}
