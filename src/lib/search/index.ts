import type { Doc, SearchInput, SearchResult } from './engine'
import type { SearchRequest, SearchResponse } from '../../workers/search.worker'

export * from './engine'

// Main-thread client for the search worker (one shared worker; indexes stay warm between queries).

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<SearchResponse>) => {
    const p = pending.get(ev.data.id)
    if (!p) return
    pending.delete(ev.data.id)
    if ('error' in ev.data) p.reject(new Error(ev.data.error))
    else p.resolve(ev.data.done)
  }
  worker.onerror = ev => {
    for (const p of pending.values()) p.reject(new Error(ev.message || 'Search crashed.'))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function call<T>(req: DistributiveOmit<SearchRequest, 'id'>): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ ...req, id })
  })
}

export const searchChats = (chatIds: number[], input: SearchInput) => call<SearchResult>({ op: 'search', chatIds, input })
export const contextAround = (chatId: number, msgId: number, before = 3, after = 3) => call<Doc[]>({ op: 'context', chatId, msgId, before, after })
export const readRange = (chatId: number, from: number, to: number, limit: number, offset = 0) =>
  call<{ docs: Doc[]; total: number }>({ op: 'range', chatId, from, to, limit, offset })
/** Build the index ahead of the first query (e.g. when the Search tab opens). */
export const warmIndex = (chatId: number) => call<number>({ op: 'warm', chatId })
