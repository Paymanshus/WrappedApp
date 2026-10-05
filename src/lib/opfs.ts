import { db } from './db'

// Media storage. Large exports stream into the Origin Private File System (one folder per
// chat) from the import worker, so a multi-GB zip never sits in memory or in IndexedDB.
// Browsers without OPFS sync handles fall back to ArrayBuffer rows in the Dexie `media` table;
// getMediaBlob() resolves either transparently.

const dirName = (chatId: number) => `chat-${chatId}`
export const safeName = (name: string) => name.replace(/[/\\:*?"<>|]/g, '_')

interface SyncHandle {
  write(buf: Uint8Array, opts: { at: number }): number
  flush(): void
  close(): void
}

async function chatDir(chatId: number, create: boolean) {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(dirName(chatId), { create })
}

/** Worker-only capability check: OPFS + synchronous access handles. */
export async function canWriteOPFS(): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) return false
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle('.probe', { create: true })
    const ok = typeof (fh as unknown as { createSyncAccessHandle?: unknown }).createSyncAccessHandle === 'function'
    await root.removeEntry('.probe').catch(() => {})
    return ok
  } catch {
    return false
  }
}

/** Worker-only: stream bytes into chat-<id>/<name>. Returns bytes written. */
export async function writeToOPFS(chatId: number, name: string, stream: ReadableStream<Uint8Array>): Promise<number> {
  const dir = await chatDir(chatId, true)
  const fh = await dir.getFileHandle(safeName(name), { create: true })
  const handle = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()
  const reader = stream.getReader()
  let pos = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      handle.write(value, { at: pos })
      pos += value.byteLength
    }
    handle.flush()
  } finally {
    handle.close()
  }
  return pos
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  const item = await db.media.get(key)
  if (!item) return null
  if (item.blob) return item.blob
  if (item.bytes) return new Blob([item.bytes], { type: item.mime })
  if (!item.opfs) return null
  try {
    const dir = await chatDir(item.chatId, false)
    const file = await (await dir.getFileHandle(item.opfs)).getFile()
    // OPFS files carry no MIME type; a typed slice is zero-copy
    return file.slice(0, file.size, item.mime)
  } catch {
    return null
  }
}

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    return est ? { used: est.usage ?? 0, quota: est.quota ?? 0 } : null
  } catch {
    return null
  }
}

export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {})
}
