import { UsersThree } from '@phosphor-icons/react'
import { initials } from '../lib/format'
import type { Chat } from '../lib/types'

export type RingState = 'processing' | 'new' | 'seen'

export function ringState(chat: Chat): RingState {
  if (chat.status === 'processing') return 'processing'
  return chat.storySeen ? 'seen' : 'new'
}

/**
 * Avatar wrapped in a story ring.
 * processing — spinning partial arc while the import crunches
 * new       — full animated gradient ring + glow, story unwatched
 * seen      — subdued static gradient ring, still tappable
 */
export function StoryRing({ chat, color, size = 52, onClick, title }: {
  chat: Chat; color: string; size?: number; onClick?: (e: React.MouseEvent) => void; title?: string
}) {
  const state = ringState(chat)
  const ring = state === 'processing'
    ? 'ring-processing animate-ring-fast'
    : state === 'new'
      ? 'ring-grad animate-ring'
      : 'ring-grad opacity-40'
  const inset = state === 'seen' ? 2 : 2.5

  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={state === 'processing'}
      className={`relative shrink-0 rounded-full ${state === 'new' ? 'glow-green' : ''} ${onClick && state !== 'processing' ? 'cursor-pointer active:scale-95 transition-transform' : 'cursor-default'}`}
      style={{ width: size, height: size }}
    >
      <span className={`absolute inset-0 rounded-full ${ring}`} />
      <span className="absolute rounded-full bg-app" style={{ inset }} />
      <span
        className="absolute rounded-full grid place-items-center text-app font-bold"
        style={{ inset: inset + 2.5, background: color, fontSize: size * 0.32 }}
      >
        {chat.isGroup
          ? <UsersThree weight="fill" size={size * 0.42} />
          : initials(chat.name)}
      </span>
    </button>
  )
}
