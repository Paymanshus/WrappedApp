import type { FxName } from './fx'
import type { PosterCard } from './model'

// Story motion engine. Every card's hero animation is a pure function of
// (card data, t = seconds since the card appeared, time = ambient seconds) that returns
// a flat list of vector primitives in a 1080×1920 space. Two renderers consume it:
//   • toSvg()   → live <svg> in the story player (DOM)
//   • drawPrims → canvas, for PNG cards and every frame of the exported MP4
// so the shared image/video is frame-identical to what the viewer saw.
// Visual language: WhatsApp primitives (bubbles, ticks, typing dots, status rings, doodle
// lattice) animated with Wrapped kinetics (staggered pops, sweeps, outline→fill, wipes).

export const W = 1080
export const H = 1920
/** Hero zone (scene + 3D illustration); text starts at TEXT_TOP below it. */
export const HERO = { cx: 540, cy: 590, top: 230, bottom: 950 }
export const TEXT_TOP = 1010
export const TEXT_TOP_NO_HERO = 300
/** A scene is fully entered by now — used for still images and reduced motion. */
export const SETTLED = 4.2

export const SC = {
  bg: '#0B141A', panel: '#202C33', panel2: '#2A3942', out: '#005C4B',
  wa: '#00A884', bright: '#25D366', mint: '#86efac',
  ink: '#E9EDEF', ink2: '#8696A0', ink3: '#667781',
  blue: '#53BDEB', coral: '#FB7185',
  cat: ['#00A884', '#8b5cf6', '#d97706', '#0284c7', '#e11d48'],
}

export type Prim =
  | { k: 'path'; d: string; fill?: string; stroke?: string; sw?: number; op?: number; len?: number; draw?: number }
  | { k: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; op?: number }
  | { k: 'text'; x: number; y: number; t: string; size: number; fill?: string; stroke?: string; sw?: number; op?: number; anchor?: 'start' | 'middle' | 'end'; weight?: number; display?: boolean }
  | { k: 'g'; x?: number; y?: number; s?: number; r?: number; op?: number; kids: Prim[] }

export type SceneKey = 'stream' | 'mosaic' | 'balance' | 'lengths' | 'clock' | 'ticks' | 'calendar' | 'spike' | 'reactions' | 'marquee' | 'status' | 'ripples'
export const SCENE_KEYS: SceneKey[] = ['stream', 'mosaic', 'balance', 'lengths', 'clock', 'ticks', 'calendar', 'spike', 'reactions', 'marquee', 'status', 'ripples']

/** Numbers a scene needs beyond the card copy. Small on purpose: it rides in share links. */
export interface SceneData {
  n?: number; hours?: number[]; peak?: number; sec?: number; days?: number; spark?: number[]; segments?: number
  lens?: number[]       // average characters per text message, per person (lengths scene)
  labels?: string[]     // display names for those people (already masked when names are hidden)
  ci?: number[]         // their identity color index into SC.cat (older links) — color follows the person
  cols?: string[]       // their identity colors as hex (custom colors; preferred over ci)
}

// ---------- easing ----------

const cl = (x: number) => Math.max(0, Math.min(1, x))
const seg = (t: number, start: number, dur: number) => cl((t - start) / dur)
const eo = (x: number) => 1 - Math.pow(1 - cl(x), 3)
const back = (x: number) => { const c = 1.70158; const y = cl(x) - 1; return 1 + (c + 1) * y * y * y + c * y * y }
const f1 = (n: number) => Math.round(n * 10) / 10

function mix(a: string, b: string, k: number) {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * cl(k)).toString(16).padStart(2, '0')).join('')
}

// ---------- shape helpers ----------

/** WhatsApp bubble with its corner tail. side 'in' = tail top-left, 'out' = tail top-right. */
export function bubble(x: number, y: number, w: number, h: number, side: 'in' | 'out', r = 26) {
  r = Math.min(r, h / 2, w / 2)
  return side === 'in'
    ? `M${f1(x)} ${f1(y)}H${f1(x + w - r)}A${r} ${r} 0 0 1 ${f1(x + w)} ${f1(y + r)}V${f1(y + h - r)}A${r} ${r} 0 0 1 ${f1(x + w - r)} ${f1(y + h)}H${f1(x + r)}A${r} ${r} 0 0 1 ${f1(x)} ${f1(y + h - r)}V${f1(y + 18)}L${f1(x - 16)} ${f1(y)}Z`
    : `M${f1(x + w)} ${f1(y)}H${f1(x + r)}A${r} ${r} 0 0 0 ${f1(x)} ${f1(y + r)}V${f1(y + h - r)}A${r} ${r} 0 0 0 ${f1(x + r)} ${f1(y + h)}H${f1(x + w - r)}A${r} ${r} 0 0 0 ${f1(x + w)} ${f1(y + h - r)}V${f1(y + 18)}L${f1(x + w + 16)} ${f1(y)}Z`
}

export function rrect(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h / 2, w / 2)
  return `M${f1(x + r)} ${f1(y)}H${f1(x + w - r)}A${r} ${r} 0 0 1 ${f1(x + w)} ${f1(y + r)}V${f1(y + h - r)}A${r} ${r} 0 0 1 ${f1(x + w - r)} ${f1(y + h)}H${f1(x + r)}A${r} ${r} 0 0 1 ${f1(x)} ${f1(y + h - r)}V${f1(y + r)}A${r} ${r} 0 0 1 ${f1(x + r)} ${f1(y)}Z`
}

/** Arc from angle a0 to a1 (degrees, 0 = 12 o'clock, clockwise). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`
}

const typingDots = (x: number, y: number, time: number, color = SC.ink2): Prim[] =>
  [0, 1, 2].map(j => ({ k: 'circle', cx: x + j * 34, cy: y - 10 * Math.max(0, Math.sin(time * 6 - j * 0.8)), r: 9, fill: color }))

// ---------- background patterns (static per card) ----------

function dots(): Prim[] {
  let d = ''
  for (let row = 0, y = 30; y < H; row++, y += 56) {
    for (let x = row % 2 ? 58 : 30; x < W; x += 56) d += `M${x - 2.2} ${y}a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0 -4.4 0`
  }
  return [{ k: 'path', d, fill: SC.ink, op: 0.07 }]
}

function stripes(): Prim[] {
  let d = ''
  for (let x = -H; x < W; x += 72) d += `M${x} ${H}L${x + H * 0.58} 0`
  return [{ k: 'path', d, stroke: SC.ink, sw: 2, op: 0.045 }]
}

function rings(): Prim[] {
  return Array.from({ length: 9 }, (_, i) => ({ k: 'circle', cx: HERO.cx, cy: HERO.cy, r: 300 + i * 150, stroke: SC.wa, sw: 2, op: 0.09 - i * 0.008 }))
}

// ---------- scenes ----------

type Scene = (card: PosterCard, t: number, time: number) => Prim[]

const stream: Scene = (_card, t, time) => {
  const spec: { s: 'in' | 'out'; w: number; lines: number[] }[] = [
    { s: 'in', w: 560, lines: [1, 0.6] }, { s: 'out', w: 430, lines: [0.85] }, { s: 'in', w: 480, lines: [1] },
    { s: 'out', w: 620, lines: [1, 0.7] }, { s: 'in', w: 390, lines: [0.75] }, { s: 'out', w: 520, lines: [1] },
  ]
  const items = spec.map((b, i) => ({ ...b, h: 40 + b.lines.length * 34, v: eo(seg(t, 0.15 + i * 0.42, 0.45)) }))
  const typing = eo(seg(t, 0.15 + spec.length * 0.42, 0.4))
  const out: Prim[] = []
  let bottom = HERO.bottom - 10
  if (typing > 0) {
    const y = bottom - 74 * typing
    out.push({ k: 'g', op: typing, kids: [{ k: 'path', d: bubble(150, y, 150, 74, 'in'), fill: SC.panel }, ...typingDots(190, y + 37, time)] })
    bottom -= (74 + 22) * typing
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const b = items[i]
    if (b.v <= 0) continue
    const y = bottom - b.h
    bottom -= (b.h + 22) * b.v
    const x = b.s === 'in' ? 150 : 930 - b.w
    const fade = cl((y - HERO.top + 40) / 80)
    const kids: Prim[] = [{ k: 'path', d: bubble(x, y, b.w, b.h, b.s), fill: b.s === 'in' ? SC.panel : SC.out }]
    b.lines.forEach((l, j) => kids.push({ k: 'path', d: rrect(x + 28, y + 24 + j * 34, (b.w - 56) * l, 16, 8), fill: b.s === 'in' ? SC.ink : SC.mint, op: b.s === 'in' ? 0.2 : 0.28 }))
    if (b.s === 'out') kids.push({ k: 'path', d: `M${x + b.w - 70} ${y + b.h - 22}l9 9l16-18M${x + b.w - 52} ${y + b.h - 13}l2 2l16-18`, stroke: SC.blue, sw: 4 })
    const s = 0.82 + 0.18 * back(seg(t, 0.15 + i * 0.42, 0.45))
    const ox = b.s === 'in' ? x : x + b.w
    out.push({ k: 'g', x: ox, y, s, op: b.v * fade, kids: [{ k: 'g', x: -ox, y: -y, kids }] })
  }
  return out
}

const mosaic: Scene = (card, t, time) => {
  const cols = 13, rows = 9, cell = 52, gap = 12
  const x0 = (W - (cols * (cell + gap) - gap)) / 2, y0 = 300
  const per = Math.max(1, Math.round((card.sd?.n ?? 117) / (cols * rows)))
  const out: Prim[] = []
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const i = c * rows + r
    const p = back(seg(t, 0.2 + (c + r) * 0.05, 0.4))
    if (p <= 0) continue
    const h = (i * 2654435761) % 100
    const wave = ((c + r) - time * 7) % 32
    const lit = wave > -2 && wave < 0
    const fill = lit ? SC.mint : h < 10 ? SC.bright : h < 32 ? SC.wa : SC.out
    const x = x0 + c * (cell + gap), y = y0 + r * (cell + gap)
    out.push({ k: 'g', x: x + cell / 2, y: y + cell / 2, s: p, kids: [{ k: 'path', d: bubble(-cell / 2 + 4, -cell / 2, cell - 8, cell, (c + r) % 2 ? 'in' : 'out', 14), fill }] })
  }
  out.push({ k: 'text', x: W / 2, y: 932, t: `each bubble ≈ ${per.toLocaleString('en-US')} message${per === 1 ? '' : 's'}`, size: 30, fill: SC.ink2, anchor: 'middle', op: eo(seg(t, 1.6, 0.5)) })
  return out
}

const balance: Scene = (card, t, time) => {
  const parts = card.viz?.kind === 'split' ? card.viz.parts.slice(0, 4) : []
  if (!parts.length) return []
  const total = Math.max(1, parts.reduce((x, p) => x + p.value, 0))
  const bodies = parts.map((p, i) => ({ p, r: Math.max(70, 270 * Math.sqrt(p.value / total)), x: 0, y: 0, i }))
  // deterministic packing: start on a line, relax overlaps, keep inside the hero zone
  bodies.forEach((b, i) => { b.x = W / 2 + (i - (bodies.length - 1) / 2) * 330; b.y = HERO.cy + (i % 2 ? 60 : -40) })
  for (let it = 0; it < 60; it++) {
    for (const a of bodies) for (const b of bodies) {
      if (a === b) continue
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, min = a.r + b.r + 24
      if (d < min) { const k = (min - d) / 2 / d; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k }
    }
    for (const b of bodies) {
      // ≥150 from the edges: phones (taller than 9:16) crop ~95 units per side
      b.x = Math.max(150 + b.r, Math.min(W - 150 - b.r, b.x))
      b.y = Math.max(HERO.top + b.r, Math.min(HERO.bottom - b.r, b.y))
    }
  }
  return bodies.map(b => {
    const s = back(seg(t, 0.25 + b.i * 0.18, 0.55))
    const bob = Math.sin(time * 1.5 + b.i * Math.PI) * 10
    const side = b.x < W / 2 ? 'in' : 'out'
    const tail = side === 'in'
      ? `M${-b.r * 0.62} ${b.r * 0.62}L${-b.r * 0.95} ${b.r * 0.98}L${-b.r * 0.25} ${b.r * 0.9}Z`
      : `M${b.r * 0.62} ${b.r * 0.62}L${b.r * 0.95} ${b.r * 0.98}L${b.r * 0.25} ${b.r * 0.9}Z`
    const label = b.p.label.length > 12 ? b.p.label.slice(0, 11) + '…' : b.p.label
    return {
      k: 'g', x: b.x, y: b.y + bob, s, kids: [
        { k: 'circle', cx: 0, cy: 0, r: b.r + 18, fill: b.p.color, op: 0.14 },
        { k: 'path', d: tail, fill: b.p.color },
        { k: 'circle', cx: 0, cy: 0, r: b.r, fill: b.p.color },
        { k: 'text', x: 0, y: 12 - (b.r > 120 ? 18 : 0), t: label, size: Math.min(40, b.r * 0.32), fill: '#ffffff', anchor: 'middle', weight: 700 },
        ...(b.r > 120 ? typingDots(-34, 46, time + b.i, 'rgba(255,255,255,0.7)') : []),
      ],
    } as Prim
  })
}

const clock: Scene = (card, t, time) => {
  const hours = card.sd?.hours ?? Array(24).fill(40)
  const peak = card.sd?.peak ?? hours.indexOf(Math.max(...hours))
  const r0 = 170, maxLen = 190
  const out: Prim[] = [{ k: 'circle', cx: HERO.cx, cy: HERO.cy, r: r0 - 30, stroke: SC.ink, sw: 2, op: 0.08 }]
  hours.forEach((v, h) => {
    const a = h * 15
    const g = eo(seg(t, 0.25 + h * 0.035, 0.5))
    const len = (24 + maxLen * (v / 100)) * g
    if (len <= 0) return
    const rad = (a * Math.PI) / 180
    const [sx, sy, ex, ey] = [HERO.cx + r0 * Math.sin(rad), HERO.cy - r0 * Math.cos(rad), HERO.cx + (r0 + len) * Math.sin(rad), HERO.cy - (r0 + len) * Math.cos(rad)]
    const d = `M${f1(sx)} ${f1(sy)}L${f1(ex)} ${f1(ey)}`
    if (h === peak) out.push({ k: 'path', d, stroke: SC.bright, sw: 44, op: 0.16 + 0.06 * Math.sin(time * 3) })
    out.push({ k: 'path', d, stroke: h === peak ? SC.bright : SC.wa, sw: 22, op: h === peak ? 1 : 0.35 + 0.5 * (v / 100) })
  })
  // hour labels sit inside the bar ring, clear of the text zone below the hero
  ;[['12a', 0], ['6a', 90], ['12p', 180], ['6p', 270]].forEach(([l, a]) => {
    const rad = ((a as number) * Math.PI) / 180, r = r0 - 34
    out.push({ k: 'text', x: HERO.cx + r * Math.sin(rad), y: HERO.cy - r * Math.cos(rad) + 9, t: l as string, size: 26, fill: SC.ink3, anchor: 'middle', op: eo(seg(t, 1, 0.5)) })
  })
  const ha = (peak * 15 * eo(seg(t, 1.2, 1.1)) * Math.PI) / 180
  out.push({ k: 'path', d: `M${HERO.cx} ${HERO.cy}L${f1(HERO.cx + (r0 - 40) * Math.sin(ha))} ${f1(HERO.cy - (r0 - 40) * Math.cos(ha))}`, stroke: SC.ink, sw: 6, op: 0.8 })
  return out
}

const ticks: Scene = (card, t, time) => {
  // the dial is a minute for sub-minute repliers, five minutes otherwise — so 7s still reads
  const sec = card.sd?.sec ?? 120
  const frac = cl(sec / (sec < 60 ? 60 : 300))
  const R = 290
  const out: Prim[] = [{ k: 'circle', cx: HERO.cx, cy: HERO.cy, r: R, stroke: SC.panel2, sw: 18 }]
  let minutes = ''
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 * Math.PI) / 180, r1 = R + 34, r2 = R + (i % 5 ? 46 : 60)
    minutes += `M${f1(HERO.cx + r1 * Math.sin(a))} ${f1(HERO.cy - r1 * Math.cos(a))}L${f1(HERO.cx + r2 * Math.sin(a))} ${f1(HERO.cy - r2 * Math.cos(a))}`
  }
  out.push({ k: 'path', d: minutes, stroke: SC.ink, sw: 3, op: 0.2 * eo(seg(t, 0.1, 0.5)) })
  const p = frac * eo(seg(t, 0.3, 1.3))
  if (p > 0.002) out.push({ k: 'path', d: arc(HERO.cx, HERO.cy, R, 0, Math.min(359.9, p * 360)), stroke: SC.bright, sw: 18 })
  const blue = seg(t, 1.45, 0.35)
  const color = mix(SC.ink2, SC.blue, blue)
  const pulse = blue >= 1 ? 1 + 0.04 * Math.sin(time * 3) : 1
  out.push({
    k: 'g', x: HERO.cx, y: HERO.cy + 10, s: pulse, kids: [
      { k: 'path', d: 'M-170 0L-100 70L40 -80', stroke: color, sw: 28, len: 306, draw: eo(seg(t, 0.4, 0.5)) },
      { k: 'path', d: 'M-48 52L-30 70L110 -80', stroke: color, sw: 28, len: 231, draw: eo(seg(t, 0.8, 0.45)) },
    ],
  })
  return out
}

const calendar: Scene = (card, t, time) => {
  const cols = 15, rows = 7, cell = 44, gap = 10, total = cols * rows
  const x0 = (W - (cols * (cell + gap) - gap)) / 2, y0 = 480
  const run = Math.min(card.sd?.days ?? 20, total - 8)
  const end = total - 8, start = end - run
  const step = Math.min(0.035, 2.2 / Math.max(1, run))
  const out: Prim[] = []
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const i = c * rows + r
    const x = x0 + c * (cell + gap), y = y0 + r * (cell + gap)
    const inRun = i >= start && i < end
    const lit = inRun ? eo(seg(t, 0.35 + (i - start) * step, 0.25)) : 0
    const appear = eo(seg(t, 0.05 + c * 0.02, 0.35))
    out.push({ k: 'path', d: rrect(x, y, cell, cell, 12), fill: lit > 0 ? mix(SC.panel, SC.bright, lit * (0.55 + 0.45 * ((i - start) / Math.max(1, run)))) : SC.panel, op: appear })
    if (i === end - 1 && lit >= 1) out.push({ k: 'path', d: rrect(x - 8, y - 8, cell + 16, cell + 16, 18), stroke: SC.bright, sw: 4, op: 0.35 + 0.35 * Math.sin(time * 4) })
  }
  return out
}

const spike: Scene = (card, t, time) => {
  const v = card.sd?.spark?.length ? card.sd.spark : Array.from({ length: 31 }, (_, i) => (i === 15 ? 100 : 20))
  const x0 = 110, x1 = 970, base = 900, top = 430
  const pts = v.map((y, i) => [x0 + (i * (x1 - x0)) / (v.length - 1), base - (y / 100) * (base - top)])
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const [p0, p1, p2, p3] = [pts[Math.max(0, i - 2)], pts[i - 1], pts[i], pts[Math.min(pts.length - 1, i + 1)]]
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`
    len += Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  }
  const drawn = eo(seg(t, 0.2, 1.5))
  const peak = v.indexOf(Math.max(...v))
  const out: Prim[] = [
    { k: 'path', d: `M${x0} ${base}H${x1}`, stroke: SC.ink, sw: 2, op: 0.12 },
    { k: 'path', d: `${d}L${x1} ${base}L${x0} ${base}Z`, fill: SC.bright, op: 0.13 * eo(seg(t, 1.1, 0.8)) },
    { k: 'path', d, stroke: SC.bright, sw: 7, len: len * 1.08, draw: drawn },
  ]
  const [px, py] = pts[peak]
  const hit = eo(seg(t, 0.2 + 1.5 * (peak / (v.length - 1)), 0.3))
  if (hit > 0) {
    for (let k = 0; k < 3; k++) {
      const ph = (time * 0.8 + k / 3) % 1
      out.push({ k: 'circle', cx: px, cy: py, r: 16 + ph * 90, stroke: SC.bright, sw: 4, op: (1 - ph) * 0.5 * hit })
    }
    out.push({ k: 'circle', cx: px, cy: py, r: 16 * back(hit), fill: SC.bright })
    out.push({ k: 'path', d: `M${f1(px)} ${f1(py + 28)}V${base}`, stroke: SC.bright, sw: 3, op: 0.35 * hit })
  }
  return out
}

const reactions: Scene = (card, t, time) => {
  const items = card.viz?.kind === 'emoji' ? card.viz.items : []
  if (!items.length) return []
  const v = eo(seg(t, 0.1, 0.6))
  return Array.from({ length: 12 }, (_, k) => {
    const ph = ((time + k * 0.35) % 4.2) / 4.2
    const x = 170 + ((k * 137) % 740) + Math.sin(ph * 6.28 + k) * 30
    const y = HERO.bottom - ph * 720
    const s = 0.8 + 0.2 * (k % 3)
    return {
      k: 'g', x, y, s, op: Math.sin(ph * Math.PI) * v, kids: [
        { k: 'path', d: rrect(-56, -46, 112, 92, 46), fill: SC.panel, op: 0.92 },
        { k: 'text', x: 0, y: 20, t: items[k % items.length][0], size: 56, anchor: 'middle' },
      ],
    } as Prim
  })
}

const marquee: Scene = (_card, t, time) => {
  const word = 'HAHAHA '.repeat(9)
  return [330, 470, 610, 750, 890].map((y, row) => {
    const dir = row % 2 ? 1 : -1
    const x = -600 + (((time * 70 * dir) % 600) + 600) % 600 - (row % 2 ? 0 : 300)
    const filled = row === 2
    return {
      k: 'text', x, y, t: word, size: 132, weight: 800, display: true,
      fill: filled ? SC.bright : undefined, stroke: filled ? undefined : SC.ink, sw: 2,
      op: (filled ? 0.85 : 0.22) * eo(seg(t, 0.1 + row * 0.1, 0.5)),
    } as Prim
  })
}

const status: Scene = (card, t, time) => {
  const n = Math.max(3, Math.min(8, card.sd?.segments ?? 6))
  const colors = [SC.bright, SC.wa, SC.mint]
  const gapDeg = 8, span = 360 / n - gapDeg
  const ring: Prim[] = []
  for (let i = 0; i < n; i++) {
    const p = eo(seg(t, 0.2 + i * 0.12, 0.5))
    if (p > 0) ring.push({ k: 'path', d: arc(0, 0, 250, i * (360 / n), i * (360 / n) + span * p), stroke: colors[i % 3], sw: 16 })
  }
  const oa = time * 0.6
  return [
    { k: 'circle', cx: HERO.cx, cy: HERO.cy, r: 340, stroke: SC.ink, sw: 2, op: 0.08 },
    { k: 'circle', cx: HERO.cx + 340 * Math.cos(oa), cy: HERO.cy + 340 * Math.sin(oa), r: 22, fill: SC.bright, op: 0.18 },
    { k: 'circle', cx: HERO.cx + 340 * Math.cos(oa), cy: HERO.cy + 340 * Math.sin(oa), r: 9, fill: SC.bright },
    { k: 'g', x: HERO.cx, y: HERO.cy, r: time * 8, kids: ring },
  ]
}

const ripples: Scene = (_card, t, time) => {
  const v = eo(seg(t, 0.1, 0.5))
  const out: Prim[] = []
  for (let k = 0; k < 4; k++) {
    const ph = (time * 0.5 + k / 4) % 1
    out.push({ k: 'circle', cx: HERO.cx, cy: HERO.cy, r: 150 + ph * 230, stroke: SC.bright, sw: 3, op: (1 - ph) * 0.4 * v })
  }
  const burst = eo(seg(t, 0.15, 1.4))
  for (let k = 0; k < 22; k++) {
    const a = k * ((2 * Math.PI) / 22) + 0.3 * Math.sin(k * 3.1)
    const dist = (170 + ((k * 53) % 160)) * burst
    const x = HERO.cx + Math.cos(a) * dist + Math.sin(time * 1.2 + k) * 8
    const y = HERO.cy + Math.sin(a) * dist * 0.9 + Math.cos(time * 1.1 + k) * 8
    const r = 8 + (k % 4) * 5
    out.push({ k: 'path', d: bubble(x - r, y - r, r * 2, r * 1.7, k % 2 ? 'in' : 'out', r * 0.8), fill: SC.cat[k % SC.cat.length], op: eo(seg(t, 0.15, 0.3)) })
  }
  return out
}

/** Message length: each person's average message as a bubble that grows, wraps like a real
 *  chat (~30 chars a line at full width), then fills with text. Width and height both read. */
const lengths: Scene = (card, t, time) => {
  const lens = (card.sd?.lens ?? [44, 18]).slice(0, 4)
  const labels = card.sd?.labels ?? lens.map((_, i) => `Person ${i + 1}`)
  const ci = card.sd?.ci ?? lens.map((_, i) => i)
  const n = lens.length
  const PER_LINE = 30, X0 = 150, FULL = 780, MIN_W = 150
  const maxLines = n > 2 ? 2 : 5
  const rows = lens.map((len, i) => {
    const lines = Math.max(1, Math.min(maxLines, Math.ceil(len / PER_LINE)))
    const w = len >= PER_LINE ? FULL : MIN_W + (FULL - MIN_W) * (len / PER_LINE)
    const tail = len >= PER_LINE ? ((len % PER_LINE) || PER_LINE) / PER_LINE : 0.9
    return { len, lines, w, tail, h: 46 + lines * 30, label: labels[i] ?? '', color: card.sd?.cols?.[i] ?? SC.cat[(ci[i] ?? i) % SC.cat.length] }
  })
  const gap = n > 2 ? 22 : 44
  const total = rows.reduce((x, r) => x + 46 + r.h + gap, -gap)
  let y = HERO.cy - total / 2 + 10
  const out: Prim[] = []
  rows.forEach((r, i) => {
    const s0 = 0.25 + i * 0.4
    const head = eo(seg(t, s0, 0.4))
    out.push({ k: 'text', x: X0, y: y + 30, t: r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label, size: 30, fill: SC.ink2, weight: 600, op: head })
    const shown = Math.round(r.len * eo(seg(t, s0 + 0.3, 1)))
    out.push({ k: 'text', x: X0 + FULL, y: y + 34, t: `${shown.toLocaleString('en-US')} chars`, size: 44, weight: 800, display: true, anchor: 'end', fill: i === 0 ? SC.bright : SC.ink, op: head })
    const by = y + 46
    const g = eo(seg(t, s0 + 0.1, 0.8))
    const cw = 110 + (r.w - 110) * g
    const ch = 76 + (r.h - 76) * eo(seg(t, s0 + 0.6, 0.6))
    const kids: Prim[] = [
      { k: 'path', d: bubble(X0, by, cw, ch, 'in'), fill: r.color, op: 0.22 + 0.7 * head },
    ]
    const dotsOp = 1 - seg(t, s0 + 0.75, 0.25)
    if (dotsOp > 0) kids.push({ k: 'g', op: dotsOp, kids: typingDots(X0 + 34, by + 38, time + i, 'rgba(255,255,255,0.75)') })
    for (let j = 0; j < r.lines; j++) {
      const p = eo(seg(t, s0 + 0.85 + j * 0.15, 0.35))
      if (p <= 0) continue
      const inner = cw - 56
      const target = j < r.lines - 1 ? inner : inner * r.tail
      kids.push({ k: 'path', d: rrect(X0 + 28, by + 23 + j * 30, Math.max(8, target * p), 14, 7), fill: '#ffffff', op: 0.38 })
    }
    out.push({ k: 'g', kids })
    y += 46 + r.h + gap
  })
  return out
}

// ---------- sound cues ----------
// When each scene's visual beats happen (seconds since the card appeared). The soundtrack
// (lib/story/soundtrack.ts) plays a sound at each one, so audio is locked to the animation.
// Keep these next to the scenes: if a scene's timing changes, change its cues here too.

export type CueKind = 'pop' | 'tick' | 'chime' | 'riser' | 'ding' | 'burst' | 'blip'
export interface Cue { t: number; kind: CueKind; step?: number; dur?: number }

const CUES: Record<SceneKey, (card: PosterCard) => Cue[]> = {
  stream: () => [...Array.from({ length: 6 }, (_, i) => ({ t: 0.15 + i * 0.42, kind: 'pop' as const, step: i })),
    ...[0, 1, 2].map(j => ({ t: 2.7 + j * 0.16, kind: 'blip' as const, step: j }))],
  mosaic: () => Array.from({ length: 8 }, (_, i) => ({ t: 0.2 + i * 0.11, kind: 'pop' as const, step: i })),
  balance: card => (card.viz?.kind === 'split' ? card.viz.parts.slice(0, 4) : []).map((_, i) => ({ t: 0.25 + i * 0.18, kind: 'pop' as const, step: i * 2 })),
  lengths: card => (card.sd?.lens ?? [0, 0]).slice(0, 4).flatMap((_, i) => [
    { t: 0.25 + i * 0.4, kind: 'pop' as const, step: i * 2 },
    { t: 0.25 + i * 0.4 + 0.85, kind: 'tick' as const },
  ]),
  clock: () => [...Array.from({ length: 8 }, (_, i) => ({ t: 0.25 + i * 0.105, kind: 'tick' as const })),
    { t: 1.2, kind: 'riser', dur: 1.1 }, { t: 2.3, kind: 'ding' }],
  ticks: () => [{ t: 0.9, kind: 'tick' }, { t: 1.25, kind: 'tick' }, { t: 1.45, kind: 'chime' }],
  calendar: card => {
    const run = Math.min(card.sd?.days ?? 20, 97), step = Math.min(0.035, 2.2 / Math.max(1, run))
    const n = Math.min(14, run)
    return [...Array.from({ length: n }, (_, i) => ({ t: 0.35 + (i / n) * run * step, kind: 'tick' as const, step: i })),
      { t: 0.35 + run * step + 0.2, kind: 'ding' as const }]
  },
  spike: card => {
    const v = card.sd?.spark ?? []
    const peak = v.length ? v.indexOf(Math.max(...v)) / (v.length - 1) : 0.5
    return [{ t: 0.2, kind: 'riser', dur: 1.5 * peak + 0.05 }, { t: 0.2 + 1.5 * peak, kind: 'ding' }]
  },
  reactions: () => Array.from({ length: 6 }, (_, i) => ({ t: 0.3 + i * 0.35, kind: 'pop' as const, step: (i * 3) % 7 })),
  marquee: () => Array.from({ length: 5 }, (_, i) => ({ t: 0.1 + i * 0.1, kind: 'blip' as const, step: i })),
  status: card => Array.from({ length: Math.max(3, Math.min(8, card.sd?.segments ?? 6)) }, (_, i) => ({ t: 0.2 + i * 0.12, kind: 'pop' as const, step: i })),
  ripples: () => [{ t: 0.15, kind: 'burst' }, ...Array.from({ length: 6 }, (_, i) => ({ t: 0.25 + i * 0.07, kind: 'pop' as const, step: 6 - i }))],
}

/** Sound cues for a card: its scene's beats, plus a riser + ding under counting headlines. */
export function cuesFor(card: PosterCard): Cue[] {
  const out = card.scene && CUES[card.scene] ? CUES[card.scene](card) : []
  if (card.count != null) out.push({ t: 0.2, kind: 'riser', dur: 1.3 }, { t: 1.5, kind: 'ding' })
  return out
}

const SCENES: Record<SceneKey, Scene> = { stream, mosaic, balance, lengths, clock, ticks, calendar, spike, reactions, marquee, status, ripples }

const BG: Record<SceneKey, () => Prim[]> = {
  stream: dots, mosaic: dots, ticks: dots, calendar: dots, reactions: dots, lengths: dots,
  balance: stripes, spike: stripes, marquee: stripes,
  clock: rings, status: rings, ripples: rings,
}

const FX_SLOT: Partial<Record<SceneKey, { x: number; y: number; size: number }>> = {
  clock: { x: HERO.cx, y: HERO.cy, size: 180 },
  calendar: { x: HERO.cx, y: 350, size: 170 },
  marquee: { x: HERO.cx, y: 590, size: 240 },
  status: { x: HERO.cx, y: HERO.cy, size: 270 },
  ripples: { x: HERO.cx, y: HERO.cy, size: 250 },
}

export interface SceneRuntime {
  hero: boolean
  bg: Prim[]
  fg: (t: number, time: number) => Prim[]
  fx: { name: FxName; x: number; y: number; size: number } | null
}

const bgCache = new Map<string, Prim[]>()

export function sceneFor(card: PosterCard): SceneRuntime {
  const key = card.scene
  if (!key || !SCENES[key]) return { hero: false, bg: dots(), fg: () => [], fx: null }
  let bg = bgCache.get(key)
  if (!bg) { bg = BG[key](); bgCache.set(key, bg) }
  const slot = FX_SLOT[key]
  return {
    hero: true,
    bg,
    fg: (t, time) => SCENES[key](card, t, time),
    fx: slot && card.fx ? { name: card.fx, ...slot } : null,
  }
}

// ---------- SVG renderer ----------

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const DISPLAY = `'Archivo Display', -apple-system, 'Segoe UI', Roboto, sans-serif`
const UI = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif`

function paint(p: { fill?: string; stroke?: string; sw?: number; op?: number }, text = false) {
  // text with neither fill nor stroke (emoji) still has to paint — mirrors canvas fillText
  return `fill="${p.fill ?? (text && !p.stroke ? SC.ink : 'none')}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? 1}" stroke-linecap="round" stroke-linejoin="round"` : ''}${p.op != null && p.op < 1 ? ` opacity="${f1(p.op * 100) / 100}"` : ''}`
}

export function toSvg(prims: Prim[]): string {
  let s = ''
  for (const p of prims) {
    if (p.op != null && p.op <= 0.001) continue
    if (p.k === 'path') {
      const dash = p.len != null && p.draw != null ? ` stroke-dasharray="${f1(p.len)}" stroke-dashoffset="${f1(p.len * (1 - p.draw))}"` : ''
      if (p.draw === 0) continue
      s += `<path d="${p.d}" ${paint(p)}${dash}/>`
    } else if (p.k === 'circle') {
      s += `<circle cx="${f1(p.cx)}" cy="${f1(p.cy)}" r="${f1(Math.max(0, p.r))}" ${paint(p)}/>`
    } else if (p.k === 'text') {
      s += `<text x="${f1(p.x)}" y="${f1(p.y)}" font-size="${p.size}" font-weight="${p.weight ?? 400}" text-anchor="${p.anchor ?? 'start'}" style="font-family:${p.display ? DISPLAY : UI}" ${paint(p, true)}>${esc(p.t)}</text>`
    } else {
      s += `<g transform="translate(${f1(p.x ?? 0)} ${f1(p.y ?? 0)}) rotate(${f1(p.r ?? 0)}) scale(${(p.s ?? 1).toFixed(3)})"${p.op != null && p.op < 1 ? ` opacity="${f1(p.op * 100) / 100}"` : ''}>${toSvg(p.kids)}</g>`
    }
  }
  return s
}

// ---------- canvas renderer ----------

const pathCache = new Map<string, Path2D>()
const path2d = (d: string) => {
  let p = pathCache.get(d)
  if (!p) {
    p = new Path2D(d)
    if (pathCache.size > 4000) pathCache.clear()
    pathCache.set(d, p)
  }
  return p
}

export function drawPrims(ctx: CanvasRenderingContext2D, prims: Prim[]) {
  const c = ctx
  for (const p of prims) {
    if (p.op != null && p.op <= 0.001) continue
    c.save()
    if (p.op != null) c.globalAlpha *= p.op
    if (p.k === 'g') {
      c.translate(p.x ?? 0, p.y ?? 0)
      if (p.r) c.rotate((p.r * Math.PI) / 180)
      if (p.s != null) c.scale(p.s, p.s)
      drawPrims(c, p.kids)
    } else if (p.k === 'text') {
      c.font = `${p.weight ?? 400} ${p.size}px ${p.display ? DISPLAY : UI}`
      c.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left'
      c.textBaseline = 'alphabetic'
      if (p.fill) { c.fillStyle = p.fill; c.fillText(p.t, p.x, p.y) }
      if (p.stroke) { c.strokeStyle = p.stroke; c.lineWidth = p.sw ?? 1; c.strokeText(p.t, p.x, p.y) }
      if (!p.fill && !p.stroke) c.fillText(p.t, p.x, p.y)
    } else {
      const shape = p.k === 'path' ? path2d(p.d) : (() => { const q = new Path2D(); q.arc(p.cx, p.cy, Math.max(0, p.r), 0, Math.PI * 2); return q })()
      if (p.fill) { c.fillStyle = p.fill; c.fill(shape) }
      if (p.stroke) {
        if (p.k === 'path' && p.draw === 0) { c.restore(); continue }
        c.strokeStyle = p.stroke
        c.lineWidth = p.sw ?? 1
        c.lineCap = 'round'
        c.lineJoin = 'round'
        if (p.k === 'path' && p.len != null && p.draw != null) { c.setLineDash([p.len, p.len]); c.lineDashOffset = p.len * (1 - p.draw) }
        c.stroke(shape)
      }
    }
    c.restore()
  }
}
