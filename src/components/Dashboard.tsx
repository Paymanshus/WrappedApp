import { useMemo } from 'react'
import { Play } from '@phosphor-icons/react'
import { fmtNum, fmtCompact, fmtDate, fmtDay, fmtDuration, fmtTime } from '../lib/format'
import { Section, StatTile, MonthlyTimeline, YearlyBars, HourHeatmap, Leaderboard, Duel, WordColumns, EmojiPodium } from './charts'
import { Fx, type FxName } from './Fx'
import { HallOfFame, TelepathySection, VocabularySection } from './Insights'
import { DigDeeper } from './DigDeeper'
import { ShareButton } from './ShareButton'
import { archetypeFor } from '../lib/story/archetype'
import { colorMap } from '../lib/colors'
import { groupAwards } from '../lib/story/awards'
import type { Chat, ChatStats } from '../lib/types'

const same = (n: string) => n

export function Dashboard({ chat, stats, year, years, onYear, onPlay, onOpenMessage, onAsk }: {
  chat: Chat
  stats: ChatStats
  year: number | null
  years: number[]
  onYear: (y: number | null) => void
  onPlay: () => void
  onOpenMessage?: (msgId: number) => void
  onAsk?: (question: string) => void
}) {
  const [a, b] = stats.senders
  const span = ((stats.lastTs - stats.firstTs) / 31557600000)
  const isGroup = chat.isGroup || stats.senders.length > 2
  const arch = useMemo(() => archetypeFor(stats, same), [stats])
  const colors = useMemo(() => colorMap(chat, stats), [chat, stats])
  const awards = useMemo(() => (isGroup ? groupAwards(stats, same) : []), [stats, isGroup])
  const empty = stats.totalMessages === 0

  return (
    <div className="flex-1 overflow-y-auto bg-chatbg">
      <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-5">

        {/* year filter + share */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-1.5 w-max" role="tablist" aria-label="Time range">
              {[null, ...years].map(y => (
                <button key={y ?? 'all'} role="tab" aria-selected={year === y} onClick={() => onYear(y)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap transition-colors ${year === y ? 'bg-wa text-app font-semibold' : 'bg-panel text-ink-2 hover:bg-panel-2'}`}>
                  {y ?? 'All time'}
                </button>
              ))}
            </div>
          </div>
          {/* phones get the header share icon instead */}
          {!empty && <div className="hidden md:block"><ShareButton target="dashboard" chat={chat} stats={stats} year={year} /></div>}
        </div>

        {empty && (
          <div className="rounded-2xl border border-stroke bg-panel/60 p-8 text-center text-ink-2">No messages in {year}. Pick another year.</div>
        )}

        {!empty && <>
        {/* personality hero */}
        <section
          className="a-rise relative overflow-hidden rounded-3xl border border-wa/30 bg-panel/60 p-5 sm:p-7"
        >
          <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full border border-wa/20 swirl-slow">
            <span className="absolute top-0 left-1/2 size-2 rounded-full bg-wa-bright glow-green" />
          </div>
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <Fx name={arch.fx} size={112} className="size-20 sm:size-28 float-soft drop-shadow-[0_0_24px_rgba(37,211,102,.35)]" />
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] uppercase tracking-[0.22em] text-ink-2">{year ? `Your ${year} personality` : isGroup ? 'Group personality' : 'Chat personality'}</div>
              <h2 className="mt-1 font-display text-[34px] sm:text-[46px] font-extrabold leading-[1.02] text-wa-bright text-glow">{arch.title}</h2>
              <p className="mt-1.5 text-[14px] text-ink leading-relaxed">
                {arch.blurb.map((s, i) => <span key={i} className={s.hl ? 'text-wa-bright font-semibold' : undefined}>{s.t}</span>)}
              </p>
              {arch.traits.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {arch.traits.map(t => <span key={t} className="rounded-full border border-wa/40 bg-wa/10 px-2.5 py-1 text-[12px]">{t}</span>)}
                </div>
              )}
            </div>
            <button onClick={onPlay}
              className="self-start sm:self-center inline-flex items-center gap-2 rounded-full bg-wa hover:bg-wa-bright text-app font-semibold text-[14px] px-5 py-2.5 transition-colors glow-green">
              <Play size={16} weight="fill" /> {year ? `Play ${year}` : 'Play Rewind'}
            </button>
          </div>
        </section>

        {/* hero */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatTile accent label="Total messages" value={fmtNum(stats.totalMessages)} hint={year ? `in ${year}` : `over ${span >= 1 ? span.toFixed(1) + ' years' : stats.spanDays + ' days'}`} />
          <StatTile label="Active days" value={fmtNum(stats.activeDays)} hint={`${Math.round((stats.activeDays / stats.spanDays) * 100)}% of ${fmtNum(stats.spanDays)} days`} />
          <StatTile label="Words exchanged" value={fmtCompact(stats.totalWords)} hint={`≈ ${Math.max(1, Math.round(stats.totalWords / 90000))}× a novel`} />
          <StatTile label="Conversations" value={fmtNum(stats.sessions)} hint="split by 1h+ of silence" />
        </div>

        {awards.length > 0 && (
          <Section title="The group awards" sub="One trophy each, at most two per person">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {awards.map(aw => (
                <div key={aw.title} className="flex items-center gap-3 rounded-xl bg-panel-2/40 px-3.5 py-3">
                  <Fx name={aw.fx} size={44} className="shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-ink-2">{aw.title}</div>
                    <div className="font-semibold truncate">{aw.name}</div>
                    <div className="text-[12.5px] text-wa-bright">{aw.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="The story over time" sub="Messages per month — where it grew, where it went quiet">
          <MonthlyTimeline stats={stats} colors={colors} />
        </Section>

        <div className={`grid gap-4 sm:gap-5 ${year == null && stats.yearly.length > 1 ? 'lg:grid-cols-2' : ''}`}>
          {year == null && stats.yearly.length > 1 && (
            <Section title="Year by year">
              <YearlyBars stats={stats} />
            </Section>
          )}
          <Section title={isGroup ? 'Who carries the group' : 'Who carries the chat'} sub="Message share per person">
            <Leaderboard stats={stats} colors={colors} />
          </Section>
        </div>

        <Section title="The chat's body clock" sub="When this chat is alive — every message by weekday and hour">
          <HourHeatmap stats={stats} />
        </Section>

        {a && b && !isGroup && (
          <Section title="Head to head" sub={`${a.name} vs ${b.name}`}>
            <div className="grid md:grid-cols-2 gap-x-10 gap-y-5">
              <Duel colors={colors} label="Median reply time" a={a.medianReplySec ?? 0} b={b.medianReplySec ?? 0} aName={a.name} bName={b.name} fmt={s => s ? fmtDuration(s) : '—'} />
              <Duel colors={colors} label="Conversations started" a={a.initiations} b={b.initiations} aName={a.name} bName={b.name} fmt={fmtNum} />
              <Duel colors={colors} label="Double-texts (no reply, texted again)" a={a.doubleTexts} b={b.doubleTexts} aName={a.name} bName={b.name} fmt={fmtNum} />
              <Duel colors={colors} label="Messages with a laugh" a={a.laughs} b={b.laughs} aName={a.name} bName={b.name} fmt={fmtNum} />
              <Duel colors={colors} label="Questions asked" a={a.questions} b={b.questions} aName={a.name} bName={b.name} fmt={fmtNum} />
              <Duel colors={colors} label="Voice notes sent" a={a.voiceNotes} b={b.voiceNotes} aName={a.name} bName={b.name} fmt={fmtNum} />
            </div>
          </Section>
        )}

        <div className="grid lg:grid-cols-2 gap-4 sm:gap-5">
          <Section title="Records" >
            <ul className="space-y-3 text-[13.5px]">
              <Record icon="fire" label="Longest streak" value={`${stats.longestStreakDays} days`} hint={stats.streakStart ? `${fmtDate(stats.streakStart)} → ${fmtDate(stats.streakEnd)}` : ''} />
              <Record icon="cactus" label="Longest silence" value={`${stats.longestDroughtDays} days`} hint={stats.droughtStart ? `${fmtDate(stats.droughtStart)} → ${fmtDate(stats.droughtEnd)}` : ''} />
              <Record icon="collision" label="Biggest day" value={`${fmtNum(stats.biggestDay.count)} messages`} hint={stats.biggestDay.ts ? fmtDay(stats.biggestDay.ts) : ''} />
              <Record icon="camera" label="Media shared" value={fmtNum(stats.totalMedia)} hint={`${fmtNum(stats.senders.reduce((x, s) => x + s.voiceNotes, 0))} voice notes · ${fmtNum(stats.senders.reduce((x, s) => x + s.stickers, 0))} stickers`} />
            </ul>
          </Section>
          <Section title="Emoji leaderboard" sub="Most used across the whole chat">
            {stats.topEmojis.length ? <EmojiPodium stats={stats} /> : <p className="text-ink-3 text-sm">No emojis found.</p>}
          </Section>
        </div>

        <HallOfFame stats={stats} chatId={chat.id!} colors={colors} you={chat.you} onOpen={onOpenMessage} />

        <Section title="Signature words" sub="Most-typed words per person (common words filtered out)">
          <WordColumns stats={stats} colors={colors} />
        </Section>

        <VocabularySection stats={stats} colors={colors} you={chat.you} />

        <TelepathySection stats={stats} chatId={chat.id!} colors={colors} you={chat.you} onOpen={onOpenMessage} />

        {stats.firstMessage && (
          <Section title={year ? `First message of ${year}` : "Where it all began"} sub={fmtDay(stats.firstMessage.ts)}>
            <div className="flex justify-start">
              <div className="relative max-w-[90%] sm:max-w-[75%] rounded-lg rounded-tl-none px-3 py-2 bg-bubble-in shadow-sm">
                <span className="absolute top-0 -left-2 size-2.5 tail-in" />
                <div className="text-[12.5px] font-semibold text-wa-bright mb-0.5">{stats.firstMessage.sender}</div>
                <span className="text-[14.2px] leading-relaxed whitespace-pre-wrap break-words">{stats.firstMessage.text}</span>
                <span className="float-right ml-2 mt-2 text-[10.5px] text-ink-3">{fmtTime(stats.firstMessage.ts)}</span>
              </div>
            </div>
          </Section>
        )}

        {/* optional, opt-in tier: on-device tone check + AI recaps (never part of the Rewind) */}
        <DigDeeper chat={chat} stats={stats} year={year} colors={colors} onAsk={onAsk} />

        {/* numbers table — accessible fallback for every visual above */}
        <Section title="All the numbers" sub="Every stat, as a table">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] tabular-nums">
              <thead>
                <tr className="text-left text-ink-2 border-b border-stroke">
                  <th className="py-1.5 pr-3 font-medium">Person</th>
                  <th className="py-1.5 px-3 font-medium text-right">Messages</th>
                  <th className="py-1.5 px-3 font-medium text-right">Words</th>
                  <th className="py-1.5 px-3 font-medium text-right">Avg chars</th>
                  <th className="py-1.5 px-3 font-medium text-right">Media</th>
                  <th className="py-1.5 px-3 font-medium text-right">Voice</th>
                  <th className="py-1.5 px-3 font-medium text-right">Emojis</th>
                  <th className="py-1.5 px-3 font-medium text-right">Laughs</th>
                  <th className="py-1.5 px-3 font-medium text-right">Median reply</th>
                </tr>
              </thead>
              <tbody>
                {stats.senders.map(s => (
                  <tr key={s.name} className="border-b border-stroke/50">
                    <td className="py-1.5 pr-3 truncate max-w-40">{s.name}</td>
                    <td className="py-1.5 px-3 text-right">{fmtNum(s.messages)}</td>
                    <td className="py-1.5 px-3 text-right">{fmtNum(s.words)}</td>
                    <td className="py-1.5 px-3 text-right">{s.avgLen}</td>
                    <td className="py-1.5 px-3 text-right">{fmtNum(s.media)}</td>
                    <td className="py-1.5 px-3 text-right">{fmtNum(s.voiceNotes)}</td>
                    <td className="py-1.5 px-3 text-right">{fmtNum(s.emojis)}</td>
                    <td className="py-1.5 px-3 text-right">{fmtNum(s.laughs)}</td>
                    <td className="py-1.5 px-3 text-right">{s.medianReplySec ? fmtDuration(s.medianReplySec) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        </>}

        <div className="h-6" />
      </div>
    </div>
  )
}

function Record({ icon, label, value, hint }: { icon: FxName; label: string; value: string; hint?: string }) {
  return (
    <li className="flex items-center gap-3">
      <Fx name={icon} size={26} />
      <div className="flex-1">
        <span className="text-ink-2">{label}</span>
        {hint && <div className="text-[11.5px] text-ink-3">{hint}</div>}
      </div>
      <span className="font-bold text-wa-bright tabular-nums">{value}</span>
    </li>
  )
}
