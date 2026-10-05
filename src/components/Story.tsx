import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeft, CaretRight, Pause, SpeakerHigh, SpeakerSlash, X } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { Fx } from './Fx'
import { PosterSheet } from './PosterSheet'
import type { PosterCard, Seg, StoryModel, Viz } from '../lib/story/model'
import { SETTLED, TEXT_TOP, TEXT_TOP_NO_HERO, sceneFor, toSvg } from '../lib/story/scene'
import { LIVE_CARD_SECONDS } from '../lib/story/soundtrack'
import { LiveSound, setSoundPref, soundPref } from '../lib/story/liveSound'

// Story player. Cards are laid out in the same 1080×1920 design space as the canvas
// exporter: --u = one design unit, using SVG "slice" scaling, so the live card and the
// shared PNG/MP4 line up. Scenes (lib/story/scene.ts) animate in an <svg> per card.

const CARD_MS = LIVE_CARD_SECONDS * 1000   // 16 beats at 128 BPM, so the soundtrack lands every card change
const u = (n: number) => `calc(${n} * var(--u))`
const at = (x: number, y: number) => ({ left: `calc(50% + ${x - 540} * var(--u))`, top: `calc(50% + ${y - 960} * var(--u))` })
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Counts up on rAF; a timer guarantees the final number lands even if rAF is throttled. */
function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [v, setV] = useState(() => (reduceMotion() ? to : 0))
  useEffect(() => {
    if (reduceMotion()) return
    const t0 = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - t0 - 200) / 1300)
      setV(Math.round(to * (1 - Math.pow(1 - Math.max(0, k), 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    })
    const done = window.setTimeout(() => setV(to), 1700)
    return () => { cancelAnimationFrame(raf); clearTimeout(done) }
  }, [to])
  return <>{v.toLocaleString('en-US') + suffix}</>
}

/** Live SVG scene. bg is static per card; fg is re-rendered every frame from scene.fg(t, time). */
function SceneLayer({ card, pausedRef, startAt }: { card: PosterCard; pausedRef: React.RefObject<boolean>; startAt: number }) {
  const scene = useMemo(() => sceneFor(card), [card])
  const fg = useRef<SVGGElement>(null)
  useEffect(() => {
    const el = fg.current
    if (!el) return
    const paint = (t: number, time: number) => { el.innerHTML = toSvg(scene.fg(t, time)) }
    if (reduceMotion()) { paint(SETTLED, 1.2); return }
    let t = startAt, time = startAt, prev = performance.now(), raf = 0, ticked = false
    paint(t, time)
    const fallback = window.setTimeout(() => { if (!ticked) paint(SETTLED, 1.2) }, 700)
    const tick = (now: number) => {
      ticked = true
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      if (!pausedRef.current) { t += dt; time += dt }
      paint(t, time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); clearTimeout(fallback) }
  }, [scene, pausedRef, startAt])
  return (
    <svg viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
      <g dangerouslySetInnerHTML={{ __html: toSvg(scene.bg) }} />
      <g ref={fg} />
    </svg>
  )
}

function Body({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <span key={i} className={s.hl === 1 ? 'text-wa-bright font-semibold' : s.hl === 2 ? 'text-coral font-semibold' : undefined}>{s.t}</span>
      ))}
    </>
  )
}

function headlineUnits(text: string) {
  const n = text.length
  return n <= 6 ? 210 : n <= 9 ? 170 : n <= 14 ? 128 : 104
}

/** Condensed display headline: outline first, fill rises from the baseline (a-fill). */
function Headline({ card }: { card: PosterCard }) {
  const final = card.count != null ? card.count.toLocaleString('en-US') + (card.suffix ?? '') : card.big
  if (!final) return null
  const content = () => (card.count != null ? <CountUp to={card.count} suffix={card.suffix} /> : card.big)
  return (
    <div className="a-rise relative max-w-full break-words font-display font-extrabold leading-[0.95] tracking-[-0.01em] text-balance"
      style={{ fontSize: u(headlineUnits(final)), animationDelay: '0.15s' }}>
      <span className="text-transparent" style={{ WebkitTextStroke: `${u(3)} var(--color-wa-bright)` }}>{content()}</span>
      <span aria-hidden className="a-fill absolute inset-0 text-wa-bright text-glow">{content()}</span>
    </div>
  )
}

function VizView({ viz }: { viz: Viz }) {
  if (viz.kind === 'split') {
    const total = Math.max(1, viz.parts.reduce((x, p) => x + p.value, 0))
    return (
      <div className="w-full">
        <div className="flex w-full overflow-hidden rounded-full bg-panel-2/50" style={{ height: u(44), gap: u(4) }}>
          {viz.parts.map((p, i) => (
            <div key={i} className="a-grow h-full first:rounded-l-full last:rounded-r-full" style={{ background: p.color, width: `${(p.value / total) * 100}%`, animationDelay: '0.5s' }} />
          ))}
        </div>
        <div className="a-rise flex flex-wrap justify-center text-ink-2" style={{ marginTop: u(30), columnGap: u(48), rowGap: u(14), fontSize: u(34), animationDelay: '0.8s' }}>
          {viz.parts.map((p, i) => (
            <span key={i} className="inline-flex items-center" style={{ gap: u(14) }}>
              <span className="rounded-full" style={{ background: p.color, width: u(20), height: u(20) }} />
              {p.label} <span className="tabular-nums">{Math.round((p.value / total) * 100)}%</span>
            </span>
          ))}
        </div>
      </div>
    )
  }
  if (viz.kind === 'emoji') {
    const order = [1, 0, 2].filter(i => i < viz.items.length)
    return (
      <div className="flex items-end justify-center" style={{ gap: u(60) }}>
        {order.map(i => (
          <div key={i} className="a-pop text-center" style={{ animationDelay: `${0.4 + i * 0.15}s` }}>
            <div className="leading-none" style={{ fontSize: u(i === 0 ? 170 : 128) }}>{viz.items[i][0]}</div>
            <div className="text-ink-2 tabular-nums" style={{ marginTop: u(14), fontSize: u(34) }}>{viz.items[i][1].toLocaleString('en-US')}×</div>
          </div>
        ))}
      </div>
    )
  }
  if (viz.kind === 'chips') {
    return (
      <div className="flex flex-wrap justify-center" style={{ gap: u(16) }}>
        {viz.items.map((c, i) => (
          <span key={i} className="a-rise rounded-full border border-wa/55 bg-wa/15 font-semibold"
            style={{ animationDelay: `${0.7 + i * 0.1}s`, fontSize: u(34), padding: `${u(14)} ${u(30)}` }}>{c}</span>
        ))}
      </div>
    )
  }
  return (
    <div className="w-full text-left" style={{ display: 'grid', gap: u(24) }}>
      {viz.items.map((a, i) => (
        <div key={i} className="a-rise flex items-center bg-panel/85" style={{ animationDelay: `${0.2 + i * 0.14}s`, gap: u(32), borderRadius: u(32), padding: `${u(22)} ${u(30)}` }}>
          <div className="shrink-0" style={{ width: u(120), height: u(120) }}><Fx name={a.fx} size={120} className="h-full w-full" /></div>
          <div className="min-w-0">
            <div className="uppercase tracking-[0.12em] text-ink-2" style={{ fontSize: u(28) }}>{a.title}</div>
            <div className="truncate font-display font-extrabold leading-tight" style={{ fontSize: u(52) }}>{a.name}</div>
            <div className="font-semibold text-wa-bright" style={{ fontSize: u(32) }}>{a.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** One card: scene layer → 3D illustration slot → text zone. Mirrors canvas.ts drawCard. */
export function CardView({ card, pausedRef, entering = false, startAt = 0 }: {
  card: PosterCard; pausedRef: React.RefObject<boolean>; entering?: boolean; startAt?: number
}) {
  const scene = useMemo(() => sceneFor(card), [card])
  const top = scene.hero ? TEXT_TOP : TEXT_TOP_NO_HERO
  return (
    <div className={`pointer-events-none absolute inset-0 bg-chatbg ${entering ? 'a-wipe' : ''}`}>
      <SceneLayer card={card} pausedRef={pausedRef} startAt={startAt} />
      {scene.fx && (
        <div className="a-pop absolute" style={{ ...at(scene.fx.x, scene.fx.y), width: u(scene.fx.size), height: u(scene.fx.size), translate: '-50% -50%' }}>
          <Fx name={scene.fx.name} size={240} className="h-full w-full float-soft drop-shadow-[0_0_28px_rgba(37,211,102,.35)]" />
        </div>
      )}
      <div className="absolute flex flex-col items-center text-center"
        style={{ top: `calc(50% + ${top - 960} * var(--u))`, left: '50%', translate: '-50% 0', width: `min(${u(900)}, calc(100% - 40px))`, gap: u(28) }}>
        <div className="a-rise uppercase tracking-[0.25em] text-ink-2" style={{ fontSize: u(32), animationDelay: '0.1s' }}>{card.kicker}</div>
        <Headline card={card} />
        {card.body.length > 0 && (
          <p className="a-rise text-ink text-balance" style={{ fontSize: u(44), lineHeight: 1.45, animationDelay: '0.4s' }}>
            <Body segs={card.body} />
          </p>
        )}
        {card.viz && <div className="w-full" style={{ marginTop: u(20) }}><VizView viz={card.viz} /></div>}
      </div>
    </div>
  )
}

export function Story({ model, onClose, renderShare, outro, posters }: {
  model: StoryModel
  onClose: () => void
  renderShare?: (index: number, onOpenChange: (open: boolean) => void) => React.ReactNode
  outro?: { label: string; onClick: () => void }
  /** End-of-story highlight posters (Wrapped-style share screen). */
  posters?: { getModel: (hideNames: boolean) => StoryModel; canHide: boolean }
}) {
  const [postersOpen, setPostersOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const [prev, setPrev] = useState<number | null>(null)
  const [held, setHeld] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [manualPause, setManualPause] = useState(false)
  const fillRef = useRef<HTMLDivElement>(null)
  const elapsed = useRef(0)
  const idxRef = useRef(0)
  const downAt = useRef<{ t: number; x: number } | null>(null)
  const last = model.cards.length - 1
  const paused = held || sheetOpen || manualPause || postersOpen
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [soundOn, setSoundOn] = useState(soundPref)
  const sound = useRef<LiveSound | null>(null)

  const go = useCallback((d: number) => {
    const i = idxRef.current
    const n = Math.max(0, Math.min(last, i + d))
    if (n === i) return
    idxRef.current = n
    elapsed.current = 0
    setPrev(i)
    setIdx(n)
  }, [last])

  // soundtrack: built when sound is on, follows the card you're on and pauses with the story
  useEffect(() => {
    if (!soundOn) return
    const s = new LiveSound(model)
    s.seek(idxRef.current, elapsed.current / 1000)
    s.setPaused(pausedRef.current || document.hidden)
    s.start()
    sound.current = s
    return () => { s.dispose(); sound.current = null }
  }, [model, soundOn])
  useEffect(() => { sound.current?.seek(idx, 0) }, [idx])
  useEffect(() => {
    const sync = () => sound.current?.setPaused(paused || document.hidden)
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [paused])
  const toggleSound = () => setSoundOn(on => { setSoundPref(!on); return !on })

  // keep the outgoing card underneath while the next one wipes in
  useEffect(() => {
    if (prev == null) return
    const t = window.setTimeout(() => setPrev(null), 560)
    return () => clearTimeout(t)
  }, [prev, idx])

  // autoplay clock — writes straight to the progress bar so cards never re-render per frame
  useEffect(() => {
    let raf = 0
    let before = performance.now()
    const tick = (now: number) => {
      const dt = now - before
      before = now
      if (!paused && !document.hidden) elapsed.current = Math.min(CARD_MS, elapsed.current + dt)
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${elapsed.current / CARD_MS})`
      if (elapsed.current >= CARD_MS && idxRef.current < last) go(1)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [paused, last, go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheetOpen || postersOpen) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === ' ') { e.preventDefault(); setManualPause(p => !p) }
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, sheetOpen, postersOpen])

  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = before }
  }, [])

  const onDown = (e: React.PointerEvent) => {
    sound.current?.unlock()
    downAt.current = { t: performance.now(), x: e.clientX }
    window.setTimeout(() => { if (downAt.current) setHeld(true) }, 180)
  }
  const onUp = (e: React.PointerEvent) => {
    const d = downAt.current
    downAt.current = null
    setHeld(false)
    if (!d || performance.now() - d.t > 220) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    go((e.clientX - rect.left) / rect.width < 0.3 ? -1 : 1)
  }
  const onCancel = () => { downAt.current = null; setHeld(false) }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05090c]/95 md:backdrop-blur-md">
      <button onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous card"
        className="hidden md:grid place-items-center size-11 mr-5 rounded-full bg-panel/80 hover:bg-panel-2 text-ink disabled:opacity-20 transition-colors">
        <CaretLeft size={20} weight="bold" />
      </button>

      <div style={{ containerType: 'size' }}
        className="relative h-dvh w-full overflow-hidden bg-chatbg select-none md:h-[min(92dvh,920px)] md:w-auto md:aspect-[9/16] md:rounded-[28px] md:border md:border-stroke md:shadow-2xl md:shadow-black/60">
        <div className="absolute inset-0 [--u:max(calc(100cqw/1080),calc(100cqh/1920))]">
          {prev != null && prev !== idx && <CardView key={`c${prev}`} card={model.cards[prev]} pausedRef={pausedRef} startAt={SETTLED} />}
          <CardView key={`c${idx}`} card={model.cards[idx]} pausedRef={pausedRef} entering={prev != null} />
        </div>

        {/* chrome */}
        <div className={`absolute inset-x-0 top-0 z-20 px-3 pt-[max(10px,env(safe-area-inset-top))] transition-opacity duration-200 ${held ? 'opacity-0' : 'opacity-100'}`}>
          <div className="flex gap-1">
            {model.cards.map((_, i) => (
              <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/20">
                {i < idx && <div className="h-full w-full bg-wa-bright" />}
                {i === idx && <div ref={fillRef} className="h-full w-full origin-left bg-wa-bright" style={{ transform: 'scaleX(0)' }} />}
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="relative size-8 shrink-0 rounded-full ring-grad">
              <span className="absolute inset-[2px] rounded-full bg-chatbg" />
              <span className="absolute inset-[4px] rounded-full bg-wa" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[13px] font-semibold">Wrapped<span className="text-wa-bright">App</span></div>
              <div className="truncate text-[12px] text-ink-2">{model.title}{model.yearLabel ? ` · ${model.yearLabel}` : ''}</div>
            </div>
            {paused && !held && !sheetOpen && <Pause size={16} weight="fill" className="text-ink-2" aria-label="Paused" />}
            <button onClick={toggleSound} aria-label={soundOn ? 'Mute soundtrack' : 'Play soundtrack'} aria-pressed={soundOn}
              className="grid place-items-center size-9 rounded-full text-ink-2 hover:text-ink hover:bg-white/5">
              {soundOn ? <SpeakerHigh size={19} weight="fill" /> : <SpeakerSlash size={19} />}
            </button>
            {renderShare?.(idx, setSheetOpen)}
            <button onClick={onClose} aria-label="Close story" className="grid place-items-center size-9 rounded-full text-ink-2 hover:text-ink hover:bg-white/5">
              <X size={20} weight="bold" />
            </button>
          </div>
        </div>

        {/* tap / hold surface */}
        <div className="absolute inset-0 z-10 touch-none" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onCancel} onPointerLeave={onCancel} onContextMenu={e => e.preventDefault()} />

        {idx === last && (posters || outro) && (
          <div className="absolute inset-x-8 bottom-[max(32px,calc(env(safe-area-inset-bottom)+20px))] z-20 flex flex-col items-center gap-2">
            {posters && model.summary && (
              <button onClick={() => setPostersOpen(true)} style={{ animationDelay: '0.6s' }}
                className="a-rise w-full rounded-full bg-wa-bright hover:bg-wa text-app font-bold text-[16px] py-3.5 glow-green transition-colors">
                Share your Rewind
              </button>
            )}
            {outro && (
              <button onClick={outro.onClick} style={{ animationDelay: '0.75s' }}
                className={posters && model.summary
                  ? 'a-rise py-2 text-[14px] font-semibold text-ink-2 hover:text-ink'
                  : 'a-rise w-full rounded-full bg-wa hover:bg-wa-bright text-app font-bold text-[16px] py-3.5 glow-green transition-colors'}>
                {outro.label}
              </button>
            )}
          </div>
        )}
        {postersOpen && posters && createPortal(<PosterSheet getModel={posters.getModel} canHide={posters.canHide} onClose={() => setPostersOpen(false)} />, document.body)}

        {idx < last && (
          <div className={`pointer-events-none absolute inset-x-0 bottom-[max(14px,env(safe-area-inset-bottom))] z-20 text-center text-[11px] text-ink-3 transition-opacity ${held ? 'opacity-0' : ''}`}>
            Tap to skip · hold to pause
          </div>
        )}
      </div>

      <button onClick={() => (idx === last ? onClose() : go(1))} aria-label="Next card"
        className="hidden md:grid place-items-center size-11 ml-5 rounded-full bg-panel/80 hover:bg-panel-2 text-ink transition-colors">
        <CaretRight size={20} weight="bold" />
      </button>
    </div>
  )
}
