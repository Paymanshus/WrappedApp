import { db } from './db'
import { colorMap } from './colors'
import type { Chat, ChatStats } from './types'

export { SWATCHES, DEFAULT_COLORS, clashes, colorMap } from './colors'

// People in a chat: who "you" are (your messages go on the right, like WhatsApp) and each
// person's identity color, which flows into the story, posters, dashboard and reader.

// ---------- who is "you" ----------

const ME_KEY = 'wrappedapp-me'

export function savedMyNames(): string[] {
  try { return JSON.parse(localStorage.getItem(ME_KEY) ?? '[]') } catch { return [] }
}

function rememberMe(name: string) {
  try {
    const names = [name, ...savedMyNames().filter(n => n !== name)].slice(0, 8)
    localStorage.setItem(ME_KEY, JSON.stringify(names))
  } catch { /* storage unavailable: the choice still applies to this chat */ }
}

export type YouSource = 'saved' | 'signals' | 'title' | 'user'

/**
 * Best guess at which participant exported the chat, strongest signal first:
 *  1. a name you confirmed before (in this or another chat)
 *  2. lines only the exporter's phone writes ("You deleted this message", "You sent a view once…")
 *  3. 1:1 chats: the export is named after the *other* person, so you're whoever isn't the title
 */
export function guessYou(chat: Pick<Chat, 'name' | 'participants' | 'isGroup'>, mine: Record<string, number> = {}): { you: string | null; source: YouSource | null } {
  const saved = savedMyNames().filter(n => chat.participants.includes(n))
  if (saved.length) return { you: saved[0], source: 'saved' }
  const signal = Object.entries(mine).filter(([n, c]) => c > 0 && chat.participants.includes(n)).sort((a, b) => b[1] - a[1])[0]
  if (signal) return { you: signal[0], source: 'signals' }
  if (!chat.isGroup && chat.participants.length === 2) {
    const i = chat.participants.findIndex(p => p.trim().toLowerCase() === chat.name.trim().toLowerCase())
    if (i >= 0) return { you: chat.participants[1 - i], source: 'title' }
  }
  return { you: null, source: null }
}

/** User picked who they are: save it, and fill it in on other chats that don't know yet. */
export async function setYou(chatId: number, name: string) {
  rememberMe(name)
  await db.chats.update(chatId, { you: name, youSource: 'user' })
  const others = await db.chats.filter(c => c.id !== chatId && !c.you && c.participants.includes(name)).toArray()
  await Promise.all(others.map(c => db.chats.update(c.id!, { you: name, youSource: 'saved' })))
}

// ---------- who's who ----------

/** Everyone in the chat, most active first, with message counts (stats order, then anyone missing). */
export function rankedPeople(chat: Chat, stats?: Pick<ChatStats, 'senders'>): { name: string; messages: number }[] {
  const out = (stats?.senders ?? []).map(s => ({ name: s.name, messages: s.messages }))
  const have = new Set(out.map(p => p.name))
  for (const p of chat.participants) if (!have.has(p)) out.push({ name: p, messages: 0 })
  return out
}

// ---------- colors ----------

/** Give `name` a color. If someone else already has it, they swap, so colors stay unique. */
export async function setColor(chat: Chat, stats: Pick<ChatStats, 'senders'>, name: string, color: string) {
  const map = colorMap(chat, stats)
  const holder = Object.keys(map).find(n => n !== name && map[n] === color)
  const next = { ...(chat.colors ?? {}), [name]: color }
  if (holder) next[holder] = map[name]
  await db.chats.update(chat.id!, { colors: next })
}

export async function resetColors(chatId: number) {
  await db.chats.update(chatId, { colors: undefined })
}
