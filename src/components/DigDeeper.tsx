import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Laptop, Cloud, CircleNotch, ArrowClockwise, Trash, Sparkle, Question, GearSix, WarningCircle, Smiley, Lightning, MaskSad } from '@phosphor-icons/react'
import { db } from '../lib/db'
import { runToneCheck } from '../lib/importer'
import { verdict, type ToneBucket, type ToneResult } from '../lib/tone'
import { DIGS, runDig, type DigKind } from '../lib/agent/dig'
import { AskError } from '../lib/agent/drivers'
import { PROVIDERS, describe } from '../lib/agent/providers'
import { useAskSettings } from '../lib/agent/store'
import { fmtDate } from '../lib/format'
import { AskSettings } from './AskSettings'
import type { Chat, ChatStats } from '../lib/types'

// Dig deeper: everything that costs compute or needs a model, kept out of the Rewind and off by
// default. Two tiers, each labelled with what it runs and where data goes:
//   • On this device — the tone check (VADER word-list model, a few seconds, nothing leaves)
//   • With your AI model — short recaps of moments the stats found (uses Ask settings)
// Nothing here runs until it's tapped; results are saved per chat so it runs once.

const tooltipStyle = { background: '#202C33', border: '1px solid #2A3942', borderRadius: 10, fontSize: 12, color: '#E9EDEF' } as const

export function DigDeeper({ chat, stats, year, colors, onAsk }: { chat: Chat; stats: ChatStats; year: number | null; colors: Record<string, string>; onAsk?: (q: string) => void }) {
  return (
    <section className="a-reveal rounded-2xl border border-dashed border-wa/40 bg-panel/40 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-wa/15 text-wa-bright"><Sparkle size={18} weight="fill" /></span>
        <div>
          <h3 className="font-semibold text-[15px]">Dig deeper</h3>
          <p className="text-[12.5px] text-ink-2">Optional extras. Nothing here runs until you tap it, and each one says what it uses.</p>
        </div>
      </div>
      <div className="mt-5 space-y-6">
        <ToneCheck chat={chat} year={year} colors={colors} />
        <AiRecaps chat={chat} stats={stats} year={year} />
        {onAsk && <AskShortcuts chat={chat} onAsk={onAsk} />}
      </div>
    </section>
  )
}

function TierTitle({ local, children, note }: { local: boolean; children: React.ReactNode; note: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold">
        {local ? <Laptop size={15} className="text-wa-bright" /> : <Cloud size={15} className="text-read" />}{children}
      </div>
      <p className="mt-0.5 text-[12px] text-ink-3">{note}</p>
    </div>
  )
}

// ---------- tone (on device) ----------

function ToneCheck({ chat, year, colors }: { chat: Chat; year: number | null; colors: Record<string, string> }) {
  const row = useLiveQuery(() => db.insights.get([chat.id!, 'tone']), [chat.id])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const run = async () => {
    setErr(null); setBusy('Starting…')
    try { await runToneCheck(chat.id!, l => setBusy(l)) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }
  const tone = row?.value as ToneResult | undefined
  return (
    <div>
      <TierTitle local note="Runs VADER, a rule-based sentiment word list (no AI), in your browser. Takes a few seconds; nothing leaves this device.">On this device: tone check</TierTitle>
      {!tone && (
        <div className="rounded-xl bg-panel-2/40 p-4">
          <p className="text-[13.5px] text-ink-2">Does this chat lean sunny, chaotic or sarcastic? Scores every message's mood, then looks for chaos (caps, "!!!", rapid-fire bursts) and sarcasm cues (eye-rolls, "yeah right"). Best on English; common Hinglish words and emoji are understood.</p>
          <button onClick={run} disabled={!!busy} className="mt-3 inline-flex items-center gap-2 rounded-full bg-wa hover:bg-wa-bright text-app font-semibold text-[13.5px] px-4 py-2 disabled:opacity-60 transition-colors">
            {busy ? <><CircleNotch size={15} className="animate-spin" /> {busy}</> : 'Check the tone'}
          </button>
          {err && <p className="mt-2 text-[12.5px] text-coral">{err}</p>}
        </div>
      )}
      {tone && <ToneView tone={tone} year={year} colors={colors} you={chat.you} stale={row!.msgCount !== chat.messageCount} at={row!.at}
        onRerun={run} busy={busy} onRemove={() => db.insights.delete([chat.id!, 'tone'])} />}
    </div>
  )
}

function Meter({ label, value, shown, hint, Icon }: { label: string; value: number; shown?: string; hint: string; Icon: typeof Smiley }) {
  return (
    <div className="rounded-xl bg-panel-2/40 p-3">
      <div className="flex items-center gap-1.5 text-[12px] text-ink-2"><Icon size={14} />{label}</div>
      <div className="mt-1 font-display text-[26px] font-extrabold tabular-nums leading-none">{shown ?? `${Math.round(value * 100)}%`}</div>
      <div className="mt-1 h-1.5 rounded-full bg-panel-2 overflow-hidden"><div className="h-full rounded-full bg-wa" style={{ width: `${Math.min(100, Math.max(2, value * 100))}%` }} /></div>
      <div className="mt-1 text-[11px] text-ink-3">{hint}</div>
    </div>
  )
}

function ToneView({ tone, year, colors, you, stale, at, onRerun, onRemove, busy }: {
  tone: ToneResult; year: number | null; colors: Record<string, string>; you: string | null; stale: boolean; at: number
  onRerun: () => void; onRemove: () => void; busy: string | null
}) {
  const total: ToneBucket | undefined = year == null ? tone.total : tone.years[String(year)]
  const months = useMemo(() => tone.months.filter(m => (year == null || m.key.startsWith(`${year}-`)) && m.n >= 20), [tone, year])
  if (!total || !total.n) return <p className="text-[13px] text-ink-3">No messages to read{year ? ` in ${year}` : ''}.</p>
  const v = verdict(total)
  const people = Object.entries(year == null ? tone.people : Object.fromEntries(Object.entries(tone.peopleYears).map(([p, ys]) => [p, ys[String(year)]]).filter(([, b]) => b)))
    .filter(([, b]) => (b as ToneBucket).n >= 30).sort((a, b) => (b[1] as ToneBucket).n - (a[1] as ToneBucket).n).slice(0, 6) as [string, ToneBucket][]
  const ranked = [...months].sort((a, b) => b.avg - a.avg)
  const name = (n: string) => (n === you ? 'You' : n)
  return (
    <div className="rounded-xl bg-panel-2/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11.5px] uppercase tracking-[0.2em] text-ink-2">{year ? `${year} tone` : 'The tone of this chat'}</div>
          <div className="mt-1 font-display text-[30px] sm:text-[36px] font-extrabold leading-tight text-wa-bright">{v.title}</div>
        </div>
        <div className="flex items-center gap-1 text-[12px] text-ink-3">
          {stale && <span className="mr-1 text-coral">Chat changed since</span>}
          <span className="hidden sm:inline">Checked {fmtDate(at)}</span>
          <button onClick={onRerun} disabled={!!busy} aria-label="Run the tone check again" title="Run again" className="grid size-8 place-items-center rounded-full hover:bg-panel-2 hover:text-ink">
            {busy ? <CircleNotch size={15} className="animate-spin" /> : <ArrowClockwise size={15} />}
          </button>
          <button onClick={onRemove} aria-label="Remove tone results" title="Remove" className="grid size-8 place-items-center rounded-full hover:bg-panel-2 hover:text-ink"><Trash size={15} /></button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Meter Icon={Smiley} label="Positivity" value={Math.max(0, v.positivity)} hint={`${Math.round((total.pos / total.n) * 100)}% upbeat · ${Math.round((total.neg / total.n) * 100)}% down`} />
        <Meter Icon={Lightning} label="Chaos" value={v.chaos} hint="caps, !!!, bursts of 4+ in a minute" />
        <Meter Icon={MaskSad} label="Sarcasm cues" value={Math.min(1, v.sarcasm / 0.004)} shown={`${(v.sarcasm * 1000).toFixed(1)} per 1k`}
          hint={`${total.sarcasm.toLocaleString('en-US')} messages with eye-rolls, "yeah right" & co.`} />
      </div>

      {people.length > 1 && (
        <div className="mt-5">
          <div className="text-[12px] text-ink-3 mb-2">By person</div>
          <ul className="space-y-2">
            {people.map(([p, b]) => {
              const pv = verdict(b)
              return (
                <li key={p} className="flex items-center gap-3 text-[13px]">
                  <span className="w-28 shrink-0 truncate font-medium" style={{ color: colors[p] }}>{name(p)}</span>
                  <span className="flex-1 min-w-0 truncate text-ink-2">{pv.title}</span>
                  <span className="shrink-0 tabular-nums text-ink-3">{Math.round(pv.positivity * 100)}% positive · {Math.round(pv.chaos * 100)}% chaos</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {months.length > 2 && (
        <div className="mt-5">
          <div className="flex flex-wrap justify-between gap-2 text-[12px] text-ink-3 mb-1">
            <span>Mood by month (average message score, −1 to +1)</span>
            <span>Sunniest {label(ranked[0].key)} · Stormiest {label(ranked[ranked.length - 1].key)}</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={months} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="rgba(134,150,160,.12)" vertical={false} />
              <XAxis dataKey="key" tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} tickFormatter={(k: string, i: number) => (i === 0 || k.endsWith('-01') ? k.slice(0, 4) : '')} />
              <YAxis tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
              <ReferenceLine y={0} stroke="#667781" strokeDasharray="3 3" />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={k => label(String(k))} formatter={x => [Number(x).toFixed(2), 'Mood']} />
              <Line type="monotone" dataKey="avg" stroke="#25D366" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {(tone.sunny.length > 0 || tone.sarcastic.length > 0) && year == null && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 text-[13px]">
          {[['Sunniest messages', tone.sunny], ['Sarcasm detected', tone.sarcastic]].map(([t, list]) => (list as ToneResult['sunny']).length > 0 && (
            <div key={t as string}>
              <div className="text-[12px] text-ink-3 mb-1.5">{t as string}</div>
              <ul className="space-y-1.5">
                {(list as ToneResult['sunny']).slice(0, 3).map((m, i) => (
                  <li key={i} className="rounded-lg bg-chatbg/60 px-3 py-2 leading-snug"><span className="font-semibold" style={{ color: colors[m.sender] }}>{name(m.sender)}:</span> {m.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-[11.5px] text-ink-3">Word-list scores miss context: inside jokes, teasing and mixed languages can read wrong. Treat it as a vibe, not a verdict.</p>
    </div>
  )
}

const label = (k: string) => new Date(+k.slice(0, 4), +k.slice(5) - 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

// ---------- AI recaps (your model) ----------

function AiRecaps({ chat, stats, year }: { chat: Chat; stats: ChatStats; year: number | null }) {
  const { config } = useAskSettings()
  const [settings, setSettings] = useState(false)
  const digs = DIGS.filter(d => d.available(stats))
  const local = config.answer && PROVIDERS[config.answer.provider].local && (!config.reader || PROVIDERS[config.reader.provider].local)
  const rawTo = config.reader ?? config.answer
  const note = !config.answer
    ? 'Uses the model you set up for Ask: free and private with Ollama, or your own Claude / OpenAI / Gemini / OpenRouter key.'
    : local ? `Uses ${describe(config.answer)} on this device. Nothing leaves it.`
      : `Uses ${describe(config.answer)}. Each recap sends only the messages it's about${config.reader && PROVIDERS[config.reader.provider].local ? ' to your local reader model; the cloud model sees its notes' : ` to ${PROVIDERS[rawTo!.provider].label}`}.`
  return (
    <div>
      <TierTitle local={!!local} note={note}>With your AI model: recaps</TierTitle>
      {!config.answer && (
        <button onClick={() => setSettings(true)} className="mb-3 inline-flex items-center gap-2 rounded-full bg-wa hover:bg-wa-bright text-app font-semibold text-[13.5px] px-4 py-2 transition-colors">Set up a model</button>
      )}
      {config.answer && (
        <button onClick={() => setSettings(true)} className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-stroke px-3 py-1 text-[12px] text-ink-2 hover:text-ink"><GearSix size={13} /> {config.answer.model}</button>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {digs.map(d => <DigCard key={d.kind} kind={d.kind} chat={chat} stats={stats} year={year} disabled={!config.answer} />)}
      </div>
      {settings && <AskSettings onClose={() => setSettings(false)} />}
    </div>
  )
}

function DigCard({ kind, chat, stats, year, disabled }: { kind: DigKind; chat: Chat; stats: ChatStats; year: number | null; disabled: boolean }) {
  const def = DIGS.find(d => d.kind === kind)!
  const { config, keys } = useAskSettings()
  const key = `dig:${kind}:${year ?? 'all'}`
  const saved = useLiveQuery(() => db.insights.get([chat.id!, key]), [chat.id, key])
  const [live, setLive] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<{ message: string; hint?: string } | null>(null)
  const ac = useRef<AbortController | null>(null)
  const raw = config.reader ?? config.answer
  const cloud = raw && !PROVIDERS[raw.provider].local

  const run = async () => {
    ac.current?.abort()
    const ctrl = new AbortController()
    ac.current = ctrl
    setErr(null); setLive(''); setStatus('Starting…')
    try {
      const r = await runDig(kind, { chat, stats, config, keys, signal: ctrl.signal, onText: t => setLive(x => (x ?? '') + t), onStatus: setStatus })
      await db.insights.put({ chatId: chat.id!, key, value: r.text, at: Date.now(), msgCount: chat.messageCount, model: r.model })
      setLive(null)
    } catch (e) {
      if (!ctrl.signal.aborted) setErr(e instanceof AskError ? { message: e.message, hint: e.hint } : { message: e instanceof Error ? e.message : String(e) })
      setLive(null)
    } finally { setStatus(null) }
  }
  const text = live ?? (saved?.value as string | undefined)
  const running = status != null
  return (
    <div className="flex flex-col rounded-xl bg-panel-2/40 border border-stroke/60 p-3.5">
      <div className="text-[14px] font-semibold">{def.title}</div>
      <div className="text-[12.5px] text-ink-2">{def.blurb}</div>
      {text ? (
        <div className="mt-2.5 flex-1 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
          {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))}
          {running && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-wa-bright align-middle" />}
        </div>
      ) : <div className="flex-1" />}
      {err && (
        <div className="mt-2 flex items-start gap-1.5 text-[12.5px] text-coral"><WarningCircle size={15} weight="fill" className="mt-px shrink-0" />
          <span>{err.message}{err.hint && <span className="block text-ink-2">{err.hint}</span>}</span></div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 text-[11.5px] text-ink-3">
        <span className="min-w-0 truncate">
          {running ? status : saved && !live ? `${saved.model ?? 'AI'} · ${fmtDate(saved.at)}` : `Sends about ${def.size(stats)} ${def.size(stats) === 1 ? 'message' : 'messages'}${!raw ? ' to your model' : cloud ? ` to ${PROVIDERS[raw.provider].label}` : ', stays on this device'}`}
        </span>
        {running
          ? <button onClick={() => ac.current?.abort()} className="shrink-0 text-ink-2 hover:text-ink">Stop</button>
          : <button onClick={run} disabled={disabled} className="shrink-0 inline-flex items-center gap-1 rounded-full bg-wa/15 border border-wa/40 px-3 py-1 font-semibold text-wa-bright hover:bg-wa/25 disabled:opacity-40">
              {saved ? <><ArrowClockwise size={12} weight="bold" /> Redo</> : 'Explore'}
            </button>}
      </div>
    </div>
  )
}

// ---------- Ask shortcuts ----------

function AskShortcuts({ chat, onAsk }: { chat: Chat; onAsk: (q: string) => void }) {
  const { config } = useAskSettings()
  const local = !!config.answer && PROVIDERS[config.answer.provider].local
  const qs = [
    'What are our running inside jokes, and where did they start?',
    'What nicknames do we use for each other?',
    'What did we plan but never end up doing?',
    chat.isGroup ? 'Who is the glue of this group, with examples?' : 'What do we argue about, and how do we make up?',
    'What were the turning points in this chat?',
  ]
  return (
    <div>
      <TierTitle local={local} note="Opens Ask, where your model searches the whole chat and answers with sources.">Questions to ask</TierTitle>
      <div className="flex flex-wrap gap-2">
        {qs.map(q => (
          <button key={q} onClick={() => onAsk(q)} className="inline-flex items-center gap-1.5 rounded-full border border-stroke bg-panel-2/40 px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:border-wa/60 hover:text-ink">
            <Question size={13} className="shrink-0 text-wa-bright" />{q}
          </button>
        ))}
      </div>
    </div>
  )
}
