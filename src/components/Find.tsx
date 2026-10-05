import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso'
import {
  MagnifyingGlass, X, Users, CalendarBlank, Shapes, Clock, SlidersHorizontal, ArrowRight, CaretDown, CaretUp,
  ChatText, Image as ImageIcon, VideoCamera, Microphone, Sticker, FileText, LinkSimple, MapPin, Prohibit, Question, Moon, ArrowsDownUp,
} from '@phosphor-icons/react'
import { db } from '../lib/db'
import { colorMap } from '../lib/colors'
import { fmtDate, fmtTime, initials } from '../lib/format'
import { searchChats, contextAround, fold, period, DEFAULT_OPTIONS, type Filters, type SearchOptions, type SearchResult, type Hit, type Doc, type Kind } from '../lib/search'
import { FilterChip, Option, PanelTitle } from './FilterChip'
import { useMediaUrl } from '../lib/useMediaUrl'
import type { Chat } from '../lib/types'

// Find: instant, local full-text search with filters (people, dates, types, time of day, match
// options), a when-did-we-talk-about-it timeline, and jump-to-message. Engine: lib/search.

interface FindState { q: string; filters: Filters; options: SearchOptions; scope: 'chat' | 'all' }
const remembered = new Map<number, FindState>()
const fresh = (): FindState => ({ q: '', filters: {}, options: { ...DEFAULT_OPTIONS }, scope: 'chat' })

const KIND_ROWS: { id: Kind; label: string; Icon: typeof ChatText }[] = [
  { id: 'text', label: 'Text', Icon: ChatText },
  { id: 'photo', label: 'Photos', Icon: ImageIcon },
  { id: 'video', label: 'Videos', Icon: VideoCamera },
  { id: 'voice', label: 'Voice notes', Icon: Microphone },
  { id: 'sticker', label: 'Stickers & GIFs', Icon: Sticker },
  { id: 'doc', label: 'Documents', Icon: FileText },
  { id: 'link', label: 'Links', Icon: LinkSimple },
  { id: 'location', label: 'Locations', Icon: MapPin },
  { id: 'deleted', label: 'Deleted', Icon: Prohibit },
]
const KIND_LABEL = Object.fromEntries(KIND_ROWS.map(k => [k.id, k.label])) as Record<Kind, string>

const DAYPARTS: { label: string; hours: [number, number] }[] = [
  { label: 'After midnight · 12–5am', hours: [0, 5] },
  { label: 'Morning · 5am–12pm', hours: [5, 12] },
  { label: 'Afternoon · 12–5pm', hours: [12, 17] },
  { label: 'Evening · 5–10pm', hours: [17, 22] },
  { label: 'Late night · 10pm–5am', hours: [22, 5] },
]

const PAGE = 120
const DAY = 86400000

const isActive = (s: FindState) => {
  const f = s.filters
  return !!(s.q.trim() || f.people?.length || f.from != null || f.to != null || f.kinds?.length || f.hours || f.days?.length || f.minWords || f.questions)
}

function dateLabel(f: Filters): string | null {
  if (f.from == null && f.to == null) return null
  const a = f.from != null ? new Date(f.from) : null, b = f.to != null ? new Date(f.to + 1) : null
  if (a && b) {
    if (a.getMonth() === 0 && a.getDate() === 1 && b.getMonth() === 0 && b.getDate() === 1 && b.getFullYear() === a.getFullYear() + 1) return String(a.getFullYear())
    if (a.getDate() === 1 && b.getDate() === 1 && (b.getMonth() + 12 * b.getFullYear()) - (a.getMonth() + 12 * a.getFullYear()) === 1)
      return a.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    return `${fmtDate(a.getTime())} – ${fmtDate(f.to!)}`
  }
  return a ? `Since ${fmtDate(a.getTime())}` : `Before ${fmtDate(f.to! + 1)}`
}

/** Highlight every word whose folded form is one of the matched spellings. */
function highlight(text: string, terms: Set<string>) {
  if (!terms.size) return text
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*|\p{Extended_Pictographic}/gu)) {
    if (!terms.has(fold(m[0]).replace(/['’]/g, ''))) continue
    out.push(text.slice(last, m.index), <mark key={m.index} className="bg-wa/35 text-ink rounded-[3px] px-0.5">{m[0]}</mark>)
    last = m.index! + m[0].length
  }
  out.push(text.slice(last))
  return out
}

/** ~220 chars around the first match so long messages still show why they matched. */
function snippet(text: string, terms: Set<string>) {
  if (text.length <= 220) return text
  let at = -1
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu)) if (terms.has(fold(m[0]).replace(/['’]/g, ''))) { at = m.index!; break }
  if (at < 80) return text.slice(0, 220) + '…'
  return '…' + text.slice(at - 70, at + 150) + '…'
}

export function Find({ chat, onOpen }: { chat: Chat; onOpen: (chatId: number, msgId: number) => void }) {
  const [s, setS] = useState<FindState>(() => remembered.get(chat.id!) ?? fresh())
  useEffect(() => { remembered.set(chat.id!, s) }, [chat.id, s])
  const set = (patch: Partial<FindState>) => setS(prev => ({ ...prev, ...patch }))
  const setF = (patch: Partial<Filters>) => setS(prev => ({ ...prev, filters: { ...prev.filters, ...patch } }))
  const setO = (patch: Partial<SearchOptions>) => setS(prev => ({ ...prev, options: { ...prev.options, ...patch } }))

  const stats = useLiveQuery(() => db.stats.get(chat.id!), [chat.id])
  const chats = useLiveQuery(() => db.chats.toArray(), [])
  const ready = useMemo(() => (chats ?? []).filter(c => c.status !== 'processing'), [chats])
  const names = useMemo(() => new Map(ready.map(c => [c.id!, c.name])), [ready])
  const colors = useMemo(() => (stats ? colorMap(chat, stats) : {}), [chat, stats])
  const people = stats?.senders ?? []
  const years = stats?.yearly.map(y => y.year) ?? []

  // ---- run the search (debounced; stale responses dropped) ----
  const [res, setRes] = useState<SearchResult | null>(null)
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const active = isActive(s)
  const chatIds = useMemo(() => (s.scope === 'all' ? ready.map(c => c.id!) : [chat.id!]), [s.scope, ready, chat.id])
  const input = useMemo(() => ({ text: s.q, filters: s.filters, options: s.options, limit: PAGE, you: chat.you }), [s.q, s.filters, s.options, chat.you])
  useEffect(() => {
    const my = ++seq.current
    if (!active) { setRes(null); setHits([]); setBusy(false); return }
    setBusy(true)
    const t = setTimeout(() => {
      searchChats(chatIds, input)
        .then(r => { if (my === seq.current) { setRes(r); setHits(r.hits); setError(null) } })
        .catch(e => { if (my === seq.current) setError(e instanceof Error ? e.message : String(e)) })
        .finally(() => { if (my === seq.current) setBusy(false) })
    }, 140)
    return () => clearTimeout(t)
  }, [active, chatIds, input])
  const more = () => {
    if (!res || hits.length >= res.total) return
    const my = seq.current
    searchChats(chatIds, { ...input, offset: hits.length }).then(r => { if (my === seq.current) setHits(h => [...h, ...r.hits]) })
  }

  const terms = useMemo(() => new Set(res?.terms ?? []), [res])
  const f = s.filters
  const mediaOnly = !s.q.trim() && !!f.kinds?.length && f.kinds.every(k => k === 'photo' || k === 'video' || k === 'sticker')

  // ---- chip labels ----
  const peopleLabel = f.people?.length ? (f.people.length === 1 ? (f.people[0] === chat.you ? 'You' : f.people[0]) : `${f.people.length} people`) : 'People'
  const kindLabel = f.kinds?.length ? (f.kinds.length === 1 ? KIND_LABEL[f.kinds[0]] : `${f.kinds.length} types`) : 'Type'
  const timeOn = !!f.hours || !!f.days?.length
  const timeLabel = timeOn
    ? [f.hours && DAYPARTS.find(d => d.hours[0] === f.hours![0] && d.hours[1] === f.hours![1])?.label.split(' · ')[0], f.days?.length === 2 ? 'Weekends' : f.days?.length === 5 ? 'Weekdays' : null].filter(Boolean).join(', ') || 'Time'
    : 'Time'
  const optsOn = s.options.match !== 'all' || !s.options.fuzzy || s.options.whole || !!f.minWords || !!f.questions || !!f.system

  const pickMonth = (key: string) => {
    const p = period(key)
    if (p) setF({ from: p[0], to: p[1] })
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-app">
      {/* query + filters */}
      <div className="px-3 sm:px-4 pt-3 pb-2 border-b border-stroke bg-app">
        <div className="relative">
          <MagnifyingGlass size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={s.q} onChange={e => set({ q: e.target.value })} autoFocus
            placeholder={s.scope === 'all' ? 'Search all chats…' : `Search ${chat.name}…`} aria-label="Search messages"
            className="w-full bg-panel rounded-xl pl-11 pr-10 py-3 text-[15px] placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-wa" />
          {s.q && <button onClick={() => set({ q: '' })} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center size-7 rounded-full text-ink-3 hover:text-ink"><X size={15} weight="bold" /></button>}
        </div>

        <div className="mt-2.5 flex items-center gap-2 overflow-x-auto md:overflow-visible md:flex-wrap no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0 pb-0.5">
          {ready.length > 1 && (
            <div className="inline-flex shrink-0 rounded-full border border-stroke p-0.5 text-[12.5px]" role="radiogroup" aria-label="Where to search">
              {(['chat', 'all'] as const).map(sc => (
                <button key={sc} role="radio" aria-checked={s.scope === sc} onClick={() => set({ scope: sc })}
                  className={`rounded-full px-2.5 py-1 ${s.scope === sc ? 'bg-panel-2 text-ink font-medium' : 'text-ink-2 hover:text-ink'}`}>{sc === 'chat' ? 'This chat' : 'All chats'}</button>
              ))}
            </div>
          )}

          {s.scope === 'chat' && people.length > 1 && (
            <FilterChip label={peopleLabel} icon={<Users size={14} />} active={!!f.people?.length} onClear={() => setF({ people: undefined })}>
              {() => <PeoplePanel people={people} you={chat.you} colors={colors} value={f.people ?? []} onChange={v => setF({ people: v.length ? v : undefined })} />}
            </FilterChip>
          )}

          <FilterChip label={dateLabel(f) ?? 'Date'} icon={<CalendarBlank size={14} />} active={f.from != null || f.to != null} onClear={() => setF({ from: undefined, to: undefined })} wide>
            {close => <DatePanel years={years} value={f} onChange={(from, to) => { setF({ from, to }); if (from != null || to != null) close() }} />}
          </FilterChip>

          <FilterChip label={kindLabel} icon={<Shapes size={14} />} active={!!f.kinds?.length} onClear={() => setF({ kinds: undefined })}>
            {() => (
              <div role="group" aria-label="Message types">
                {KIND_ROWS.map(({ id, label, Icon }) => (
                  <Option key={id} on={!!f.kinds?.includes(id)} onClick={() => {
                    const next = f.kinds?.includes(id) ? f.kinds.filter(k => k !== id) : [...(f.kinds ?? []), id]
                    setF({ kinds: next.length ? next : undefined })
                  }}><Icon size={16} className="text-ink-2" /> {label}</Option>
                ))}
              </div>
            )}
          </FilterChip>

          <FilterChip label={timeLabel} icon={<Clock size={14} />} active={timeOn} onClear={() => setF({ hours: undefined, days: undefined })}>
            {() => (
              <>
                <PanelTitle>Time of day</PanelTitle>
                <div role="radiogroup">
                  <Option radio on={!f.hours} onClick={() => setF({ hours: undefined })}>Any time</Option>
                  {DAYPARTS.map(d => <Option key={d.label} radio on={f.hours?.[0] === d.hours[0] && f.hours?.[1] === d.hours[1]} onClick={() => setF({ hours: d.hours })}>{d.label}</Option>)}
                </div>
                <PanelTitle>Days</PanelTitle>
                <div role="radiogroup">
                  <Option radio on={!f.days?.length} onClick={() => setF({ days: undefined })}>Every day</Option>
                  <Option radio on={f.days?.length === 5} onClick={() => setF({ days: [1, 2, 3, 4, 5] })}>Weekdays</Option>
                  <Option radio on={f.days?.length === 2} onClick={() => setF({ days: [0, 6] })}>Weekends</Option>
                </div>
              </>
            )}
          </FilterChip>

          <FilterChip label="Options" icon={<SlidersHorizontal size={14} />} active={optsOn} align="right">
            {() => (
              <>
                <PanelTitle>Match</PanelTitle>
                <div role="radiogroup">
                  <Option radio on={s.options.match === 'all'} onClick={() => setO({ match: 'all' })}>All words</Option>
                  <Option radio on={s.options.match === 'any'} onClick={() => setO({ match: 'any' })}>Any word</Option>
                  <Option radio on={s.options.match === 'phrase'} onClick={() => setO({ match: 'phrase' })}>Exact phrase</Option>
                </div>
                <PanelTitle>Spelling</PanelTitle>
                <Option on={s.options.fuzzy} onClick={() => setO({ fuzzy: !s.options.fuzzy })} meta="acha ≈ achha">Forgive typos</Option>
                <Option on={s.options.whole} onClick={() => setO({ whole: !s.options.whole })} meta="goa ≠ goal">Whole words only</Option>
                <PanelTitle>Messages</PanelTitle>
                <Option on={!!f.questions} onClick={() => setF({ questions: f.questions ? undefined : true })}><Question size={16} className="text-ink-2" /> Questions only</Option>
                <Option on={f.minWords === 15} onClick={() => setF({ minWords: f.minWords === 15 ? undefined : 15 })}>Long messages (15+ words)</Option>
                <Option on={!!f.system} onClick={() => setF({ system: f.system ? undefined : true })}>Include group events</Option>
              </>
            )}
          </FilterChip>

          {active && (
            <button onClick={() => setS(prev => ({ ...fresh(), scope: prev.scope }))} className="shrink-0 px-2 py-1.5 text-[13px] text-ink-3 hover:text-ink">Clear all</button>
          )}
        </div>
      </div>

      {/* body */}
      {!active ? (
        <FindHome onPick={patch => setS(prev => ({ ...prev, filters: { ...prev.filters, ...patch.filters }, options: { ...prev.options, ...patch.options } }))} />
      ) : error ? (
        <div className="flex-1 grid place-items-center text-[14px] text-ink-2 px-8 text-center">Search failed: {error}</div>
      ) : !res ? (
        <div className="flex-1 grid place-items-center text-ink-3 text-sm animate-pulse">Searching…</div>
      ) : mediaOnly && res.total > 0 ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <Summary res={res} busy={busy} sort={s.options.sort} onSort={sort => setO({ sort })} onPickMonth={pickMonth} colors={colors} you={chat.you} selected={f} />
          <VirtuosoGrid className="flex-1" data={hits} endReached={more}
            listClassName="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1 p-1"
            itemContent={(_, h) => <Thumb doc={h.doc} onOpen={() => onOpen(h.doc.chatId, h.doc.id)} />} />
        </div>
      ) : (
        <Virtuoso className="flex-1" data={hits} endReached={more} increaseViewportBy={400} components={LIST}
          context={{
            summary: { res, busy, sort: s.options.sort, onSort: sort => setO({ sort }), onPickMonth: pickMonth, colors, you: chat.you, selected: f },
            empty: { q: s.q, filtered: isActive({ ...s, q: '' }), onWiden: () => setS(prev => ({ ...prev, filters: {}, options: { ...prev.options, match: 'any', fuzzy: true, whole: false } })) },
          }}
          itemContent={(_, h) => (
            <HitRow key={h.doc.id} hit={h} terms={terms} you={chat.you} color={h.doc.chatId === chat.id ? colors[h.doc.sender] : undefined}
              chatName={s.scope === 'all' ? names.get(h.doc.chatId) : undefined} onOpen={() => onOpen(h.doc.chatId, h.doc.id)} />
          )}
        />
      )}
    </div>
  )
}

// Virtuoso components live outside the render so its header/empty state aren't remounted per keystroke
interface ListCtx { summary: Parameters<typeof Summary>[0]; empty: Parameters<typeof NoResults>[0] }
const LIST = {
  Header: ({ context }: { context?: ListCtx }) => (context ? <Summary {...context.summary} /> : null),
  Footer: () => <div className="h-6" />,
  EmptyPlaceholder: ({ context }: { context?: ListCtx }) => (context ? <NoResults {...context.empty} /> : null),
}

// ---------- panels ----------

function PeoplePanel({ people, you, colors, value, onChange }: { people: { name: string; messages: number }[]; you: string | null; colors: Record<string, string>; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('')
  const shown = q ? people.filter(p => p.name.toLowerCase().includes(q.toLowerCase())) : people
  return (
    <>
      {people.length > 8 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" autoFocus
          className="mb-2 w-full bg-panel-2 rounded-lg px-3 py-2 text-sm placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-wa" />
      )}
      <div role="group" aria-label="People">
        {shown.map(p => (
          <Option key={p.name} on={value.includes(p.name)} meta={p.messages.toLocaleString('en-US')}
            onClick={() => onChange(value.includes(p.name) ? value.filter(n => n !== p.name) : [...value, p.name])}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: colors[p.name] ?? '#667781' }} />
            <span className="truncate">{p.name}</span>{p.name === you && <span className="text-[11px] text-ink-3">you</span>}
          </Option>
        ))}
      </div>
    </>
  )
}

function DatePanel({ years, value, onChange }: { years: number[]; value: Filters; onChange: (from?: number, to?: number) => void }) {
  const now = Date.now()
  const iso = (ts?: number) => (ts == null ? '' : new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  const presets: [string, number][] = [['Last 7 days', 7], ['Last 30 days', 30], ['Last 12 months', 365]]
  return (
    <>
      <PanelTitle>Quick</PanelTitle>
      <div className="flex flex-wrap gap-1.5 px-1 pb-2">
        {presets.map(([l, d]) => (
          <button key={l} onClick={() => onChange(now - d * DAY, undefined)} className="rounded-full bg-panel-2 border border-transparent px-3 py-1 text-[13px] hover:border-wa hover:text-wa-bright">{l}</button>
        ))}
      </div>
      {years.length > 0 && (
        <>
          <PanelTitle>Year</PanelTitle>
          <div className="flex flex-wrap gap-1.5 px-1 pb-2">
            {years.map(y => {
              const [a, b] = period(String(y))!
              const on = value.from === a && value.to === b
              return <button key={y} onClick={() => onChange(a, b)} aria-pressed={on}
                className={`rounded-full border px-3 py-1 text-[13px] tabular-nums ${on ? 'bg-wa text-app border-wa font-semibold' : 'bg-panel-2 border-transparent hover:border-wa hover:text-wa-bright'}`}>{y}</button>
            })}
          </div>
        </>
      )}
      <PanelTitle>Between</PanelTitle>
      <div className="grid grid-cols-2 gap-2 px-1">
        <label className="text-[12px] text-ink-3">From
          <input type="date" value={iso(value.from)} onChange={e => onChange(e.target.value ? new Date(e.target.value + 'T00:00').getTime() : undefined, value.to)}
            className="mt-1 w-full bg-panel-2 rounded-lg px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-wa [color-scheme:dark]" />
        </label>
        <label className="text-[12px] text-ink-3">To
          <input type="date" value={iso(value.to)} onChange={e => onChange(value.from, e.target.value ? new Date(e.target.value + 'T23:59:59.999').getTime() : undefined)}
            className="mt-1 w-full bg-panel-2 rounded-lg px-2 py-1.5 text-[13px] text-ink outline-none focus:ring-1 focus:ring-wa [color-scheme:dark]" />
        </label>
      </div>
    </>
  )
}

// ---------- results ----------

function Summary({ res, busy, sort, onSort, onPickMonth, colors, you, selected }: {
  res: SearchResult; busy: boolean; sort: SearchOptions['sort']; onSort: (s: SearchOptions['sort']) => void
  onPickMonth: (key: string) => void; colors: Record<string, string>; you: string | null; selected: Filters
}) {
  const hasWords = res.parsed.terms.length + res.parsed.phrases.length > 0
  return (
    <div className="px-3 sm:px-4 pt-3 pb-1">
      <div className="flex items-center justify-between gap-3">
        <div className={`text-[13px] text-ink-2 ${busy ? 'opacity-60' : ''}`}>
          <span className="font-semibold text-ink tabular-nums">{res.total.toLocaleString('en-US')}</span> {res.total === 1 ? 'message' : 'messages'}
          {res.total > 0 && <> on <span className="tabular-nums">{res.days.toLocaleString('en-US')}</span> {res.days === 1 ? 'day' : 'days'}</>}
          <span className="text-ink-3"> · {res.ms} ms</span>
        </div>
        <label className="relative inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <ArrowsDownUp size={14} />
          <select value={sort} onChange={e => onSort(e.target.value as SearchOptions['sort'])} aria-label="Sort results"
            className="appearance-none bg-transparent pr-4 outline-none cursor-pointer hover:text-ink">
            {hasWords && <option value="best">Best match</option>}
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="longest">Longest</option>
          </select>
          <CaretDown size={11} className="pointer-events-none absolute right-0" />
        </label>
      </div>
      {res.total > 0 && res.months.length > 1 && <HitTimeline months={res.months} onPick={onPickMonth} selected={selected} />}
      {res.total > 0 && res.people.length > 1 && <WhoSaysIt people={res.people} colors={colors} you={you} />}
    </div>
  )
}

/** Matches per month. Tap a bar to narrow to that month. */
function HitTimeline({ months, onPick, selected }: { months: [string, number][]; onPick: (k: string) => void; selected: Filters }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...months.map(m => m[1]))
  const peak = months.findIndex(m => m[1] === max)
  const show = hover ?? peak
  const monthName = (k: string) => new Date(+k.slice(0, 4), +k.slice(5) - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  const inSel = (k: string) => { const p = period(k)!; return selected.from != null && selected.to != null && p[0] >= selected.from && p[1] <= selected.to }
  const anySel = selected.from != null || selected.to != null
  return (
    <div className="mt-3 rounded-2xl bg-panel/60 border border-stroke px-3 pt-2.5 pb-2">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-ink-3">When it came up</span>
        <span className="text-ink-2 tabular-nums">{hover == null ? 'Peak: ' : ''}<span className="text-ink font-medium">{monthName(months[show][0])}</span> · {months[show][1].toLocaleString('en-US')}</span>
      </div>
      <div className="mt-2 flex items-end h-16" style={{ gap: months.length > 60 ? 1 : 2 }} onMouseLeave={() => setHover(null)}>
        {months.map(([k, c], i) => (
          <button key={k} onClick={() => c && onPick(k)} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
            aria-label={`${monthName(k)}: ${c} messages`} disabled={!c}
            className="group relative flex-1 h-full flex items-end min-w-0">
            <span className={`w-full rounded-t-[3px] transition-colors ${!c ? 'bg-panel-2/40' : (anySel ? inSel(k) : true) ? (hover === i ? 'bg-wa-bright' : 'bg-wa') : 'bg-wa/35'}`}
              style={{ height: c ? `${Math.max(6, (c / max) * 100)}%` : 2 }} />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3 tabular-nums">
        <span>{monthName(months[0][0])}</span><span>{monthName(months[months.length - 1][0])}</span>
      </div>
    </div>
  )
}

function WhoSaysIt({ people, colors, you }: { people: [string, number][]; colors: Record<string, string>; you: string | null }) {
  const total = people.reduce((a, p) => a + p[1], 0)
  const top = people.slice(0, 5)
  const rest = total - top.reduce((a, p) => a + p[1], 0)
  const parts = [...top.map(([n, c]) => ({ n: n === you ? 'You' : n, c, col: colors[n] ?? '#667781' })), ...(rest ? [{ n: 'Everyone else', c: rest, col: '#667781' }] : [])]
  return (
    <div className="mt-3 mb-1">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ gap: 2 }}>
        {parts.map(p => <span key={p.n} style={{ width: `${(p.c / total) * 100}%`, background: p.col }} className="h-full first:rounded-l-full last:rounded-r-full" />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        {parts.map(p => (
          <span key={p.n} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: p.col }} />{p.n} <span className="tabular-nums text-ink-3">{Math.round((p.c / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

const TYPE_ICON: Partial<Record<Doc['type'], typeof ChatText>> = {
  image: ImageIcon, video: VideoCamera, audio: Microphone, sticker: Sticker, gif: Sticker, doc: FileText, contact: FileText, location: MapPin, deleted: Prohibit,
}
const TYPE_WORD: Partial<Record<Doc['type'], string>> = { image: 'Photo', video: 'Video', audio: 'Voice note', sticker: 'Sticker', gif: 'GIF', doc: 'Document', contact: 'Contact', deleted: 'Deleted message' }

function HitRow({ hit, terms, you, color, chatName, onOpen }: { hit: Hit; terms: Set<string>; you: string | null; color?: string; chatName?: string; onOpen: () => void }) {
  const d = hit.doc
  const [ctx, setCtx] = useState<Doc[] | null>(null)
  const [open, setOpen] = useState(false)
  const toggle = async () => {
    if (!open && !ctx) setCtx(await contextAround(d.chatId, d.id, 3, 3))
    setOpen(o => !o)
  }
  const Icon = TYPE_ICON[d.type]
  return (
    <div className="mx-3 sm:mx-4 border-b border-stroke/70">
      <div className="flex gap-3 py-3">
        <span className="mt-0.5 grid place-items-center size-9 shrink-0 rounded-full text-white text-[12.5px] font-bold" style={{ background: color ?? '#2A3942' }}>{d.sender ? initials(d.sender) : '·'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate">
              <span className="font-semibold">{d.sender === you ? 'You' : d.sender || 'Group event'}</span>
              {chatName && <span className="text-ink-3"> · {chatName}</span>}
            </span>
            <span className="shrink-0 text-ink-3 tabular-nums">{fmtDate(d.ts)}, {fmtTime(d.ts)}</span>
          </div>
          <button onClick={onOpen} className="mt-0.5 block w-full text-left text-[14.5px] leading-snug text-ink/90 break-words hover:text-ink">
            {Icon && <span className="inline-flex items-center gap-1 mr-1.5 text-ink-2 align-[-2px]"><Icon size={15} />{!d.text && TYPE_WORD[d.type]}</span>}
            {d.text ? highlight(snippet(d.text, terms), terms) : null}
          </button>
          <div className="mt-1.5 flex items-center gap-4 text-[12.5px]">
            <button onClick={toggle} aria-expanded={open} className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
              {open ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />} Context
            </button>
            <button onClick={onOpen} className="inline-flex items-center gap-1 text-wa-bright hover:underline">Open in chat <ArrowRight size={12} weight="bold" /></button>
          </div>
        </div>
      </div>
      {open && ctx && (
        <div className="mb-3 ml-12 rounded-xl bg-chatbg border border-stroke p-2.5 space-y-1.5">
          {ctx.map(c => (
            <div key={c.id} className={`text-[13px] leading-snug ${c.id === d.id ? 'text-ink' : 'text-ink-2'}`}>
              <span className="text-ink-3 tabular-nums mr-1.5">{fmtTime(c.ts)}</span>
              <span className="font-semibold">{c.sender === you ? 'You' : c.sender || '·'}:</span>{' '}
              {c.text ? (c.id === d.id ? highlight(c.text, terms) : c.text.slice(0, 300)) : <i className="text-ink-3">{TYPE_WORD[c.type] ?? c.type}</i>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Thumb({ doc, onOpen }: { doc: Doc; onOpen: () => void }) {
  const url = useMediaUrl(doc.mediaKey)
  const Icon = TYPE_ICON[doc.type] ?? ImageIcon
  return (
    <button onClick={onOpen} aria-label={`${TYPE_WORD[doc.type] ?? 'Media'} from ${doc.sender}, ${fmtDate(doc.ts)}`}
      className="relative aspect-square overflow-hidden rounded-md bg-panel group">
      {url && (doc.type === 'video'
        ? <video src={url} preload="metadata" muted className="absolute inset-0 h-full w-full object-cover" />
        : <img src={url} loading="lazy" alt="" className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105" />)}
      {!url && <span className="absolute inset-0 grid place-items-center text-ink-3"><Icon size={22} /></span>}
      <span className="absolute left-1 bottom-1 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white/90">{fmtDate(doc.ts)}</span>
      {doc.type === 'video' && url && <VideoCamera size={14} weight="fill" className="absolute right-1.5 top-1.5 text-white drop-shadow" />}
    </button>
  )
}

function NoResults({ q, filtered, onWiden }: { q: string; filtered: boolean; onWiden: () => void }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="text-[15px] font-medium">Nothing found{q.trim() ? ` for "${q.trim()}"` : ''}</div>
      <p className="mt-1 text-[13px] text-ink-2">Try fewer words, another spelling, or {filtered ? 'fewer filters' : 'matching any word'}.</p>
      <button onClick={onWiden} className="mt-4 rounded-full border border-wa/60 px-4 py-1.5 text-[13px] text-wa-bright hover:bg-wa/10">
        {filtered ? 'Remove filters and match any word' : 'Match any word'}
      </button>
    </div>
  )
}

type QuickPick = { filters?: Filters; options?: Partial<SearchOptions> }

function FindHome({ onPick }: { onPick: (p: QuickPick) => void }) {
  const quick: { label: string; Icon: typeof ChatText; p: QuickPick }[] = [
    { label: 'Photos & videos', Icon: ImageIcon, p: { filters: { kinds: ['photo', 'video'] } } },
    { label: 'Links', Icon: LinkSimple, p: { filters: { kinds: ['link'] } } },
    { label: 'Voice notes', Icon: Microphone, p: { filters: { kinds: ['voice'] } } },
    { label: 'Documents', Icon: FileText, p: { filters: { kinds: ['doc'] } } },
    { label: 'Late-night texts', Icon: Moon, p: { filters: { hours: [0, 5] } } },
    { label: 'Questions', Icon: Question, p: { filters: { questions: true } } },
    { label: 'Longest messages', Icon: ChatText, p: { filters: { minWords: 15 }, options: { sort: 'longest' } } },
    { label: 'Where it started', Icon: ArrowsDownUp, p: { filters: { kinds: ['text'] }, options: { sort: 'oldest' } } },
  ]
  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="mx-auto max-w-xl">
        <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-3">Browse</div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {quick.map(({ label, Icon, p }) => (
            <button key={label} onClick={() => onPick(p)}
              className="flex flex-col items-start gap-2 rounded-2xl bg-panel/70 border border-stroke p-3 text-left text-[13.5px] hover:border-wa/60 hover:bg-panel transition-colors">
              <Icon size={20} className="text-wa-bright" />{label}
            </button>
          ))}
        </div>
        <div className="mt-7 text-[12px] font-semibold uppercase tracking-wider text-ink-3">Search tips</div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
          {[
            ['"see you soon"', 'exact phrase'],
            ['goa -flight', 'leave out a word'],
            ['from:rohan', 'messages by someone (from:me for yours)'],
            ['after:2024-06 before:2025', 'dates: a year, month or day'],
            ['has:link  has:photo  has:voice', 'by type'],
            ['is:question', 'only questions'],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt><code className="rounded bg-panel px-1.5 py-0.5 text-[12.5px] text-wa-bright">{k}</code></dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-[12.5px] text-ink-3">Search runs on this device. Typos are forgiven and word starts match ("goa" finds "Goan"); change that under Options.</p>
      </div>
    </div>
  )
}
