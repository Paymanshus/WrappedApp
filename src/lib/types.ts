export type MsgType =
  | 'text' | 'image' | 'video' | 'audio' | 'sticker' | 'gif' | 'doc'
  | 'contact' | 'location' | 'deleted' | 'system'

export interface Message {
  id?: number
  chatId: number
  ts: number            // epoch ms
  sender: string        // '' for system
  text: string
  type: MsgType
  mediaKey?: string     // key into media table when file present in zip
  replyTo?: number      // id of the quoted message
  reactions?: { by: string; emoji: string }[]
  starred?: boolean
}

export interface Enrichment {
  chatId: number
  msgId: number
  sentiment?: number
  lang?: string
  topic?: string
}

/** Something the user chose to compute (Dig deeper): tone check, an AI recap. */
export interface Insight {
  chatId: number
  key: string            // 'tone' | 'dig:<kind>:<year|all>'
  value: unknown
  at: number
  msgCount: number       // chat size when computed (stale if the chat changes)
  model?: string         // AI recaps: which model wrote it
}

export interface Chat {
  id?: number
  name: string
  participants: string[]
  you: string | null
  isGroup: boolean
  importedAt: number
  messageCount: number
  firstTs: number
  lastTs: number
  lastPreview: string
  status?: 'processing' | 'ready'   // undefined = ready (pre-existing rows)
  storySeen?: number                // epoch ms when the Rewind story was first watched
  youSource?: 'saved' | 'signals' | 'title' | 'user'   // how `you` was decided (lib/people.ts)
  colors?: Record<string, string>   // per-person color overrides (lib/people.ts SWATCHES)
  dataV?: number                    // import pipeline version; < DATA_VERSION gets repaired on open (lib/importer.ts)
}

export interface MediaItem {
  key: string           // `${chatId}:${filename}`
  chatId: number
  name: string
  mime: string
  blob?: Blob           // legacy rows (pre-OPFS imports)
  bytes?: ArrayBuffer   // fallback when OPFS is unavailable (Safari private mode can't store Blobs in IDB)
  opfs?: string         // filename inside OPFS chat-<id>/ folder
  size?: number
}

// ---------- stats ----------

export interface SenderStats {
  name: string
  messages: number
  words: number
  chars: number
  avgLen: number
  media: number
  voiceNotes: number
  stickers: number
  emojis: number
  laughs: number        // haha/lol/😂-bearing messages
  questions: number
  initiations: number   // conversations started (after 6h+ silence)
  medianReplySec: number | null
  doubleTexts: number   // 2+ consecutive msgs before any reply
  topWords: [string, number][]
  topEmojis: [string, number][]
  hours?: number[]      // 24 buckets, local time (stats v2+)
  longest?: MsgPick & { words: number }   // this person's longest text (stats v5+)
}

/** A message picked out by stats (text capped). id may be missing on rows computed at import time. */
export interface MsgPick { id?: number; ts: number; sender: string; text: string; type?: MsgType; mediaKey?: string }

/** Hall of Fame: messages that landed (inferred: exports carry no reactions). */
export interface HallEntry extends MsgPick {
  kind: 'laughs' | 'opener' | 'rant'
  score: number          // laughs credited · messages in the conversation it opened · words in the rant
  people?: number        // distinct people laughing
  count?: number         // rant: messages in the run
  minutes?: number       // opener: how long the conversation ran
}

/** How alike people's vocabularies are, which words they share, and who picked up whose. */
export interface VocabStats {
  period: 'month' | 'quarter'
  periods: string[]                       // '2024-03' or '2024-Q1'
  people: string[]                        // whose lines are drawn (top ≤ 4)
  match: (number | null)[]                // 0–100 similarity per period (null: too little text)
  overall: number                         // 0–100 over the whole range
  shared: { word: string; counts: Record<string, number> }[]
  trends: { word: string; perK: Record<string, number[]> }[]   // uses per 1,000 words, per person, per period
  adopted: { word: string; from: string; to: string; firstTs: number; adoptedTs: number; uses: number }[]
}

/** Moments people were in sync (heuristic: exports have minute or second precision, no typing data). */
export interface Telepathy {
  together: number                        // both broke a 10-min+ silence within seconds / the same minute
  jinx: number                            // different people sent the exact same text within seconds
  jinxWords: [string, number][]
  examples: { kind: 'jinx' | 'together'; a: MsgPick; b: MsgPick }[]
  pairs: { a: string; b: string; n: number }[]   // most in-sync pairs (groups)
  precise: boolean                        // timestamps had seconds
}

export interface ChatStats {
  chatId: number
  version?: number      // STATS_VERSION when computed; older rows are recomputed on open
  year?: number | null  // null/undefined = all time
  totalMessages: number
  totalWords: number
  totalMedia: number
  firstTs: number
  lastTs: number
  spanDays: number
  activeDays: number
  senders: SenderStats[]        // sorted by message count desc
  monthly: { key: string; ts: number; counts: Record<string, number> }[]
  yearly: { year: number; count: number }[]
  heatmap: number[][]           // [7 days][24 hours]
  peakHour: number
  peakDow: number
  longestStreakDays: number
  streakStart: number
  streakEnd: number
  longestDroughtDays: number
  droughtStart: number
  droughtEnd: number
  biggestDay: { date: string; ts: number; count: number }
  dayWindow?: number[]          // 31 daily counts centred on biggestDay (stats v3+)
  sessions: number
  firstMessage: { sender: string; text: string; ts: number } | null
  longestMessage: { sender: string; text: string; ts: number; words: number } | null
  topEmojis: [string, number][]
  hallOfFame?: HallEntry[]      // stats v5+
  vocab?: VocabStats
  telepathy?: Telepathy
}

// ---------- global aggregate (Lane 6) ----------

export interface GlobalStats {
  totalChats: number
  totalMessages: number
  perChat: { chatId: number; name: string; count: number; medianReplySec: number | null; laughDensity: number }[]
  heatmap: number[][]
}
