import type { Chat, ChatStats } from './types'

// Per-person identity colors. Pure (no DB) so the story model and renderers can use it.

/** The validated default order (design_spec.md → identity), then five bolder extras. */
export const DEFAULT_COLORS = ['#00A884', '#8b5cf6', '#d97706', '#0284c7', '#e11d48']
export const SWATCHES = [...DEFAULT_COLORS, '#65a30d', '#db2777', '#c026d3', '#0891b2', '#ea580c']

/**
 * Pairs that colorblind (or, for a few, all) viewers can't tell apart on the dark surface —
 * computed with the dataviz palette validator (--mode dark, all pairs). Re-run it if SWATCHES change.
 */
const CLASHES = [
  ['#00A884', '#65a30d'], ['#00A884', '#db2777'], ['#00A884', '#0891b2'], ['#8b5cf6', '#c026d3'],
  ['#d97706', '#65a30d'], ['#d97706', '#ea580c'], ['#0284c7', '#c026d3'], ['#0284c7', '#0891b2'],
  ['#e11d48', '#db2777'], ['#e11d48', '#ea580c'], ['#65a30d', '#ea580c'],
].map(p => p.join('|'))

export const clashes = (a: string, b: string) => CLASHES.includes(`${a}|${b}`) || CLASHES.includes(`${b}|${a}`)

/** name → color for everyone in the chat: defaults by message rank, then the user's overrides. */
export function colorMap(chat: Pick<Chat, 'colors'>, stats: Pick<ChatStats, 'senders'>): Record<string, string> {
  const map: Record<string, string> = {}
  stats.senders.forEach((s, i) => { map[s.name] = DEFAULT_COLORS[i % DEFAULT_COLORS.length] })
  for (const [name, c] of Object.entries(chat.colors ?? {})) if (name in map && SWATCHES.includes(c)) map[name] = c
  return map
}

