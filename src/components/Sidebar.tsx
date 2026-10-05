import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, MagnifyingGlass, LockSimple } from '@phosphor-icons/react'
import { db, deleteChat } from '../lib/db'
import { importExport } from '../lib/importer'
import { storageUsage } from '../lib/opfs'
import { fmtCompact, senderColor } from '../lib/format'
import { StoryRing, ringState } from './StoryRing'
import { Fx } from './Fx'
import type { Chat } from '../lib/types'

function timeLabel(ts: number) {
  const d = new Date(ts), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.max(1, Math.round(n / 1e3))} KB`
}

export function Sidebar({ selected, onSelect, className = 'flex', inert }: {
  className?: string
  inert?: boolean
  selected: number | null
  onSelect: (chat: Chat, mode: 'story' | 'chat') => void
}) {
  const chats = useLiveQuery(() => db.chats.orderBy('lastTs').reverse().toArray(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const chatCount = chats?.length ?? 0
  const processing = chats?.some(c => c.status === 'processing')
  useEffect(() => { if (!processing) storageUsage().then(setUsage) }, [chatCount, processing])

  // Each import drops a live "processing" row into the list immediately; the ring
  // spins while it crunches, then lights up as a fresh Rewind. No auto-navigation —
  // the user taps the lit ring when they're ready.
  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      try {
        await importExport(f)
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const visible = chats?.filter(c => c.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <aside inert={inert} className={`${className} w-full md:w-[340px] lg:w-[380px] shrink-0 h-full flex-col bg-app md:border-r border-stroke pt-[env(safe-area-inset-top)]`}>
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-[22px] font-bold tracking-tight">
          Wrapped<span className="text-wa-bright">App</span>
        </h1>
        <button
          onClick={() => fileRef.current?.click()}
          title="Import a WhatsApp export (.zip or .txt)"
          className="relative pulse-ring flex items-center gap-1.5 rounded-full bg-wa hover:bg-wa-bright transition-colors text-app font-semibold text-sm pl-3 pr-4 py-2"
        >
          <Plus size={16} weight="bold" /> Import
        </button>
        <input ref={fileRef} type="file" accept=".zip,.txt" multiple hidden onChange={e => onFiles(e.target.files)} />
      </div>

      {/* search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search or start new… (import a chat)"
            className="w-full bg-panel rounded-lg pl-10 pr-4 py-2 text-sm placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-wa"
          />
        </div>
      </div>

      {/* chat list */}
      <div className="flex-1 overflow-y-auto">
        {visible?.length === 0 && (
          <div className="px-6 py-10 text-center text-ink-3 text-sm leading-relaxed">
            <Fx name="speech" size={44} className="mb-3 opacity-80" />
            <p>No chats yet.<br />
            Export a chat from WhatsApp<br />
            (<span className="text-ink-2">Chat → Export chat → with media</span>)<br />
            and drop the .zip here.</p>
          </div>
        )}
        {visible?.map((c, i) => {
          const state = ringState(c)
          const processing = state === 'processing'
          const fresh = state === 'new'
          return (
            <div
              key={c.id}
              onClick={() => !processing && onSelect(c, 'chat')}
              className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors ${processing ? 'cursor-default' : 'cursor-pointer'} ${selected === c.id ? 'bg-panel-2' : 'hover:bg-panel'}`}
            >
              <StoryRing
                chat={c} color={senderColor(i)} size={52}
                title={processing ? 'Processing…' : fresh ? 'Watch the Rewind' : 'Replay the Rewind'}
                onClick={processing ? undefined : (e) => { e.stopPropagation(); onSelect(c, 'story') }}
              />
              <div className="flex-1 min-w-0 border-b border-stroke/60 pb-3 -mb-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${fresh ? 'font-semibold text-ink' : 'font-medium'}`}>{c.name}</span>
                  {!processing && <span className="text-[11px] text-ink-3 shrink-0">{timeLabel(c.lastTs)}</span>}
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  {processing ? (
                    <span className="text-[13px] text-wa-bright truncate animate-pulse">{c.lastPreview}</span>
                  ) : (
                    <span className="text-[13px] text-ink-2 truncate">
                      {fresh && <span className="text-wa-bright font-medium">New Rewind · </span>}{c.lastPreview}
                    </span>
                  )}
                  {!processing && (
                    <span className="shrink-0 text-[10px] font-bold bg-wa text-app rounded-full px-1.5 py-0.5">
                      {fmtCompact(c.messageCount)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* footer */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-stroke pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-3" title="Stored only in this browser">
          <LockSimple size={12} weight="bold" /> {usage ? `${fmtBytes(usage.used)} on this device` : 'Stored on this device'}
        </span>
        {selected != null && (
          <button
            onClick={async () => { if (confirm('Delete this chat and its media from this device? This cannot be undone.')) { await deleteChat(selected) } }}
            className="text-[11.5px] text-ink-3 hover:text-cat-5 transition-colors"
          >
            Delete chat
          </button>
        )}
      </div>
    </aside>
  )
}
