import { db, deleteChat } from './db'
import { requestPersistence } from './opfs'
import { guessYou } from './people'
import type { ChatStats } from './types'
import type { ImportSummary, RepairResult, WorkerRequest, WorkerResponse } from '../workers/import.worker'

/** Bump when the import pipeline learns to fix something in already-imported chats (see repairChat). */
export const DATA_VERSION = 1

// Main-thread client for the import worker. Creates the placeholder chat row (so the sidebar
// ring spins immediately), mirrors worker progress into it, and flips it to 'ready'.

export interface ImportResult { chatId: number; name: string; messages: number }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (l: string) => void }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/import.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const msg = ev.data
    const p = pending.get(msg.id)
    if (!p) return
    if ('progress' in msg) p.onProgress?.(msg.progress)
    else if ('error' in msg) { pending.delete(msg.id); p.reject(new Error(msg.error)) }
    else { pending.delete(msg.id); p.resolve(msg.done) }
  }
  worker.onerror = ev => {
    const err = new Error(ev.message || 'The import worker crashed.')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function call<T>(req: DistributiveOmit<WorkerRequest, 'id'>, onProgress?: (l: string) => void): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
    getWorker().postMessage({ ...req, id })
  })
}

/** Import a WhatsApp export: .zip (with media) or bare .txt */
export async function importExport(file: File): Promise<ImportResult> {
  const fname = file.name.replace(/\.(zip|txt)$/i, '')
  const placeholderName = /WhatsApp Chat (?:with|-)\s*(.+)/i.exec(fname)?.[1]?.trim() || fname
  requestPersistence()

  const chatId = await db.chats.add({
    name: placeholderName, participants: [], you: null, isGroup: false,
    importedAt: Date.now(), messageCount: 0, firstTs: 0, lastTs: Date.now(),
    lastPreview: 'Reading export…', status: 'processing',
  })

  try {
    const summary = await call<ImportSummary>(
      { op: 'import', file, chatId, placeholderName },
      label => { db.chats.update(chatId, { lastPreview: label }) },
    )
    const { mine, ...fields } = summary
    const who = guessYou(fields, mine)
    await db.chats.update(chatId, { ...fields, you: who.you, youSource: who.source ?? undefined, status: 'ready', dataV: DATA_VERSION })
    return { chatId, name: summary.name, messages: summary.messageCount }
  } catch (e) {
    await deleteChat(chatId)
    throw e
  }
}

const repairing = new Set<number>()

/** v1: drop repeated blocks that some WhatsApp exports contain (they showed up as duplicate messages). */
export async function repairChat(chatId: number) {
  if (repairing.has(chatId)) return
  repairing.add(chatId)
  try {
    const r = await call<RepairResult>({ op: 'repair', chatId })
    if (r.removed) forgetStats(chatId)
    await db.chats.update(chatId, { dataV: DATA_VERSION, ...(r.removed ? { messageCount: r.messageCount } : {}) })
  } finally { repairing.delete(chatId) }
}

/** Opt-in tone check, run in the worker; progress labels as it reads. */
export function runToneCheck(chatId: number, onProgress?: (l: string) => void) {
  return call<unknown>({ op: 'tone', chatId }, onProgress)
}

const yearCache = new Map<string, Promise<ChatStats>>()

/** Stats for one calendar year (cached), or all-time recompute when persist=true. */
export function statsFor(chatId: number, year: number | null, persist = false): Promise<ChatStats> {
  if (persist) return call<ChatStats>({ op: 'stats', chatId, year, persist })
  const key = `${chatId}:${year}`
  let p = yearCache.get(key)
  if (!p) {
    p = call<ChatStats>({ op: 'stats', chatId, year, persist: false })
    p.catch(() => yearCache.delete(key))
    yearCache.set(key, p)
  }
  return p
}

export function forgetStats(chatId: number) {
  for (const k of yearCache.keys()) if (k.startsWith(`${chatId}:`)) yearCache.delete(k)
}
