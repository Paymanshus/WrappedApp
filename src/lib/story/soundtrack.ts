import type { StoryModel } from './model'
import { cuesFor, type Cue } from './scene'

// Code-generated soundtrack for the exported video. No samples, no licensing: every sound is
// synthesized with the Web Audio API in an OfflineAudioContext (≈1 s to render ~50 s).
//
//  • Music bed — warm lo-fi pop at 128 BPM. One card = 8 beats, so every card change lands on
//    a downbeat. Chords cycle Cmaj7 → G6 → Am7 → Fmaj7 (one per card). Pads + bass from the
//    start; drums drop in on card 2; the outro strips back to the final chord and a cymbal.
//  • Sync hits — a whoosh on every bubble-wipe, and each scene's own cues (pops as bubbles
//    appear, ticks, the read-receipt chime, risers under count-ups) from scene.ts → cuesFor().

export const BPM = 128
export const BEAT = 60 / BPM
export const CARD_SECONDS = BEAT * 8          // 3.75 s
export const WIPE_SECONDS = 0.5
export const TAIL_SECONDS = BEAT * 4          // a bar to land the ending
/** The live story lingers longer per card (reading time): 16 beats, same grid and score. */
export const LIVE_CARD_SECONDS = BEAT * 16    // 7.5 s

const SR = 48000
const CHORDS = [
  [48, 52, 55, 59],   // Cmaj7
  [43, 47, 50, 52],   // G6
  [45, 48, 52, 55],   // Am7
  [41, 45, 48, 52],   // Fmaj7
]
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR)
  const d = b.getChannelData(0)
  let seed = 1
  for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1 }
  return b
}

/**
 * Render the score. Whole track by default (the video). With `only`, just one card's stretch —
 * `lead` seconds before its downbeat (the whoosh), the card, and its release — so the live
 * player can start a card in ~0.5 s instead of rendering the whole story first. The score is a
 * pure function of absolute time, so a card rendered alone sounds the same as in the full track.
 */
export async function renderSoundtrack(model: StoryModel, totalSeconds: number, cardSeconds = CARD_SECONDS, only?: { card: number; lead: number }): Promise<AudioBuffer> {
  const n = model.cards.length
  const isLast = !only || only.card === n - 1
  if (only) totalSeconds = only.lead + cardSeconds + (isLast ? TAIL_SECONDS + 0.3 : 1.2)
  const shift = only ? only.card * cardSeconds - only.lead : 0       // absolute time → buffer time
  const ctx = new OfflineAudioContext(2, Math.ceil(totalSeconds * SR), SR)
  const beats = Math.round(cardSeconds / BEAT)
  const noise = noiseBuffer(ctx, 2.5)

  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.9, 0)
  if (isLast) {
    master.gain.setValueAtTime(0.9, totalSeconds - 1.4)
    master.gain.linearRampToValueAtTime(0, totalSeconds - 0.05)
  }
  comp.connect(master).connect(ctx.destination)

  const bus = (gain: number) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(comp); return g }
  const music = bus(1)
  const padBus = ctx.createGain(); padBus.gain.value = 1; padBus.connect(music)   // ducked by the kick
  const sfx = bus(0.9)

  const outroAt = (n - 1) * cardSeconds - shift
  const drumsFrom = cardSeconds - shift, drumsTo = outroAt
  const wanted = (i: number) => !only || i === only.card

  // ---------- instruments ----------
  const env = (g: GainNode, t: number, a: number, peak: number, d: number, sustain = 0) => {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + a)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d)
  }
  const osc = (type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode, gain: number, a = 0.005, detune = 0) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune
    const g = ctx.createGain(); env(g, t, a, gain, dur)
    o.connect(g).connect(dest); o.start(t); o.stop(t + a + dur + 0.05)
    return o
  }
  const noiseHit = (t: number, dur: number, dest: AudioNode, gain: number, type: BiquadFilterType, f: number, q = 1) => {
    const src = ctx.createBufferSource(); src.buffer = noise
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q
    const g = ctx.createGain(); env(g, t, 0.002, gain, dur)
    src.connect(flt).connect(g).connect(dest); src.start(t, (t * 7.3) % 1.5); src.stop(t + dur + 0.05)
    return { src, flt, g }
  }
  const kick = (t: number) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
    const g = ctx.createGain(); env(g, t, 0.003, 0.9, 0.32)
    o.connect(g).connect(music); o.start(t); o.stop(t + 0.4)
    padBus.gain.setValueAtTime(1, t); padBus.gain.linearRampToValueAtTime(0.55, t + 0.02); padBus.gain.linearRampToValueAtTime(1, t + 0.28)
  }
  const clap = (t: number) => { noiseHit(t, 0.16, music, 0.32, 'bandpass', 1700, 0.9); osc('triangle', 210, t, 0.08, music, 0.12) }
  const hat = (t: number, accent: boolean) => noiseHit(t, 0.035, music, accent ? 0.09 : 0.05, 'highpass', 8500)

  // ---------- music bed ----------
  const pad = (chord: number[], t: number, dur: number) => {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.4
    lp.connect(padBus)
    for (const m of chord) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m + 12); o.detune.value = det
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.35)
      g.gain.setValueAtTime(0.03, t + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4)
      o.connect(g).connect(lp); o.start(t); o.stop(t + dur + 0.5)
    }
  }
  for (let i = 0; i < n; i++) {
    if (!wanted(i)) continue
    const t0 = i * cardSeconds - shift
    const chord = CHORDS[i % CHORDS.length]
    const last = i === n - 1
    pad(last ? CHORDS[0] : chord, t0, last ? Math.min(cardSeconds, CARD_SECONDS) + TAIL_SECONDS - 0.2 : cardSeconds)
    for (let b = 0; b < beats; b++) {
      const t = t0 + b * BEAT
      if (last && b >= 1) break
      // bass: root on 1 and 3, a passing octave on the "and" of 4
      if (b % 2 === 0) osc('sine', mtof(chord[0] - 12), t, BEAT * 1.6, music, 0.28, 0.01)
      if (b % 4 === 3) osc('sine', mtof(chord[0]), t + BEAT / 2, BEAT * 0.5, music, 0.12)
      if (t >= drumsFrom && t < drumsTo) {
        if (b % 2 === 0) kick(t)
        if (b % 2 === 1) clap(t)
        hat(t + BEAT / 2, true)
        hat(t, false)
      } else if (t < drumsFrom) {
        hat(t + BEAT / 2, false) // a light pulse before the drop
      }
    }
  }

  // ---------- sync hits ----------
  const whoosh = (t: number) => {
    const { flt, g } = noiseHit(t - 0.08, WIPE_SECONDS + 0.1, sfx, 0.0001, 'bandpass', 300, 1.2)
    flt.frequency.setValueAtTime(300, t - 0.08)
    flt.frequency.exponentialRampToValueAtTime(4200, t + WIPE_SECONDS * 0.8)
    g.gain.cancelScheduledValues(t - 0.08)
    g.gain.setValueAtTime(0.0001, t - 0.08)
    g.gain.exponentialRampToValueAtTime(0.26, t + WIPE_SECONDS * 0.45)
    g.gain.exponentialRampToValueAtTime(0.0001, t + WIPE_SECONDS + 0.05)
  }
  const scale = [72, 74, 76, 79, 81, 84, 86, 88]   // C major pentatonic-ish, above the pad
  const play = (c: Cue, at: number) => {
    const step = c.step ?? 0
    switch (c.kind) {
      case 'pop': {
        const f = mtof(scale[step % scale.length])
        const o = osc('sine', f * 1.6, at, 0.11, sfx, 0.16, 0.002)
        o.frequency.setValueAtTime(f * 1.6, at); o.frequency.exponentialRampToValueAtTime(f, at + 0.07)
        break
      }
      case 'blip': osc('square', mtof(scale[step % scale.length] + 12), at, 0.04, sfx, 0.035); break
      case 'tick': noiseHit(at, 0.02, sfx, 0.22, 'bandpass', 3200 + step * 60, 4); break
      case 'chime': osc('sine', 1318.5, at, 0.9, sfx, 0.11, 0.004); osc('sine', 1975.5, at + 0.09, 0.8, sfx, 0.08, 0.004); break
      case 'ding': osc('sine', 1046.5, at, 1, sfx, 0.1, 0.003); osc('sine', 2093, at, 0.5, sfx, 0.04, 0.003); break
      case 'riser': {
        const dur = Math.max(0.2, c.dur ?? 1)
        const o = ctx.createOscillator(); o.type = 'sawtooth'
        o.frequency.setValueAtTime(180, at); o.frequency.exponentialRampToValueAtTime(760, at + dur)
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, at); lp.frequency.exponentialRampToValueAtTime(3200, at + dur)
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.045, at + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.05)
        o.connect(lp).connect(g).connect(sfx); o.start(at); o.stop(at + dur + 0.1)
        break
      }
      case 'burst': noiseHit(at, 2.4, sfx, 0.16, 'highpass', 5200); osc('sine', mtof(84), at, 1.2, sfx, 0.06); break
    }
  }
  model.cards.forEach((card, i) => {
    if (!wanted(i)) return
    const t0 = i * cardSeconds - shift
    if (i > 0) whoosh(t0)
    for (const c of cuesFor(card)) if (c.t < cardSeconds) play(c, t0 + c.t)
  })
  // final landing: cymbal + chord stab on the outro downbeat
  if (isLast) noiseHit(outroAt, 2.6, sfx, 0.12, 'highpass', 6000)

  return ctx.startRendering()
}
