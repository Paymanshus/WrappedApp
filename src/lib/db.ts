import Dexie, { type Table } from 'dexie'
import type { Chat, Message, MediaItem, ChatStats, Enrichment, Insight } from './types'

class RewindDB extends Dexie {
  chats!: Table<Chat, number>
  messages!: Table<Message, number>
  media!: Table<MediaItem, string>
  stats!: Table<ChatStats, number>
  enrichment!: Table<Enrichment, [number, number]>
  insights!: Table<Insight, [number, string]>

  constructor() {
    super('wrappedapp')
    this.version(1).stores({
      chats: '++id, name, lastTs',
      messages: '++id, chatId, [chatId+ts]',
      media: 'key, chatId',
      stats: 'chatId',
    })
    this.version(2).stores({
      messages: '++id, chatId, [chatId+ts], [chatId+type]',
      enrichment: '[chatId+msgId], chatId, topic, lang',
    })
    // opt-in results (Dig deeper): tone check, AI recaps — computed only when the user asks
    this.version(3).stores({ insights: '[chatId+key], chatId' })
  }
}

export const db = new RewindDB()

export async function deleteChat(chatId: number) {
  await db.transaction('rw', [db.chats, db.messages, db.media, db.stats, db.enrichment, db.insights], async () => {
    await db.messages.where('chatId').equals(chatId).delete()
    await db.media.where('chatId').equals(chatId).delete()
    await db.enrichment.where('chatId').equals(chatId).delete()
    await db.insights.where('chatId').equals(chatId).delete()
    await db.stats.delete(chatId)
    await db.chats.delete(chatId)
  })
  // OPFS media folder (see opfs.ts); inlined to avoid a db↔opfs import cycle
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(`chat-${chatId}`, { recursive: true })
  } catch { /* nothing stored in OPFS */ }
}
