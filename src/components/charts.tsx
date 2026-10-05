import { useEffect, useMemo, useRef, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { senderColor, fmtCompact, fmtNum, DOW, hourLabel } from '../lib/format'
import type { ChatStats } from '../lib/types'

export function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="a-reveal bg-panel/60 border border-stroke rounded-2xl p-4 sm:p-5">
      <h3 className="font-semibold text-[15px]">{title}</h3>
      {sub && <p className="text-[12.5px] text-ink-2 mt-0.5 mb-3">{sub}</p>}
      {!sub && <div className="mb-3" />}
      {children}
    </section>
  )
}

export function StatTile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`a-reveal rounded-2xl border border-stroke p-4 ${accent ? 'bg-wa/10 glow-green' : 'bg-panel/60'}`}>
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className={`font-display text-[30px] sm:text-[36px] font-extrabold leading-tight tabular-nums ${accent ? 'text-wa-bright' : ''}`}>{value}</div>
      {hint && <div className="text-[11.5px] text-ink-3 mt-0.5">{hint}</div>}
    </div>
  )
}

const tooltipStyle = {
  background: '#202C33', border: '1px solid #2A3942', borderRadius: 10,
  fontSize: 12, color: '#E9EDEF',
} as const

/** Monthly volume over the years, per sender (top 4 + Other). */
type Colors = Record<string, string> | undefined
/** A person's identity color: their custom/default color from lib/colors, else rank order. */
const pc = (colors: Colors, name: string, i: number) => colors?.[name] ?? senderColor(i)

export function MonthlyTimeline({ stats, colors }: { stats: ChatStats; colors?: Colors }) {
  const names = stats.senders.slice(0, 4).map(s => s.name)
  const hasOther = stats.senders.length > 4
  const data = useMemo(() => stats.monthly.map(m => {
    const row: Record<string, number | string> = { month: m.key }
    let other = 0
    for (const [sender, c] of Object.entries(m.counts)) {
      if (names.includes(sender)) row[sender] = (row[sender] as number ?? 0) + c
      else other += c
    }
    for (const n of names) row[n] = row[n] ?? 0
    if (hasOther) row.Other = other
    return row
  }), [stats])
  const series = hasOther ? [...names, 'Other'] : names

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke="rgba(134,150,160,.12)" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false}
          tickFormatter={(v: string) => v.endsWith('-01') ? v.slice(0, 4) : ''} interval={0} />
        <YAxis tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtCompact(v)} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: '#00A884', strokeWidth: 1 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {series.map((n, i) => (
          <Area key={n} type="monotone" dataKey={n} stackId="1"
            stroke={n === 'Other' ? '#667781' : pc(colors, n, i)} strokeWidth={2}
            fill={n === 'Other' ? '#667781' : pc(colors, n, i)} fillOpacity={0.25} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function YearlyBars({ stats }: { stats: ChatStats }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={stats.yearly} margin={{ top: 6, right: 8, left: -14, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid stroke="rgba(134,150,160,.12)" vertical={false} />
        <XAxis dataKey="year" tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fill: '#667781', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtCompact(v)} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(0,168,132,.08)' }} formatter={(v) => [fmtNum(v as number), 'messages']} />
        <Bar dataKey="count" fill="#00A884" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/**
 * Day-of-week × hour heatmap. Sequential ramp: surface → bright green. Fills its container;
 * below 640px it transposes (hours down, days across) so a phone never scrolls sideways.
 */
export function HourHeatmap({ stats }: { stats: ChatStats }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null)
  const [ref, width] = useWidth<HTMLDivElement>()
  const max = Math.max(1, ...stats.heatmap.flat())
  const color = (v: number) => {
    if (v === 0) return 'rgba(134,150,160,.07)'
    const t = Math.pow(v / max, 0.55)
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
    return `rgb(${mix(10, 37)},${mix(60, 211)},${mix(48, 102)})`
  }
  const tall = width > 0 && width < 640
  const gap = 3
  let svg: React.ReactNode = null
  if (width > 0) {
    if (tall) {
      const left = 34, top = 18
      const cw = Math.floor((width - left) / 7 - gap)
      const ch = 15
      svg = (
        <svg width={width} height={top + 24 * (ch + gap)} role="img" aria-label="Messages by weekday and hour">
          {DOW.map((d, i) => <text key={d} x={left + i * (cw + gap) + cw / 2} y={11} textAnchor="middle" fontSize={10.5} fill="#667781">{d}</text>)}
          {Array.from({ length: 24 }, (_, hh) => (
            <g key={hh}>
              {hh % 3 === 0 && <text x={left - 6} y={top + hh * (ch + gap) + ch / 2 + 3.5} textAnchor="end" fontSize={10} fill="#667781">{hourLabel(hh)}</text>}
              {stats.heatmap.map((row, d) => (
                <rect key={d} x={left + d * (cw + gap)} y={top + hh * (ch + gap)} width={cw} height={ch} rx={4}
                  fill={color(row[hh])} stroke={hover?.d === d && hover?.h === hh ? '#25D366' : 'none'} strokeWidth={1.5}
                  onPointerEnter={() => setHover({ d, h: hh })} onClick={() => setHover({ d, h: hh })} />
              ))}
            </g>
          ))}
        </svg>
      )
    } else {
      const left = 36, top = 18
      const cell = Math.min(34, Math.floor((width - left) / 24 - gap))
      svg = (
        <svg width={left + 24 * (cell + gap)} height={top + 7 * (cell + gap)} role="img" aria-label="Messages by weekday and hour">
          {Array.from({ length: 24 }, (_, hh) => hh % 3 === 0 && (
            <text key={hh} x={left + hh * (cell + gap) + cell / 2} y={11} textAnchor="middle" fontSize={10} fill="#667781">{hourLabel(hh)}</text>
          ))}
          {stats.heatmap.map((row, d) => (
            <g key={d}>
              <text x={left - 8} y={top + d * (cell + gap) + cell / 2 + 3.5} textAnchor="end" fontSize={10.5} fill="#667781">{DOW[d]}</text>
              {row.map((v, hh) => (
                <rect key={hh} x={left + hh * (cell + gap)} y={top + d * (cell + gap)} width={cell} height={cell} rx={5}
                  fill={color(v)} stroke={hover?.d === d && hover?.h === hh ? '#25D366' : 'none'} strokeWidth={1.5}
                  onPointerEnter={() => setHover({ d, h: hh })} onClick={() => setHover({ d, h: hh })} />
              ))}
            </g>
          ))}
        </svg>
      )
    }
  }
  return (
    <div ref={ref} onPointerLeave={() => setHover(null)}>
      {svg}
      <div className="min-h-5 text-[12px] text-ink-2 mt-1.5">
        {hover
          ? <>{DOW[hover.d]} {hourLabel(hover.h)}: <span className="text-wa-bright font-semibold">{fmtNum(stats.heatmap[hover.d][hover.h])}</span> messages</>
          : <>Peak: <span className="text-wa-bright font-semibold">{DOW[stats.peakDow]}s around {hourLabel(stats.peakHour)}</span></>}
      </div>
    </div>
  )
}

/** Horizontal leaderboard — who sends how much. Works for 1:1 and groups. */
export function Leaderboard({ stats, colors }: { stats: ChatStats; colors?: Colors }) {
  const total = Math.max(1, stats.totalMessages)
  const rows = stats.senders.slice(0, 8)
  const max = Math.max(1, rows[0]?.messages ?? 1)
  return (
    <div className="space-y-2.5">
      {rows.map((s, i) => (
        <div key={s.name} className="flex items-center gap-3">
          <span className="w-20 sm:w-28 shrink-0 truncate text-[13px] text-ink-2">{s.name}</span>
          <div className="flex-1 h-5 rounded-md bg-panel-2/40 overflow-hidden">
            <div className="a-grow h-full rounded-md"
              style={{ background: pc(colors, s.name, i), width: `${(s.messages / max) * 100}%`, animationDelay: `${i * 0.07}s` }} />
          </div>
          <span className="w-[5.5rem] sm:w-24 shrink-0 text-right text-[12.5px] sm:text-[13px] tabular-nums">
            {fmtNum(s.messages)} <span className="text-ink-3">({Math.round((s.messages / total) * 100)}%)</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Head-to-head metric bars for the top two senders. */
export function Duel({ label, a, b, aName, bName, fmt, colors }: {
  colors?: Colors
  label: string; a: number; b: number; aName: string; bName: string; fmt: (n: number) => string
}) {
  const max = Math.max(a, b, 1)
  return (
    <div>
      <div className="text-[12.5px] text-ink-2 mb-1.5">{label}</div>
      {[{ n: aName, v: a, c: pc(colors, aName, 0) }, { n: bName, v: b, c: pc(colors, bName, 1) }].map(r => (
        <div key={r.n} className="flex items-center gap-2 mb-1">
          <span className="w-16 sm:w-24 shrink-0 truncate text-[12px] text-ink-3">{r.n}</span>
          <div className="flex-1 h-3.5 rounded bg-panel-2/40 overflow-hidden">
            <div className="a-grow h-full rounded" style={{ background: r.c, width: `${(r.v / max) * 100}%` }} />
          </div>
          <span className="w-16 text-right text-[12px] tabular-nums">{fmt(r.v)}</span>
        </div>
      ))}
    </div>
  )
}

export function WordColumns({ stats, colors }: { stats: ChatStats; colors?: Colors }) {
  const cols = stats.senders.slice(0, 3)
  return (
    <div className={`grid gap-6 sm:grid-cols-2 ${cols.length > 2 ? 'lg:grid-cols-3' : ''}`}>
      {cols.map((s, i) => {
        const max = Math.max(1, s.topWords[0]?.[1] ?? 1)
        return (
          <div key={s.name}>
            <div className="flex items-center gap-2 mb-2">
              <span className="size-2.5 rounded-full" style={{ background: pc(colors, s.name, i) }} />
              <span className="text-[13px] font-medium truncate">{s.name}</span>
            </div>
            <div className="space-y-1.5">
              {s.topWords.slice(0, 10).map(([w, c]) => (
                <div key={w} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 truncate text-[12px] text-ink-2">{w}</span>
                  <div className="flex-1 h-2.5 rounded bg-panel-2/40 overflow-hidden">
                    <div className="a-grow h-full rounded" style={{ background: pc(colors, s.name, i), opacity: 0.85, width: `${(c / max) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-[11px] text-ink-3 tabular-nums">{c}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EmojiPodium({ stats }: { stats: ChatStats }) {
  const top = stats.topEmojis.slice(0, 8)
  const max = Math.max(1, top[0]?.[1] ?? 1)
  return (
    <div className="flex items-end gap-3 h-40 pt-2">
      {top.map(([em, c], i) => (
        <div key={em} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[11px] text-ink-3 tabular-nums">{fmtCompact(c)}</span>
          <div className="a-grow-y w-full rounded-t-md bg-wa/30 border-t-2 border-wa"
            style={{ height: `${Math.max(8, (c / max) * 100)}%`, animationDelay: `${i * 0.06}s` }} />
          <span className="text-2xl leading-none">{em}</span>
        </div>
      ))}
    </div>
  )
}
