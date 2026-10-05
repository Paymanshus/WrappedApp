import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { ArrowRight, Smiley, Megaphone, Lightning, TextAlignLeft, Image as ImageIcon } from '@phosphor-icons/react'
import { Section } from './charts'
import { db } from '../lib/db'
import { fmtDate, fmtNum, fmtTime, fmtDuration } from '../lib/format'
import { useMediaUrl } from '../lib/useMediaUrl'
import type { ChatStats, HallEntry, MsgPick } from '../lib/types'

// Dashboard insights computed with the stats (no setup, no network): Hall of Fame, Telepathy,
// shared vocabulary. Each quote can open the chat at that message.

type Colors = Record<string, string>
type Open = (msgId: number) => void

const tooltipStyle = { background: '#202C33', border: '1px solid #2A3942', borderRadius: 10, fontSize: 12, color: '#E9EDEF' } as const

/** Stats computed at import time may not carry ids; find the row by time + sender. */
async function locate(chatId: number, p: MsgPick): Promise<number | null> {
  if (p.id != null) return p.id
  const m = await db.messages.where('[chatId+ts]').equals([chatId, p.ts]).filter(x => x.sender === p.sender).first()
  return m?.id ?? null
}

function OpenLink({ chatId, p, onOpen, label = 'Open in chat' }: { chatId: number; p: MsgPick; onOpen?: Open; label?: string }) {
  if (!onOpen) return null
  return (
    <button onClick={async () => { const id = await locate(chatId, p); if (id != null) onOpen(id) }}
      className="inline-flex items-center gap-1 text-[12.5px] text-wa-bright hover:underline">{label} <ArrowRight size={12} weight="bold" /></button>
  )
}

function Thumb({ mediaKey }: { mediaKey?: string }) {
  const url = useMediaUrl(mediaKey)
  if (!url) return <span className="inline-flex items-center gap-1.5 text-ink-2 text-[13px]"><ImageIcon size={16} /> A photo or sticker</span>
  return <img src={url} alt="" loading="lazy" className="max-h-44 rounded-lg object-cover" />
}

function Quote({ e, chatId, color, onOpen, badge, you }: { e: MsgPick; chatId: number; color?: string; onOpen?: Open; badge: React.ReactNode; you: string | null }) {
  const [more, setMore] = useState(false)
  const long = e.text.length > 260
  return (
    <figure className="flex flex-col rounded-xl bg-panel-2/40 border border-stroke/60 p-3.5">
      <figcaption className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="font-semibold truncate" style={{ color }}>{e.sender === you ? 'You' : e.sender}</span>
        <span className="shrink-0 text-ink-3 tabular-nums">{fmtDate(e.ts)}, {fmtTime(e.ts)}</span>
      </figcaption>
      <blockquote className="mt-1.5 flex-1 text-[14px] leading-relaxed text-ink whitespace-pre-wrap break-words">
        {e.text ? (long && !more ? e.text.slice(0, 260) + '…' : e.text) : <Thumb mediaKey={e.mediaKey} />}
        {long && <button onClick={() => setMore(m => !m)} className="ml-1 text-[12.5px] text-ink-3 hover:text-ink">{more ? 'less' : 'more'}</button>}
      </blockquote>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-wa-bright">{badge}</span>
        <OpenLink chatId={chatId} p={e} onOpen={onOpen} />
      </div>
    </figure>
  )
}

// ---------- Hall of Fame ----------

const HALL_TABS = [
  { id: 'laughs', label: 'Biggest laughs', Icon: Smiley },
  { id: 'opener', label: 'Openers that took off', Icon: Lightning },
  { id: 'rant', label: 'Epic rants', Icon: Megaphone },
  { id: 'longest', label: 'Longest messages', Icon: TextAlignLeft },
] as const

export function HallOfFame({ stats, chatId, colors, you, onOpen }: { stats: ChatStats; chatId: number; colors: Colors; you: string | null; onOpen?: Open }) {
  const hall = stats.hallOfFame ?? []
  const longest = stats.senders.slice(0, 6).filter(s => s.longest && s.longest.words >= 15).map(s => s.longest!)
  const tabs = HALL_TABS.filter(t => (t.id === 'longest' ? longest.length : hall.some(h => h.kind === t.id)))
  const [tab, setTab] = useState<string>(tabs[0]?.id ?? 'laughs')
  if (!tabs.length) return null
  const active = tabs.some(t => t.id === tab) ? tab : tabs[0].id
  const items: (HallEntry | (MsgPick & { words: number }))[] = active === 'longest' ? longest : hall.filter(h => h.kind === active)
  const badge = (e: (typeof items)[number]) => {
    if (!('kind' in e)) return `${fmtNum(e.words)} words`
    if (e.kind === 'laughs') return `${e.score} ${e.score === 1 ? 'laugh' : 'laughs'}${e.people && e.people > 1 ? ` from ${e.people} people` : ''}`
    if (e.kind === 'opener') return `Started ${fmtNum(e.score)} messages over ${fmtDuration((e.minutes ?? 0) * 60)}`
    return `${fmtNum(e.score)} words in ${e.count} messages`
  }
  return (
    <Section title="Hall of Fame" sub="The messages that landed. WhatsApp exports don't include reactions, so laughs and replies right after a message stand in for them.">
      <div className="mb-3 flex gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Hall of Fame">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} role="tab" aria-selected={active === id} onClick={() => setTab(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors ${active === id ? 'bg-wa text-app font-semibold' : 'bg-panel-2/60 text-ink-2 hover:text-ink'}`}>
            <Icon size={14} weight={active === id ? 'fill' : 'regular'} /> {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((e, i) => <Quote key={`${e.ts}-${i}`} e={e} chatId={chatId} color={colors[e.sender]} onOpen={onOpen} badge={badge(e)} you={you} />)}
      </div>
    </Section>
  )
}

// ---------- Telepathy ----------

export function TelepathySection({ stats, chatId, colors, you, onOpen }: { stats: ChatStats; chatId: number; colors: Colors; you: string | null; onOpen?: Open }) {
  const t = stats.telepathy
  if (!t || t.together + t.jinx === 0) return null
  const name = (n: string) => (n === you ? 'You' : n)
  const group = stats.senders.length > 2
  const window = t.precise ? 'within 10 seconds' : 'in the same minute'
  return (
    <Section title="Telepathy" sub={`Moments you were in sync without being prompted. Counted when, after 10+ minutes of quiet, two people wrote ${window} of each other, or sent the exact same thing ${window}.`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-wa/10 border border-wa/30 p-4">
          <div className="text-[12px] text-ink-2">Telepathy score</div>
          <div className="font-display text-[40px] font-extrabold leading-none text-wa-bright tabular-nums mt-1">{fmtNum(t.together + t.jinx)}</div>
          <div className="text-[11.5px] text-ink-3 mt-1">{(((t.together + t.jinx) / Math.max(1, stats.totalMessages)) * 1000).toFixed(1)} per 1,000 messages</div>
        </div>
        <div className="rounded-xl bg-panel-2/40 p-4">
          <div className="text-[12px] text-ink-2">Broke the silence together</div>
          <div className="font-display text-[30px] font-extrabold tabular-nums">{fmtNum(t.together)}</div>
        </div>
        <div className="rounded-xl bg-panel-2/40 p-4">
          <div className="text-[12px] text-ink-2">Jinx: same words, same time</div>
          <div className="font-display text-[30px] font-extrabold tabular-nums">{fmtNum(t.jinx)}</div>
        </div>
      </div>
      {t.jinxWords.length > 0 && (
        <div className="mt-4">
          <div className="text-[12px] text-ink-3 mb-1.5">Most jinxed</div>
          <div className="flex flex-wrap gap-1.5">
            {t.jinxWords.map(([w, n]) => <span key={w} className="rounded-full border border-wa/40 bg-wa/10 px-2.5 py-1 text-[12.5px] max-w-full truncate">“{w}”{n > 1 && <span className="text-ink-3"> ×{n}</span>}</span>)}
          </div>
        </div>
      )}
      {group && t.pairs.length > 0 && (
        <div className="mt-4 text-[13px] text-ink-2">Most in sync: {t.pairs.slice(0, 3).map((p, i) => <span key={i}>{i ? ' · ' : ''}<span className="text-ink font-medium">{name(p.a)} & {name(p.b)}</span> ({p.n})</span>)}</div>
      )}
      {t.examples.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {t.examples.slice(0, 4).map((x, i) => (
            <div key={i} className="rounded-xl bg-chatbg/70 border border-stroke/60 p-3 text-[13px]">
              <div className="flex items-center justify-between text-[11.5px] text-ink-3 mb-1.5">
                <span>{x.kind === 'jinx' ? 'Jinx' : 'Both at once'} · {fmtDate(x.a.ts)}</span>
                <OpenLink chatId={chatId} p={x.a} onOpen={onOpen} label="Open" />
              </div>
              {[x.a, x.b].map((m, k) => (
                <div key={k} className="leading-snug truncate"><span className="tabular-nums text-ink-3 mr-1.5">{t.precise ? new Date(m.ts).toLocaleTimeString('en-GB') : fmtTime(m.ts)}</span>
                  <span className="font-semibold" style={{ color: colors[m.sender] }}>{name(m.sender)}:</span> {m.text || <i className="text-ink-3">media</i>}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ---------- shared vocabulary ----------

const periodLabel = (k: string) => {
  const q = /^(\d{4})-Q(\d)$/.exec(k)
  if (q) return `Q${q[2]} ${q[1]}`
  return new Date(+k.slice(0, 4), +k.slice(5) - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function VocabularySection({ stats, colors, you }: { stats: ChatStats; colors: Colors; you: string | null }) {
  const v = stats.vocab
  const [word, setWord] = useState(0)
  const matchData = useMemo(() => v?.periods.map((k, i) => ({ k, match: v.match[i] })) ?? [], [v])
  const trend = v?.trends[word]
  const trendData = useMemo(() => (v && trend ? v.periods.map((k, i) => ({ k, ...Object.fromEntries(v.people.map(p => [p, trend.perK[p]?.[i] ?? 0])) })) : []), [v, trend])
  if (!v || !v.shared.length) return null
  const name = (n: string) => (n === you ? 'You' : n)
  const pair = v.people.length === 2
  // headline = typical period (one big pool of all text always looks more alike than any period);
  // trend = first few periods vs the latest few
  const valid = v.match.filter((x): x is number => x != null)
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
  const headline = valid.length >= 2 ? avg(valid) : v.overall
  const k = Math.min(3, Math.floor(valid.length / 2))
  const firstM = k ? avg(valid.slice(0, k)) : null, lastM = k ? avg(valid.slice(-k)) : null
  const yearTicks = (k: string, i: number) => (i === 0 || k.endsWith('-01') || k.endsWith('-Q1') ? k.slice(0, 4) : '')
  const maxShared = Math.max(...v.shared.flatMap(s => Object.values(s.counts)))

  return (
    <Section title={pair ? 'How alike you sound' : 'How alike the group sounds'}
      sub={`Vocabulary match: how similar the words ${pair ? 'you both' : 'the most active people'} use are (common grammar words left out), by ${v.period}.`}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <div className="font-display text-[44px] font-extrabold leading-none text-wa-bright tabular-nums">{headline}%</div>
          <div className="mt-1 text-[13px] text-ink-2">
            alike in a typical {v.period}{firstM != null && lastM != null && valid.length >= 4 && <>, {lastM > firstM + 3 ? 'blending more' : lastM < firstM - 3 ? 'drifting apart' : 'holding steady'} over time ({firstM}% early on → {lastM}% lately)</>}
          </div>
          {v.adopted.length > 0 && (
            <div className="mt-5">
              <div className="text-[12px] text-ink-3 mb-2">Picked up from each other</div>
              <ul className="space-y-2 text-[13px]">
                {v.adopted.map(a => (
                  <li key={a.word} className="leading-snug">
                    <span className="rounded bg-panel-2 px-1.5 py-0.5 font-medium">{a.word}</span>{' '}
                    <span className="text-ink-2"><span style={{ color: colors[a.from] }}>{name(a.from)}</span> said it first; <span style={{ color: colors[a.to] }}>{name(a.to)}</span> picked it up {fmtDate(a.adoptedTs)} and has used it {fmtNum(a.uses)}×</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {valid.length > 1 && (
          <div>
            <div className="text-[12px] text-ink-3 mb-1">Match over time</div>
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={matchData} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="rgba(134,150,160,.12)" vertical={false} />
                <XAxis dataKey="k" tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} tickFormatter={yearTicks} />
                <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(k) => periodLabel(String(k))} formatter={(x) => [`${x}%`, 'Match']} />
                <Line type="monotone" dataKey="match" stroke="#25D366" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="text-[12px] text-ink-3 mb-2">Words you share</div>
          <div className="space-y-2">
            {v.shared.slice(0, 10).map(s => (
              <div key={s.word} className="flex items-center gap-2.5">
                <span className="w-24 shrink-0 truncate text-[13px]">{s.word}</span>
                <div className="flex-1 space-y-0.5">
                  {v.people.map(p => (
                    <div key={p} className="h-1.5 rounded-full bg-panel-2/40 overflow-hidden" title={`${name(p)}: ${s.counts[p] ?? 0}`}>
                      <div className="a-grow h-full rounded-full" style={{ width: `${((s.counts[p] ?? 0) / maxShared) * 100}%`, background: colors[p] }} />
                    </div>
                  ))}
                </div>
                <span className="w-24 shrink-0 text-right text-[11px] text-ink-3 tabular-nums truncate">{v.people.map(p => fmtNum(s.counts[p] ?? 0)).join(' · ')}</span>
              </div>
            ))}
          </div>
          <Legend people={v.people} colors={colors} name={name} />
        </div>

        {v.trends.length > 0 && v.periods.length > 2 && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[12px] text-ink-3">How often each of you says it (per 1,000 words)</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2" role="radiogroup" aria-label="Word">
              {v.trends.map((t, i) => (
                <button key={t.word} role="radio" aria-checked={word === i} onClick={() => setWord(i)}
                  className={`rounded-full px-3 py-1 text-[12.5px] ${word === i ? 'bg-wa text-app font-semibold' : 'bg-panel-2/60 text-ink-2 hover:text-ink'}`}>{t.word}</button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={trendData} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke="rgba(134,150,160,.12)" vertical={false} />
                <XAxis dataKey="k" tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} tickFormatter={yearTicks} />
                <YAxis tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(k) => periodLabel(String(k))} formatter={(x, n) => [`${x} per 1k words`, name(String(n))]} />
                {v.people.map(p => <Line key={p} type="monotone" dataKey={p} stroke={colors[p] ?? '#667781'} strokeWidth={2} dot={false} />)}
              </LineChart>
            </ResponsiveContainer>
            <Legend people={v.people} colors={colors} name={name} />
          </div>
        )}
      </div>
    </Section>
  )
}

function Legend({ people, colors, name }: { people: string[]; colors: Colors; name: (n: string) => string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {people.map(p => <span key={p} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: colors[p] ?? '#667781' }} />{name(p)}</span>)}
    </div>
  )
}
