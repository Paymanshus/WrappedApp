import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { statsFor } from './importer'
import { STATS_VERSION } from './stats'
import type { ChatStats } from './types'

/**
 * All-time stats come from the stored row (recomputed in the worker if it predates
 * STATS_VERSION); a specific year is computed on demand in the worker and cached.
 */
export function useChatStats(chatId: number | null, year: number | null): ChatStats | undefined {
  const stored = useLiveQuery(() => (chatId != null ? db.stats.get(chatId) : undefined), [chatId])
  const [computed, setComputed] = useState<{ key: string; stats: ChatStats } | null>(null)
  const key = `${chatId}:${year}`

  useEffect(() => {
    if (chatId == null) return
    let alive = true
    if (year == null) {
      if (!stored || (stored.version ?? 1) >= STATS_VERSION) return
      statsFor(chatId, null, true).then(s => { if (alive) setComputed({ key, stats: s }) })
    } else {
      statsFor(chatId, year).then(s => { if (alive) setComputed({ key, stats: s }) })
    }
    return () => { alive = false }
  }, [chatId, year, stored, key])

  if (chatId == null) return undefined
  if (computed?.key === key) return computed.stats
  return year == null ? stored : undefined
}
