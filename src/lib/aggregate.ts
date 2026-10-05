import type { GlobalStats } from './types'

export async function computeGlobalStats(): Promise<GlobalStats> {
  return { totalChats: 0, totalMessages: 0, perChat: [], heatmap: [] }
}
