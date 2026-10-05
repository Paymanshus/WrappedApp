import { useMemo, useState } from 'react'
import { Check, MagnifyingGlass, Palette, Warning, X } from '@phosphor-icons/react'
import { SWATCHES, clashes, colorMap, resetColors, setColor, setYou } from '../lib/people'
import { initials } from '../lib/format'
import type { Chat, ChatStats } from '../lib/types'

/** Who's who in this chat: which one is you (right-hand bubbles) and everyone's color. */
export function PeopleSheet({ chat, stats, onClose }: { chat: Chat; stats: ChatStats; onClose: () => void }) {
  const people = stats.senders
  const colors = useMemo(() => colorMap(chat, stats), [chat, stats])
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const needle = q.trim().toLowerCase()
  const shown = needle ? people.filter(p => p.name.toLowerCase().includes(needle)) : people
  // the most active few get their palette inline; everyone else opens theirs on tap
  const inline = new Set(people.slice(0, 6).map(p => p.name))

  // pairs that colorblind viewers can't tell apart, among the people charts tell apart (top 5)
  const charted = people.slice(0, 5)
  const warnings: [string, string][] = []
  for (let i = 0; i < charted.length; i++) for (let j = i + 1; j < charted.length; j++) {
    if (clashes(colors[charted[i].name], colors[charted[j].name])) warnings.push([charted[i].name, charted[j].name])
  }

  const fix = (name: string) => {
    const others = charted.filter(p => p.name !== name).map(p => colors[p.name])
    const pick = SWATCHES.find(c => !others.includes(c) && others.every(o => !clashes(c, o)))
      ?? SWATCHES.find(c => !others.includes(c))
    if (pick) setColor(chat, stats, name, pick)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center" role="dialog" aria-modal aria-label="People in this chat">
      <div className="a-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="a-sheet relative w-full md:w-[560px] max-h-[90dvh] overflow-y-auto bg-app border border-stroke rounded-t-3xl md:rounded-3xl p-5 md:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-panel-2 md:hidden" />
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-semibold">People in this chat</h2>
            <p className="text-[13px] text-ink-2">Your messages show on the right. Colors carry through the Rewind, posters and charts.</p>
          </div>
          <button onClick={onClose} autoFocus aria-label="Close" className="grid place-items-center size-9 shrink-0 rounded-full hover:bg-panel text-ink-2"><X size={18} weight="bold" /></button>
        </div>

        {people.length > 8 && (
          <div className="relative mt-4">
            <MagnifyingGlass size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${people.length} people`} aria-label="Search people"
              className="w-full bg-panel rounded-lg pl-10 pr-3 py-2.5 text-sm placeholder:text-ink-3 outline-none focus:ring-1 focus:ring-wa" />
          </div>
        )}

        <ul className="mt-4 space-y-3">
          {!shown.length && <li className="py-4 text-center text-[13px] text-ink-3">Nobody called "{q.trim()}" has sent a message here.</li>}
          {shown.map(p => {
            const me = chat.you === p.name
            const used = (c: string) => Object.entries(colors).find(([n, v]) => n !== p.name && v === c)?.[0]
            return (
              <li key={p.name} className="rounded-2xl bg-panel/60 border border-stroke p-3">
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center size-10 shrink-0 rounded-full text-white font-bold text-[14px]" style={{ background: colors[p.name] }}>{initials(p.name)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[12px] text-ink-3">{p.messages.toLocaleString('en-US')} messages</div>
                  </div>
                  {!inline.has(p.name) && (
                    <button onClick={() => setExpanded(e => (e === p.name ? null : p.name))} aria-expanded={expanded === p.name} aria-label={`Change ${p.name}'s color`}
                      className="grid place-items-center size-8 shrink-0 rounded-full text-ink-2 hover:text-ink hover:bg-panel-2"><Palette size={17} /></button>
                  )}
                  {me
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-wa text-app text-[12.5px] font-semibold px-3 py-1"><Check size={13} weight="bold" /> You</span>
                    : <button onClick={() => setYou(chat.id!, p.name)} className="rounded-full border border-stroke hover:border-wa hover:text-wa-bright text-[12.5px] text-ink-2 px-3 py-1 transition-colors">That's me</button>}
                </div>
                {(inline.has(p.name) || expanded === p.name) && <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`${p.name}'s color`}>
                  {SWATCHES.map(c => {
                    const on = colors[p.name] === c
                    const holder = used(c)
                    return (
                      <button key={c} role="radio" aria-checked={on} onClick={() => setColor(chat, stats, p.name, c)}
                        title={holder ? `${holder} has this — picking it swaps your colors` : undefined}
                        aria-label={`${c}${holder ? `, used by ${holder}` : ''}`}
                        className={`relative size-8 rounded-full transition-transform hover:scale-110 ${on ? 'ring-2 ring-offset-2 ring-offset-app ring-ink' : ''}`}
                        style={{ background: c }}>
                        {holder && !on && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-app grid place-items-center"><span className="size-1.5 rounded-full bg-ink-2" /></span>}
                      </button>
                    )
                  })}
                </div>}
              </li>
            )
          })}
        </ul>

        {warnings.length > 0 && (
          <div className="mt-4 space-y-2">
            {warnings.map(([a, b]) => (
              <div key={a + b} className="flex items-center gap-2 rounded-xl border border-coral/40 bg-coral/10 px-3 py-2 text-[13px]">
                <Warning size={16} weight="fill" className="text-coral shrink-0" />
                <span className="flex-1">{a} and {b} look alike to colorblind viewers.</span>
                <button onClick={() => fix(b)} className="shrink-0 font-semibold text-wa-bright hover:underline">Fix</button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between text-[12.5px] text-ink-3">
          <span>{chat.youSource === 'user' ? 'You picked who you are.' : chat.you ? 'Detected automatically. Tap "That\'s me" to change.' : 'Not sure who you are yet.'}</span>
          {chat.colors && <button onClick={() => resetColors(chat.id!)} className="text-ink-2 hover:text-ink underline underline-offset-2">Reset colors</button>}
        </div>
      </div>
    </div>
  )
}
