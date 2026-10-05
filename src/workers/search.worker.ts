/// <reference lib="webworker" />
// Find's worker: builds a search index per chat on first use (~0.25 s per 150k messages), keeps
// it while the chat is unchanged, and answers searches, context and date-range reads for both
// the Find UI and the Ask agent's tools. Message text never leaves this device from here.

import { db } from '../lib/db'
import { ChatIndex, search, type Doc, type SearchInput, type SearchResult } from '../lib/search/engine'

export type SearchRequest =
  | { id: number; op: 'search'; chatIds: number[]; input: SearchInput }
  | { id: number; op: 'context'; chatId: number; msgId: number; before: number; after: number }
  | { id: number; op: 'range'; chatId: number; from: number; to: number; limit: number; offset?: number }
  | { id: number; op: 'warm'; chatId: number }

export type SearchResponse = { id: number; done: unknown } | { id: number; error: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
const cache = new Map<number, { count: number; ix: ChatIndex }>()
const building = new Map<number, Promise<ChatIndex>>()

async function indexFor(chatId: number): Promise<ChatIndex> {
  const count = await db.messages.where('chatId').equals(chatId).count()
  const hit = cache.get(chatId)
  if (hit && hit.count === count) return hit.ix
  let p = building.get(chatId)
  if (!p) {
    p = (async () => {
      const rows = await db.messages.where('[chatId+ts]').between([chatId, -Infinity], [chatId, Infinity]).toArray()
      const docs: Doc[] = rows.map(m => ({ id: m.id!, chatId, ts: m.ts, sender: m.sender, text: m.text, type: m.type, mediaKey: m.mediaKey }))
      const ix = new ChatIndex(docs)
      cache.set(chatId, { count, ix })
      return ix
    })().finally(() => building.delete(chatId))
    building.set(chatId, p)
  }
  return p
}

scope.onmessage = async (ev: MessageEvent<SearchRequest>) => {
  const req = ev.data
  try {
    let done: unknown
    if (req.op === 'search') {
      const ixs = await Promise.all(req.chatIds.map(indexFor))
      done = search(ixs, req.input) satisfies SearchResult
    } else if (req.op === 'context') {
      done = (await indexFor(req.chatId)).context(req.msgId, req.before, req.after)
    } else if (req.op === 'warm') {
      done = (await indexFor(req.chatId)).docs.length
    } else {
      done = (await indexFor(req.chatId)).range(req.from, req.to, req.limit, req.offset)
    }
    scope.postMessage({ id: req.id, done })
  } catch (e) {
    scope.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) })
  }
}
