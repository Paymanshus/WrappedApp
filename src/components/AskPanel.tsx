import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUp, Stop, GearSix, CircleNotch, Check, WarningCircle, MagnifyingGlass, BookOpenText, Hash, ChartBar, Laptop, Cloud, CaretDown, CaretRight, ArrowCounterClockwise } from '@phosphor-icons/react'
import { db } from '../lib/db'
import { runAsk, CITE, citeIds, type Step, type RunUsage, type AskTurn } from '../lib/agent/run'
import { AskError } from '../lib/agent/drivers'
import { PROVIDERS, describe } from '../lib/agent/providers'
import { useAskSettings } from '../lib/agent/store'
import { fmtDate } from '../lib/format'
import { AskSettings } from './AskSettings'
import type { Doc } from '../lib/search'
import type { Chat } from '../lib/types'

// Ask: questions about the chat, answered by an agent that searches and reads it with local tools.
// Shows its work (steps), cites messages you can tap to open, and says what left the device.

interface Exchange {
  q: string
  a: string
  notes: string[]                   // what the model said between tool calls
  steps: Step[]
  seen: Map<number, Doc>
  usage: RunUsage | null
  status: 'running' | 'done' | 'error' | 'stopped'
  error?: { message: string; hint?: string }
  model: string
}

const threads = new Map<number, Exchange[]>()   // per chat, kept while the app is open

const STEP_ICON: Record<string, typeof MagnifyingGlass> = { search_messages: MagnifyingGlass, read_messages: BookOpenText, count_messages: Hash, chat_stats: ChartBar }

export function AskPanel({ chat, onOpen, initial, onInitialUsed }: {
  chat: Chat
  onOpen: (chatId: number, msgId: number) => void
  initial?: { q: string; n: number } | null     // a question sent from elsewhere (Dig deeper)
  onInitialUsed?: () => void
}) {
  const { config, keys } = useAskSettings()
  const stats = useLiveQuery(() => db.stats.get(chat.id!), [chat.id])
  const [thread, setThread] = useState<Exchange[]>(() => threads.get(chat.id!) ?? [])
  useEffect(() => { threads.set(chat.id!, thread) }, [chat.id, thread])
  const [q, setQ] = useState('')
  const [settings, setSettings] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const running = thread.some(x => x.status === 'running')
  useEffect(() => () => abort.current?.abort(), [])

 // a question handed over from the dashboard: send it once a model is set, else prefill it
  useEffect(() => {
    if (!initial) return
    onInitialUsed?.()
    if (config.answer) ask(initial.q)
    else { setQ(initial.q); setSettings(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per handed-over question
  }, [initial?.n])

  const patchLast = (f: (x: Exchange) => Exchange) => setThread(t => t.map((x, i) => (i === t.length - 1 ? f(x) : x)))

  async function ask(question: string) {
    const text = question.trim()
    if (!text || running) return
    if (!config.answer) { setSettings(true); return }
    setQ('')
    const history: AskTurn[] = thread.filter(x => x.status === 'done' && x.a).map(x => ({ q: x.q, a: x.a }))
    const ac = new AbortController()
    abort.current = ac
    setThread(t => [...t, { q: text, a: '', notes: [], steps: [], seen: new Map(), usage: null, status: 'running', model: describe(config.answer) }])
    requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
    try {
      const r = await runAsk({
        question: text, history, chat, stats, config, keys, signal: ac.signal,
        onEvent: e => {
          if (e.type === 'text') patchLast(x => ({ ...x, a: x.a + e.text }))
          else if (e.type === 'retract') patchLast(x => ({ ...x, notes: x.a.trim() ? [...x.notes, x.a.trim()] : x.notes, a: '' }))
          else if (e.type === 'step') patchLast(x => ({ ...x, steps: x.steps.some(s => s.id === e.step.id) ? x.steps.map(s => (s.id === e.step.id ? e.step : s)) : [...x.steps, e.step] }))
          else if (e.type === 'usage') patchLast(x => ({ ...x, usage: e.usage }))
        },
      })
      patchLast(x => ({ ...x, a: r.text, seen: r.seen, usage: r.usage, status: 'done' }))
    } catch (e) {
      if (ac.signal.aborted) { patchLast(x => ({ ...x, status: 'stopped' })); return }
      const err = e instanceof AskError ? { message: e.message, hint: e.hint } : { message: e instanceof Error ? e.message : String(e) }
      patchLast(x => ({ ...x, status: 'error', error: err }))
    }
  }

  const local = config.answer && PROVIDERS[config.answer.provider].local
  const readerLocal = config.reader && PROVIDERS[config.reader.provider].local
  const privacy = !config.answer ? null
    : local && (!config.reader || readerLocal) ? { Icon: Laptop, text: 'Runs on this device. Nothing leaves it.' }
      : config.reader && readerLocal ? { Icon: Laptop, text: `Message text stays on this device; ${PROVIDERS[config.answer.provider].label} sees the reader's notes.` }
        : { Icon: Cloud, text: `Messages its searches find are sent to ${PROVIDERS[(config.reader ?? config.answer).provider].label}.` }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-chatbg">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-3 sm:px-6 py-5 space-y-8">
          {!thread.length && <AskHome chat={chat} configured={!!config.answer} onAsk={ask} onSetup={() => setSettings(true)} />}
          {thread.map((x, i) => (
            <ExchangeView key={i} x={x} chatId={chat.id!} you={chat.you} onOpen={onOpen}
              onRetry={i === thread.length - 1 && (x.status === 'error' || x.status === 'stopped') ? () => { setThread(t => t.slice(0, -1)); ask(x.q) } : undefined} />
          ))}
          <div ref={bottom} />
        </div>
      </div>

      <div className="border-t border-stroke bg-app px-3 sm:px-6 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          <form onSubmit={e => { e.preventDefault(); ask(q) }} className="flex items-end gap-2">
            <textarea value={q} onChange={e => setQ(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(q) } }}
              placeholder={config.answer ? `Ask anything about ${chat.name}…` : 'Set up a model to start asking'} aria-label="Ask a question"
              className="flex-1 max-h-40 resize-none field-sizing-content bg-panel rounded-2xl px-4 py-3 text-[15px] placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-wa" />
            {running
              ? <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="grid place-items-center size-12 shrink-0 rounded-full bg-panel-2 text-ink hover:bg-panel"><Stop size={18} weight="fill" /></button>
              : <button type="submit" disabled={!q.trim()} aria-label="Send question" className="grid place-items-center size-12 shrink-0 rounded-full bg-wa text-app hover:bg-wa-bright disabled:opacity-40 transition-colors"><ArrowUp size={20} weight="bold" /></button>}
          </form>
          <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-ink-3">
            <span className="flex items-center gap-1.5 min-w-0">
              {privacy && <><privacy.Icon size={13} className={local || readerLocal ? 'text-wa-bright shrink-0' : 'text-read shrink-0'} /><span className="truncate">{privacy.text}</span></>}
            </span>
            <button onClick={() => setSettings(true)} className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-stroke px-2.5 py-1 hover:text-ink hover:border-ink-3">
              <GearSix size={13} /> <span className="max-w-[11rem] truncate">{config.answer ? config.answer.model : 'Choose model'}</span>
            </button>
          </div>
        </div>
      </div>

      {settings && <AskSettings onClose={() => setSettings(false)} />}
    </div>
  )
}

function AskHome({ chat, configured, onAsk, onSetup }: { chat: Chat; configured: boolean; onAsk: (q: string) => void; onSetup: () => void }) {
  const them = chat.isGroup ? 'the group' : chat.participants.find(p => p !== chat.you) ?? 'them'
  const ideas = [
    `What did we talk about most last month?`,
    `When did we first plan a trip together?`,
    `What are our running inside jokes?`,
    chat.isGroup ? 'Who is the funniest in the group, with examples?' : `What does ${them} always say to cheer me up?`,
    'What were the big moments this year?',
    'Who apologizes more, and what for?',
  ]
  return (
    <div className="pt-6 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-wa/15 text-wa-bright"><MagnifyingGlass size={26} weight="bold" /></div>
      <h2 className="mt-4 text-xl font-semibold">Ask {chat.name}</h2>
      <p className="mx-auto mt-1 max-w-md text-[14px] text-ink-2">An AI searches and reads the chat for you, then answers with the messages it found. Tap a source to jump to it.</p>
      {!configured && (
        <button onClick={onSetup} className="mt-5 rounded-full bg-wa hover:bg-wa-bright text-app font-semibold px-6 py-2.5 transition-colors">Set up a model</button>
      )}
      <div className="mx-auto mt-6 grid max-w-2xl gap-2 sm:grid-cols-2 text-left">
        {ideas.map(t => (
          <button key={t} onClick={() => onAsk(t)} disabled={!configured}
            className="rounded-2xl border border-stroke bg-panel/50 px-4 py-3 text-[13.5px] text-ink-2 hover:border-wa/60 hover:text-ink disabled:opacity-50 disabled:hover:border-stroke transition-colors">{t}</button>
        ))}
      </div>
    </div>
  )
}

function ExchangeView({ x, chatId, you, onOpen, onRetry }: { x: Exchange; chatId: number; you: string | null; onOpen: (c: number, m: number) => void; onRetry?: () => void }) {
  const [showSteps, setShowSteps] = useState(false)
  const cited = useMemo(() => {
    const ids: number[] = []
    for (const m of x.a.matchAll(CITE)) for (const id of citeIds(m[1])) if (x.seen.has(id) && !ids.includes(id)) ids.push(id)
    return ids
  }, [x.a, x.seen])
  const running = x.status === 'running'
  const open = showSteps || (running && !x.a)
  return (
    <div>
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-bubble-out px-4 py-2.5 text-[15px] whitespace-pre-wrap break-words">{x.q}</div>
      </div>

      <div className="mt-3">
        {(x.steps.length > 0 || running) && (
          <div className="mb-2">
            <button onClick={() => setShowSteps(s => !s)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
              {running && !x.a ? <CircleNotch size={13} className="animate-spin text-wa-bright" /> : open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
              {running && !x.a ? (x.steps.length ? x.steps[x.steps.length - 1].label + '…' : 'Thinking…') : `${x.steps.length} ${x.steps.length === 1 ? 'step' : 'steps'}`}
            </button>
            {open && x.steps.length > 0 && (
              <ol className="mt-2 ml-1.5 border-l border-stroke pl-4 space-y-2">
                {x.notes.map((n, i) => <li key={`n${i}`} className="text-[12.5px] italic text-ink-3 line-clamp-2">{n}</li>)}
                {x.steps.map(s => {
                  const Icon = STEP_ICON[s.tool] ?? MagnifyingGlass
                  return (
                    <li key={s.id} className="text-[13px]">
                      <div className="flex items-center gap-2 text-ink-2">
                        <Icon size={14} className="shrink-0" /> <span className="min-w-0 break-words">{s.label}</span>
                        {s.status === 'running' && <CircleNotch size={12} className="animate-spin shrink-0" />}
                        {s.status === 'done' && <Check size={12} weight="bold" className="text-wa-bright shrink-0" />}
                        {s.status === 'error' && <WarningCircle size={13} className="text-coral shrink-0" />}
                      </div>
                      {s.result && <div className="ml-[22px] text-[12px] text-ink-3 line-clamp-2">{s.result}</div>}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}

        {x.a && <Answer text={x.a} seen={x.seen} chatId={chatId} you={you} onOpen={onOpen} streaming={running} />}

        {x.status === 'error' && x.error && (
          <div className="mt-2 rounded-xl border border-coral/40 bg-coral/10 px-3.5 py-2.5 text-[13.5px]">
            <div className="flex items-start gap-2"><WarningCircle size={17} weight="fill" className="text-coral mt-px shrink-0" />
              <div className="min-w-0"><div>{x.error.message}</div>{x.error.hint && <div className="mt-0.5 text-ink-2 break-words">{x.error.hint}</div>}</div>
            </div>
          </div>
        )}
        {x.status === 'stopped' && <div className="mt-1 text-[12.5px] text-ink-3">Stopped.</div>}
        {onRetry && <button onClick={onRetry} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-wa-bright hover:underline"><ArrowCounterClockwise size={13} /> Try again</button>}

        {!running && (cited.length > 0
          ? <Sources label="source" ids={cited} seen={x.seen} you={you} onOpen={id => onOpen(chatId, id)} />
          : x.seen.size > 0 && <Sources label="message it read" ids={[...x.seen.keys()].slice(0, 12)} seen={x.seen} you={you} onOpen={id => onOpen(chatId, id)} />)}

        {x.usage && !running && (
          <div className="mt-3 text-[11.5px] text-ink-3">
            {x.model} · {fmtTokens(x.usage.answer.input + x.usage.answer.cacheRead + x.usage.answer.cacheWrite + (x.usage.reader?.input ?? 0))} in / {fmtTokens(x.usage.answer.output + (x.usage.reader?.output ?? 0))} out
            {x.usage.cost != null && x.usage.cost > 0 && <> · about ${x.usage.cost < 0.01 ? x.usage.cost.toFixed(3) : x.usage.cost.toFixed(2)}</>}
            {x.usage.shared > 0
              ? <> · {x.usage.shared} {x.usage.shared === 1 ? 'message' : 'messages'} shared with {x.usage.sharedWith.join(' & ')}</>
              : <> · no message text left this device</>}
          </div>
        )}
      </div>
    </div>
  )
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** Light markdown (paragraphs, lists, **bold**, *italic*, `code`) with [m:ID] citations as chips. */
function Answer({ text, seen, chatId, you, onOpen, streaming }: { text: string; seen: Map<number, Doc>; chatId: number; you: string | null; onOpen: (c: number, m: number) => void; streaming: boolean }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/)
  const inline = (s: string, key: string) => {
    const out: React.ReactNode[] = []
    let last = 0, k = 0
    const re = new RegExp(`${CITE.source}|\\*\\*([^*]+)\\*\\*|\\*([^*\\n]+)\\*|\`([^\`]+)\``, 'g')
    for (const m of s.matchAll(re)) {
      out.push(s.slice(last, m.index))
      if (m[1]) {
        for (const id of citeIds(m[1])) {
          const d = seen.get(id)
          if (d) out.push(<Cite key={`${key}c${k++}`} d={d} you={you} onClick={() => onOpen(chatId, id)} />)
        }
      } else if (m[2]) out.push(<b key={`${key}b${k++}`} className="font-semibold">{m[2]}</b>)
      else if (m[3]) out.push(<i key={`${key}i${k++}`}>{m[3]}</i>)
      else if (m[4]) out.push(<code key={`${key}k${k++}`} className="rounded bg-panel px-1 text-[13px]">{m[4]}</code>)
      last = m.index! + m[0].length
    }
    out.push(s.slice(last))
    return out
  }
  return (
    <div className="text-[15px] leading-relaxed text-ink space-y-3 break-words">
      {blocks.map((b, i) => {
        const lines = b.split('\n')
        if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0])
          const L = ordered ? 'ol' : 'ul'
          return <L key={i} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1.5 marker:text-ink-3`}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${i}-${j}`)}</li>)}</L>
        }
        if (/^#{1,4}\s/.test(b)) return <h4 key={i} className="font-semibold">{inline(b.replace(/^#+\s*/, ''), `${i}`)}</h4>
        return <p key={i} className="whitespace-pre-wrap">{inline(b, `${i}`)}</p>
      })}
      {streaming && <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-wa-bright align-middle" />}
    </div>
  )
}

function Cite({ d, you, onClick }: { d: Doc; you: string | null; onClick: () => void }) {
  const who = d.sender === you ? 'You' : (d.sender || 'Event').split(' ')[0]
  return (
    <button onClick={onClick} title={d.text.slice(0, 200)}
      className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-wa/15 border border-wa/40 px-2 py-px align-[1px] text-[11.5px] font-medium text-wa-bright hover:bg-wa/25 whitespace-nowrap">
      {who} · {new Date(d.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
    </button>
  )
}

function Sources({ label, ids, seen, you, onOpen }: { label: string; ids: number[]; seen: Map<number, Doc>; you: string | null; onOpen: (id: number) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 hover:text-ink">
        {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />} {ids.length} {ids.length === 1 ? label : label.replace(/^(\w+)/, '$1s')}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {ids.map(id => {
            const d = seen.get(id)!
            return (
              <li key={id}>
                <button onClick={() => onOpen(id)} className="w-full rounded-xl bg-panel/60 border border-stroke px-3 py-2 text-left hover:border-wa/50">
                  <div className="flex justify-between gap-3 text-[12px]"><span className="font-semibold truncate">{d.sender === you ? 'You' : d.sender}</span><span className="text-ink-3 shrink-0">{fmtDate(d.ts)}</span></div>
                  <div className="mt-0.5 text-[13px] text-ink-2 line-clamp-2 break-words">{d.text || `<${d.type}>`}</div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
