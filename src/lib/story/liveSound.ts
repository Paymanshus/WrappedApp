import type { StoryModel } from './model'
import { LIVE_CARD_SECONDS, renderSoundtrack } from './soundtrack'

// The Rewind's soundtrack while you watch it. Same score as the exported video with live-length
// cards (16 beats), rendered one card at a time: the card you're on first (~0.5 s), the next two
// in the background. Every card change starts that card's stretch just before its downbeat (to
// catch the whoosh), so taps, holds and autoplay stay in sync.

const KEY = 'wrappedapp-sound'
const LEAD = 0.12   // start a hair before the downbeat so the transition whoosh is heard

export function soundPref(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export function setSoundPref(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* per-session only */ }
}

const cache = new WeakMap<StoryModel, Map<number, Promise<AudioBuffer>>>()
function cardTrack(model: StoryModel, card: number) {
  let m = cache.get(model)
  if (!m) cache.set(model, (m = new Map()))
  let p = m.get(card)
  if (!p) {
    p = renderSoundtrack(model, 0, LIVE_CARD_SECONDS, { card, lead: LEAD })
    p.catch(() => m!.delete(card))
    m.set(card, p)
  }
  return p
}

export class LiveSound {
  private ctx: AudioContext | null = null
  private token = 0
  private src: { node: AudioBufferSourceNode; gain: GainNode } | null = null
  private want: { card: number; offset: number } = { card: 0, offset: 0 }
  private paused = false
  private disposed = false
  private model: StoryModel

  constructor(model: StoryModel) {
    this.model = model
  }

  /** Create the audio graph and start the current card. Call from (or soon after) a user gesture. */
  start() {
    if (this.ctx || this.disposed) return
    this.ctx = new AudioContext({ latencyHint: 'playback' })
    if (this.paused) this.ctx.suspend().catch(() => {})
    this.play(this.want.card, this.want.offset)
  }

  /** Browsers may keep a fresh AudioContext suspended until a tap; call on pointerdown. */
  unlock() { if (this.ctx?.state === 'suspended' && !this.paused) this.ctx.resume().catch(() => {}) }

  /** Jump to a card (seconds into it). */
  seek(card: number, offset = 0) {
    this.want = { card, offset }
    if (this.ctx) this.play(card, offset)
  }

  setPaused(p: boolean) {
    this.paused = p
    if (!this.ctx) return
    // these reject if the context closed in the meantime (story closing); nothing to do then
    if (p) this.ctx.suspend().catch(() => {})
    else this.ctx.resume().catch(() => {})
  }

  dispose() {
    this.disposed = true
    this.stopCurrent(0.08)
    const ctx = this.ctx
    this.ctx = null
    if (ctx) window.setTimeout(() => ctx.close().catch(() => {}), 150)
  }

  private async play(card: number, offset: number) {
    const my = ++this.token
    this.stopCurrent(0.06)
    const t0 = performance.now()
    let buffer: AudioBuffer
    try { buffer = await cardTrack(this.model, card) } catch { return }
    const ctx = this.ctx
    if (!ctx || this.disposed || my !== this.token) return
    // prefetch what's coming
    for (const k of [card + 1, card + 2]) if (k < this.model.cards.length) cardTrack(this.model, k)
    // if rendering took a moment, join the card where the picture is now
    const late = this.paused ? 0 : (performance.now() - t0) / 1000
    const into = offset + late
    const at = into < 0.05 ? 0 : LEAD + into           // 0 = from the whoosh, just before the downbeat
    if (at >= buffer.duration) return
    const node = ctx.createBufferSource()
    node.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.03)
    node.connect(gain).connect(ctx.destination)
    node.start(0, Math.max(0, at))
    this.src = { node, gain }
  }

  private stopCurrent(fade: number) {
    const s = this.src, ctx = this.ctx
    this.src = null
    if (!s || !ctx) return
    const t = ctx.currentTime
    s.gain.gain.cancelScheduledValues(t)
    s.gain.gain.setValueAtTime(s.gain.gain.value, t)
    s.gain.gain.linearRampToValueAtTime(0, t + fade)
    s.node.stop(t + fade + 0.01)
  }
}
