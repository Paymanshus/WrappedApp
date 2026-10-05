import type { Chat } from '../lib/types'
import { EmptyState } from '../App'

export function AllChats({ onOpen: _onOpen }: { onOpen: (c: Chat, m: 'story' | 'chat') => void }) {
  return <EmptyState />
}
