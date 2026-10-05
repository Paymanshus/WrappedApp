import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Image as ImageIcon, VideoCamera, Microphone, FileText, Prohibit, Checks, CaretUp, CaretDown, MagnifyingGlass, X, ArrowDown } from '@phosphor-icons/react'
import { db } from '../lib/db'
import { useMediaUrl } from '../lib/useMediaUrl'
import { fmtTime, fmtDate, fmtDay } from '../lib/format'
import { colorMap } from '../lib/people'
import { WhoBar } from './WhoSheet'
import type { Chat, Message } from '../lib/types'

function MediaBody({ msg }: { msg: Message }) {
  const url = useMediaUrl(msg.mediaKey)
  const missing = !msg.mediaKey
  if (msg.type === 'image' || msg.type === 'sticker' || msg.type === 'gif') {
    if (missing || !url) return <Placeholder Icon={ImageIcon} label={msg.type} missing={missing} />
    return <img src={url} loading="lazy" className={`rounded-lg max-w-full sm:max-w-[320px] max-h-[340px] object-cover ${msg.type === 'sticker' ? 'max-w-[140px]' : ''}`} />
  }
  if (msg.type === 'video') {
    if (missing || !url) return <Placeholder Icon={VideoCamera} label="video" missing={missing} />
    return <video src={url} controls preload="metadata" className="rounded-lg max-w-full sm:max-w-[320px] max-h-[340px]" />
  }
  if (msg.type === 'audio') {
    if (missing || !url) return <Placeholder Icon={Microphone} label="voice note" missing={missing} />
    return <audio src={url} controls className="max-w-full w-[260px] h-10" />
  }
  if (msg.type === 'deleted') return (
    <span className="flex items-center gap-1.5 italic text-ink-3 text-sm">
      <Prohibit size={15} /> This message was deleted
    </span>
  )
  return <Placeholder Icon={FileText} label={msg.type} missing={missing} />
}

function Placeholder({ Icon, label, missing }: { Icon: React.ComponentType<{ size?: number; className?: string }>; label: string; missing: boolean }) {
  return (
    <span className="flex items-center gap-2 text-sm text-ink-2 bg-panel-2/60 rounded-lg px-3 py-2 capitalize">
      <Icon size={18} className="text-wa" /> {label}{missing && <span className="text-ink-3 text-xs normal-case">(not in export)</span>}
    </span>
  )
}

function linkify(text: string, highlight?: string) {
  const parts = text.split(/(https?:\/\/\S+)/g)
  return parts.map((p, i) => {
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="text-cat-4 underline break-all">{p}</a>
    if (highlight) {
      const idx = p.toLowerCase().indexOf(highlight.toLowerCase())
      if (idx >= 0) return <span key={i}>{p.slice(0, idx)}<mark className="bg-wa/40 text-ink rounded px-0.5">{p.slice(idx, idx + highlight.length)}</mark>{p.slice(idx + highlight.length)}</span>
    }
    return <span key={i}>{p}</span>
  })
}

interface Row { m: Message; day: string | null; tail: boolean }

const dayNum = (ts: number) => { const d = new Date(ts); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate() }

/** Chat reader: every message, virtualized (only what's on screen is rendered), newest at the
 *  bottom like WhatsApp. Search lists matches; picking one jumps there and ↑/↓ step through them. */
export function Reader({ chat, focus }: { chat: Chat; focus?: { id: number; n: number } | null }) {
  const all = useLiveQuery(
    () => db.messages.where('[chatId+ts]').between([chat.id!, -Infinity], [chat.id!, Infinity]).toArray(),
    [chat.id],
  )
  const stats = useLiveQuery(() => db.stats.get(chat.id!), [chat.id])
  const colors = useMemo(() => (stats ? colorMap(chat, stats) : {}), [chat, stats])
  const list = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)

  const rows = useMemo<Row[] | null>(() => {
    if (!all) return null
    let prevDay = -1
    return all.map((m, i) => {
      const d = dayNum(m.ts)
      const day = d !== prevDay ? fmtDate(m.ts) : null
      prevDay = d
      const prev = all[i - 1]
      return { m, day, tail: !!day || !prev || prev.sender !== m.sender || prev.type === 'system' }
    })
  }, [all])

  // ---- search ----
  const [q, setQ] = useState('')
  const [needle, setNeedle] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [cursor, setCursor] = useState(-1)         // position in `hits`
  const [flash, setFlash] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setNeedle(q.trim().toLowerCase()), 180); return () => clearTimeout(t) }, [q])
  const lower = useMemo(() => all?.map(m => m.text.toLowerCase()) ?? [], [all])
  const hits = useMemo(() => {                      // indices into rows, newest first
    if (needle.length < 2) return []
    const out: number[] = []
    for (let i = lower.length - 1; i >= 0; i--) if (lower[i].includes(needle)) out.push(i)
    return out
  }, [lower, needle])
  useEffect(() => { setCursor(-1); setShowResults(needle.length >= 2) }, [needle])

  // opened from Find / Ask: land on that message and flash it
  const focusIdx = useMemo(() => (focus && rows ? rows.findIndex(r => r.m.id === focus.id) : -1), [focus, rows])
  // the list mounts once rows load: start it on the focused message instead of the bottom
  const initialFocus = useRef<number | null>(null)
  if (initialFocus.current === null && rows) initialFocus.current = focusIdx
  const landed = useRef(false)
  useEffect(() => {
    if (focusIdx < 0) return
    if (!landed.current && initialFocus.current === focusIdx) landed.current = true
    else requestAnimationFrame(() => list.current?.scrollToIndex({ index: focusIdx, align: 'center' }))
    setFlash(focusIdx)
    const t = window.setTimeout(() => setFlash(f => (f === focusIdx ? null : f)), 2200)
    return () => clearTimeout(t)
  }, [focusIdx, focus?.n])

  const jump = (k: number) => {
    if (!hits.length) return
    const c = Math.max(0, Math.min(hits.length - 1, k))
    setCursor(c)
    setShowResults(false)
    setFlash(hits[c])
    requestAnimationFrame(() => list.current?.scrollToIndex({ index: hits[c], align: 'center' }))
    window.setTimeout(() => setFlash(f => (f === hits[c] ? null : f)), 2200)
  }
  const clear = () => { setQ(''); setNeedle(''); setShowResults(false); setCursor(-1) }

  if (!rows) return <div className="flex-1 min-h-0 grid place-items-center text-ink-3 chat-wallpaper">Loading…</div>

  const mark = needle.length >= 2 ? needle : undefined

  return (
    <div className="flex-1 min-h-0 flex flex-col min-w-0 chat-wallpaper">
      {/* search bar */}
      <div className="px-3 sm:px-4 py-2 bg-app/80 backdrop-blur border-b border-stroke flex items-center gap-2">
        <div className="flex-1 relative">
          <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') jump(cursor < 0 ? 0 : cursor + 1); if (e.key === 'Escape') clear() }}
            placeholder="Search in this chat…" aria-label="Search messages"
            className="w-full bg-panel rounded-lg pl-10 pr-9 py-2 text-sm placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-wa"
          />
          {q && <button onClick={clear} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center size-6 rounded-full text-ink-3 hover:text-ink"><X size={14} weight="bold" /></button>}
        </div>
        {mark && (
          <div className="flex items-center gap-1 shrink-0 text-xs text-ink-2">
            <button onClick={() => setShowResults(r => !r)} className="px-1.5 hover:text-ink tabular-nums">
              {hits.length ? (cursor >= 0 ? `${cursor + 1} of ${hits.length.toLocaleString('en-US')}` : `${hits.length.toLocaleString('en-US')} found`) : 'No results'}
            </button>
            <button onClick={() => jump(cursor + 1)} disabled={!hits.length || cursor >= hits.length - 1} aria-label="Older match" className="grid place-items-center size-7 rounded-full hover:bg-panel disabled:opacity-30"><CaretUp size={14} weight="bold" /></button>
            <button onClick={() => jump(cursor - 1)} disabled={cursor <= 0} aria-label="Newer match" className="grid place-items-center size-7 rounded-full hover:bg-panel disabled:opacity-30"><CaretDown size={14} weight="bold" /></button>
          </div>
        )}
      </div>

      {!chat.you && chat.participants.length > 1 && <WhoBar chat={chat} stats={stats} />}

      <div className="relative flex-1 min-h-0">
        <Virtuoso
          ref={list}
          className="h-full"
          data={rows}
          initialTopMostItemIndex={initialFocus.current != null && initialFocus.current >= 0 ? { index: initialFocus.current, align: 'center' } : rows.length - 1}
          alignToBottom
          atBottomStateChange={setAtBottom}
          increaseViewportBy={{ top: 600, bottom: 600 }}
          computeItemKey={(_, r) => r.m.id ?? r.m.ts}
          itemContent={(i, r) => <Bubble row={r} chat={chat} color={colors[r.m.sender]} mark={mark} flash={flash === i} />}
          components={{ Header: () => <div className="h-3" />, Footer: () => <div className="h-4" /> }}
        />

        {!atBottom && !showResults && (
          <button onClick={() => list.current?.scrollToIndex({ index: rows.length - 1, align: 'end', behavior: 'smooth' })} aria-label="Jump to newest"
            className="absolute right-4 bottom-4 grid place-items-center size-11 rounded-full bg-panel shadow-lg text-ink-2 hover:text-ink border border-stroke">
            <ArrowDown size={18} weight="bold" />
          </button>
        )}

        {showResults && (
          <div className="absolute inset-0 z-10 bg-app flex flex-col">
            <div className="px-4 py-2 text-[12.5px] text-ink-3 border-b border-stroke">
              {hits.length ? `${hits.length.toLocaleString('en-US')} messages · newest first · tap one to jump there` : `No messages contain "${q.trim()}"`}
            </div>
            <Virtuoso
              className="flex-1"
              data={hits}
              itemContent={(k, idx) => {
                const m = rows[idx].m
                return (
                  <button onClick={() => jump(k)} className="w-full text-left px-4 py-3 border-b border-stroke/60 hover:bg-panel">
                    <div className="flex justify-between gap-3 text-[12px]">
                      <span className="font-semibold truncate" style={{ color: colors[m.sender] }}>{m.sender === chat.you ? 'You' : m.sender}</span>
                      <span className="text-ink-3 shrink-0">{fmtDay(m.ts)}</span>
                    </div>
                    <div className="mt-0.5 text-[14px] text-ink-2 line-clamp-2 break-words">{linkify(snippet(m.text, needle), mark)}</div>
                  </button>
                )
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** ~140 chars around the first match so long messages still show the hit. */
function snippet(text: string, needle: string) {
  const i = text.toLowerCase().indexOf(needle)
  if (i < 60) return text.slice(0, 140)
  return '…' + text.slice(i - 50, i + 90)
}

function Bubble({ row, chat, color, mark, flash }: { row: Row; chat: Chat; color?: string; mark?: string; flash: boolean }) {
  const { m, day, tail } = row
  const mine = !!chat.you && m.sender === chat.you
  return (
    <div className="px-3 sm:px-6 lg:px-16">
      {day && <DayDivider label={day} />}
      {m.type === 'system' ? (
        <div className="text-center my-2"><span className="inline-block bg-panel rounded-lg px-3 py-1 text-[12px] text-ink-2 max-w-[90%] sm:max-w-[70%]">{m.text}</span></div>
      ) : (
        <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${tail ? 'pt-2' : 'pt-0.5'}`}>
          <div className={`relative max-w-[85%] sm:max-w-[70%] lg:max-w-[65%] rounded-lg px-2.5 py-1.5 shadow-sm transition-shadow ${mine ? 'bg-bubble-out' : 'bg-bubble-in'} ${tail ? (mine ? 'rounded-tr-none' : 'rounded-tl-none') : ''} ${flash ? 'ring-2 ring-wa-bright' : ''}`}>
            {tail && <span className={`absolute top-0 size-2.5 ${mine ? '-right-2 tail-out' : '-left-2 tail-in'}`} />}
            {chat.isGroup && !mine && tail && (
              <div className="text-[12.5px] font-semibold mb-0.5" style={{ color }}>{m.sender}</div>
            )}
            {m.type === 'text'
              ? <span className="text-[14.2px] leading-relaxed whitespace-pre-wrap break-words">{linkify(m.text, mark)}</span>
              : <>
                  <MediaBody msg={m} />
                  {m.text && <div className="mt-1 text-[14.2px] leading-relaxed whitespace-pre-wrap break-words">{linkify(m.text, mark)}</div>}
                </>}
            <span className="float-right ml-2 mt-2 text-[10.5px] text-ink-3 select-none flex items-center gap-1">
              {fmtTime(m.ts)}{mine && <Checks size={15} weight="bold" className="text-read" />}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="text-center py-3">
      <span className="inline-block bg-panel rounded-lg px-3 py-1 text-[12px] text-ink-2 shadow-sm">{label}</span>
    </div>
  )
}
