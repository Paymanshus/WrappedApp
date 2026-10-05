import { useMemo, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { rankedPeople, setYou } from '../lib/people'
import { initials } from '../lib/format'
import type { Chat, ChatStats } from '../lib/types'

/** "Which one is you?" bar: the most active people as one-tap chips, everyone else behind search. */
export function WhoBar({ chat, stats }: { chat: Chat; stats?: Pick<ChatStats, 'senders'> }) {
  const [open, setOpen] = useState(false)
  const people = useMemo(() => rankedPeople(chat, stats), [chat, stats])
  const top = people.slice(0, chat.isGroup ? 3 : 2)
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2 bg-panel/90 border-b border-stroke text-[13px]">
      <span className="text-ink-2">Which one is you? Your messages go on the right.</span>
      {top.map(p => (
        <button key={p.name} onClick={() => setYou(chat.id!, p.name)} className="rounded-full bg-wa/15 border border-wa/50 hover:bg-wa/25 px-3 py-1 font-medium max-w-[12rem] truncate">{p.name}</button>
      ))}
      {people.length > top.length && (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-full border border-stroke hover:border-wa hover:text-wa-bright px-3 py-1 text-ink-2">
          <MagnifyingGlass size={13} weight="bold" /> Not listed? Find me
        </button>
      )}
      {open && <WhoSheet chat={chat} people={people} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Searchable list of every participant; picking one sets "you" (and remembers it for other chats). */
export function WhoSheet({ chat, people, onClose }: { chat: Chat; people: { name: string; messages: number }[]; onClose: () => void }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return n ? people.filter(p => p.name.toLowerCase().includes(n)) : people
  }, [people, q])
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center" role="dialog" aria-modal aria-label="Which one is you?">
      <div className="a-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="a-sheet relative w-full md:w-[440px] max-h-[85dvh] flex flex-col bg-app border border-stroke rounded-t-3xl md:rounded-3xl pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="p-5 pb-3">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-panel-2 md:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Which one is you?</h2>
              <p className="text-[13px] text-ink-2">{people.length} people in this chat. We'll remember your name for other chats.</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="grid place-items-center size-9 shrink-0 rounded-full hover:bg-panel text-ink-2"><X size={18} weight="bold" /></button>
          </div>
          <div className="relative mt-3">
            <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type your name as it appears in the chat"
              aria-label="Search people" className="w-full bg-panel rounded-lg pl-10 pr-3 py-2.5 text-sm placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-wa" />
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto px-3">
          {shown.map(p => (
            <li key={p.name}>
              <button onClick={() => { setYou(chat.id!, p.name); onClose() }}
                className={`w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-panel ${chat.you === p.name ? 'bg-wa/10' : ''}`}>
                <span className="grid place-items-center size-9 shrink-0 rounded-full bg-panel-2 text-[13px] font-bold">{initials(p.name)}</span>
                <span className="flex-1 min-w-0 truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{p.messages.toLocaleString('en-US')} msgs</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-2 py-6 text-center text-[13px] text-ink-3">Nobody called "{q.trim()}" has sent a message here.</li>}
        </ul>
      </div>
    </div>
  )
}
