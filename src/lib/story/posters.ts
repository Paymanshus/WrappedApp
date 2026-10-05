import { DISPLAY_FAMILY, loadDisplayFont } from '../fonts'
import { DOW, fmtDuration, fmtNum, hourLabel } from '../format'
import { fxImage, preloadModel } from './canvas'
import type { StoryModel, Summary } from './model'
import { arc, bubble, rrect } from './scene'

// Wrapped-style share posters: one-page highlight images (1080×1920) made to be posted.
// Same system as the story — chat-bubble frames, status ring, radial clock, condensed
// display type — but louder: solid saturated color fields (no gradients), echo-outlined
// numbers, bold patterns and a film grain. Every color comes from existing tokens
// (design_spec.md → "Share posters").

export const PW = 1080
export const PH = 1920
const UI = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const DISPLAY = `"${DISPLAY_FAMILY}", ${UI}`
const DARK = '#0B141A'

interface Theme { bg: string; ink: string; sub: string; card: string; cardInk: string; accent: string; pattern: 'dots' | 'rings' | 'stripes' | 'bubbles' | 'spiral'; patternInk: string }

const THEMES: Record<string, Theme> = {
  overview: { bg: '#25D366', ink: DARK, sub: 'rgba(11,20,26,.66)', card: '#ffffff', cardInk: DARK, accent: '#005C4B', pattern: 'dots', patternInk: 'rgba(11,20,26,.13)' },
  personality: { bg: '#075E54', ink: '#ffffff', sub: 'rgba(255,255,255,.74)', card: 'rgba(255,255,255,.12)', cardInk: '#ffffff', accent: '#86efac', pattern: 'rings', patternInk: 'rgba(134,239,172,.16)' },
  top: { bg: '#FB7185', ink: DARK, sub: 'rgba(11,20,26,.66)', card: '#ffffff', cardInk: DARK, accent: '#ffffff', pattern: 'stripes', patternInk: 'rgba(255,255,255,.2)' },
  us: { bg: '#8b5cf6', ink: '#ffffff', sub: 'rgba(255,255,255,.78)', card: '#ffffff', cardInk: DARK, accent: DARK, pattern: 'bubbles', patternInk: 'rgba(255,255,255,.12)' },
  clock: { bg: '#53BDEB', ink: DARK, sub: 'rgba(11,20,26,.66)', card: DARK, cardInk: '#ffffff', accent: '#ffffff', pattern: 'spiral', patternInk: 'rgba(255,255,255,.22)' },
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string }

// ---------- primitives ----------

const disp = (c: Ctx, size: number) => { c.font = `800 ${size}px ${DISPLAY}` }
const ui = (c: Ctx, size: number, weight = 500) => { c.font = `${weight} ${size}px ${UI}` }

function fit(c: Ctx, text: string, start: number, min: number, maxW: number, set: (s: number) => void) {
  let s = start
  set(s)
  while (s > min && c.measureText(text).width > maxW) { s -= 4; set(s) }
  return s
}

function wrap(c: Ctx, text: string, maxW: number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (c.measureText(next).width > maxW && line) { lines.push(line); line = w } else line = next
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…' }
  return lines
}

function kicker(c: Ctx, t: Theme, text: string, x: number, y: number, align: CanvasTextAlign = 'left') {
  ui(c, 34, 700)
  if (c.letterSpacing !== undefined) c.letterSpacing = '9px'
  c.fillStyle = t.ink
  c.textAlign = align
  c.fillText(text.toUpperCase(), x, y)
  if (c.letterSpacing !== undefined) c.letterSpacing = '0px'
}

/** Big number/headline with a Wrapped-style offset outline echo behind it. */
function echo(c: Ctx, t: Theme, text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left', fill = t.ink, echoInk = t.accent) {
  disp(c, size)
  c.textAlign = align
  c.lineJoin = 'round'
  c.strokeStyle = echoInk
  c.lineWidth = Math.max(3, size / 45)
  c.strokeText(text, x + size * 0.045, y + size * 0.045)
  c.fillStyle = fill
  c.fillText(text, x, y)
}

function fill(c: Ctx, d: string, color: string) { c.fillStyle = color; c.fill(new Path2D(d)) }
function stroke(c: Ctx, d: string, color: string, w: number) { c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.stroke(new Path2D(d)) }

let grainTile: HTMLCanvasElement | null = null
function grain(c: Ctx) {
  if (!grainTile) {
    grainTile = document.createElement('canvas')
    grainTile.width = grainTile.height = 220
    const g = grainTile.getContext('2d')!
    const img = g.createImageData(220, 220)
    let seed = 7
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const v = seed % 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 26
    }
    g.putImageData(img, 0, 0)
  }
  c.save()
  c.globalCompositeOperation = 'overlay'
  c.fillStyle = c.createPattern(grainTile, 'repeat')!
  c.fillRect(0, 0, PW, PH)
  c.restore()
}

function pattern(c: Ctx, t: Theme) {
  c.save()
  c.fillStyle = t.patternInk
  c.strokeStyle = t.patternInk
  if (t.pattern === 'dots') {
    for (let row = 0, y = 24; y < PH; row++, y += 44) for (let x = row % 2 ? 46 : 24; x < PW; x += 44) { c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill() }
  } else if (t.pattern === 'stripes') {
    c.lineWidth = 16
    for (let x = -PH; x < PW; x += 64) { c.beginPath(); c.moveTo(x, PH); c.lineTo(x + PH * 0.58, 0); c.stroke() }
  } else if (t.pattern === 'rings') {
    c.lineWidth = 3
    for (let r = 420; r < 1700; r += 110) { c.beginPath(); c.arc(540, 720, r, 0, Math.PI * 2); c.stroke() }
  } else if (t.pattern === 'spiral') {
    c.lineWidth = 6
    c.beginPath()
    for (let a = 0; a < Math.PI * 22; a += 0.04) { const r = 30 + a * 24; const x = 540 + r * Math.cos(a), y = 760 + r * Math.sin(a); if (a === 0) c.moveTo(x, y); else c.lineTo(x, y) }
    c.stroke()
  } else {
    for (let row = 0; row < 16; row++) for (let col = 0; col < 7; col++) {
      const x = col * 170 + (row % 2 ? 60 : -20), y = row * 130 - 30
      fill(c, bubble(x, y, 120, 72, (row + col) % 2 ? 'in' : 'out', 30), t.patternInk)
    }
  }
  c.restore()
}

function chrome(c: Ctx, t: Theme, model: StoryModel, s: Summary) {
  c.beginPath(); c.arc(112, 118, 28, 0, Math.PI * 2); c.strokeStyle = t.ink; c.lineWidth = 6; c.stroke()
  c.beginPath(); c.arc(112, 118, 15, 0, Math.PI * 2); c.fillStyle = t.ink; c.fill()
  ui(c, 38, 800); c.fillStyle = t.ink; c.textAlign = 'left'; c.textBaseline = 'alphabetic'
  c.fillText('WrappedApp', 158, 132)
  ui(c, 32, 600); c.fillStyle = t.sub; c.textAlign = 'right'
  c.fillText(model.yearLabel ? String(model.yearLabel) : s.span, PW - 90, 130)
  // footer
  c.fillStyle = t.sub
  c.fillRect(90, PH - 150, PW - 180, 3)
  ui(c, 36, 800); c.fillStyle = t.ink; c.textAlign = 'left'
  let title = model.title
  while (title.length > 4 && c.measureText(title).width > 900) title = title.slice(0, -2)
  c.fillText(title === model.title ? title : title + '…', 90, PH - 90)
}

// ---------- posters ----------

function overview(c: Ctx, t: Theme, model: StoryModel, s: Summary) {
  kicker(c, t, model.yearLabel ? `Our ${model.yearLabel} Rewind` : 'Our Rewind', 90, 270)
  fit(c, model.title, 120, 64, 900, n => disp(c, n))
  c.fillStyle = t.ink; c.textAlign = 'left'
  c.fillText(model.title, 90, 390)
  const size = fit(c, s.total.toLocaleString('en-US'), 300, 150, 880, n => disp(c, n))
  echo(c, t, s.total.toLocaleString('en-US'), 90, 400 + size * 0.86, size, 'left', t.ink, '#ffffff')
  ui(c, 46, 700); c.fillStyle = t.ink; c.textAlign = 'left'
  c.fillText(`messages · about ${fmtNum(s.perDay)} a day`, 94, 400 + size * 0.86 + 100)

  const tiles: [string, string][] = [
    ['Days talked', fmtNum(s.days)],
    [`Peak · ${DOW[s.peakDow]}s`, hourLabel(s.peakHour)],
    ['Longest streak', `${fmtNum(s.streak)} days`],
    ['Top emoji', s.topEmoji[0]?.[0] ?? '—'],
  ]
  const y0 = 860, w = 435, h = 270
  tiles.forEach(([label, value], i) => {
    const x = 90 + (i % 2) * (w + 30), y = y0 + Math.floor(i / 2) * (h + 34)
    fill(c, bubble(x, y, w, h, i % 2 ? 'out' : 'in', 40), t.card)
    ui(c, 32, 700); c.fillStyle = 'rgba(11,20,26,.62)'; c.textAlign = 'left'
    c.fillText(label, x + 38, y + 66)
    if (i === 3) { c.font = `150px ${UI}`; c.fillText(value, x + 34, y + 222) }
    else { fit(c, value, 128, 70, w - 76, n => disp(c, n)); c.fillStyle = t.cardInk; c.fillText(value, x + 36, y + 216) }
  })

  const py = 1500
  fill(c, rrect(90, py, 900, 200, 44), DARK)
  const img = fxImage(s.archetype.fx)
  if (img) c.drawImage(img, 120, py + 26, 148, 148)
  ui(c, 28, 700); c.fillStyle = '#86efac'; c.textAlign = 'left'
  if (c.letterSpacing !== undefined) c.letterSpacing = '6px'
  c.fillText(s.isGroup ? 'GROUP PERSONALITY' : 'CHAT PERSONALITY', 296, py + 74)
  if (c.letterSpacing !== undefined) c.letterSpacing = '0px'
  fit(c, s.archetype.title, 84, 44, 660, n => disp(c, n))
  c.fillStyle = '#ffffff'
  c.fillText(s.archetype.title, 296, py + 158)
}

function personality(c: Ctx, t: Theme, _model: StoryModel, s: Summary) {
  const cx = 540, cy = 700, n = Math.max(4, s.archetype.traits.length + 3)
  const colors = ['#86efac', '#25D366', '#ffffff']
  for (let i = 0; i < n; i++) stroke(c, arc(cx, cy, 330, i * (360 / n) + 4, (i + 1) * (360 / n) - 4), colors[i % 3], 34)
  c.beginPath(); c.arc(cx, cy, 410, 0, Math.PI * 2); c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 3; c.stroke()
  c.beginPath(); c.arc(cx + 410 * Math.cos(-0.6), cy + 410 * Math.sin(-0.6), 16, 0, Math.PI * 2); c.fillStyle = '#86efac'; c.fill()
  const img = fxImage(s.archetype.fx)
  if (img) c.drawImage(img, cx - 210, cy - 210, 420, 420)

  kicker(c, t, s.isGroup ? 'Our group personality' : 'Our chat personality', 540, 1180, 'center')
  const size = fit(c, s.archetype.title, 150, 96, 900, n => disp(c, n))
  let lines = [s.archetype.title]
  if (size <= 96) { disp(c, 96); lines = wrap(c, s.archetype.title, 900, 2) }
  const lh = Math.min(size, 96) === 96 && lines.length > 1 ? 100 : size
  lines.forEach((l, i) => echo(c, t, l, 540, 1310 + i * lh, lines.length > 1 ? 96 : size, 'center', '#86efac', '#25D366'))
  let y = 1310 + (lines.length - 1) * lh + 90
  ui(c, 42, 500); c.fillStyle = '#ffffff'; c.textAlign = 'center'
  wrap(c, s.archetype.line, 880, 3).forEach(l => { c.fillText(l, 540, y); y += 60 })
  y += 30
  ui(c, 34, 700)
  const pads = s.archetype.traits.map(tr => c.measureText(tr).width + 64)
  const total = pads.reduce((a, b) => a + b, 0) + (pads.length - 1) * 16
  let x = 540 - Math.min(total, 940) / 2
  s.archetype.traits.forEach((tr, i) => {
    if (x + pads[i] > 1000) return
    stroke(c, rrect(x, y, pads[i], 70, 35), '#ffffff', 3)
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.fillText(tr, x + pads[i] / 2, y + 47)
    x += pads[i] + 16
  })
}

function top(c: Ctx, t: Theme, _model: StoryModel, s: Summary) {
  kicker(c, t, 'The top 5s', 90, 270)
  disp(c, 72); c.fillStyle = t.ink; c.textAlign = 'left'
  c.fillText('Top emoji', 90, 380)
  c.fillText('Records', 580, 380)
  c.fillStyle = 'rgba(11,20,26,.25)'; c.fillRect(540, 320, 3, 1060)
  const records: [string, string][] = [
    ['Longest streak', `${fmtNum(s.streak)} days`],
    ['Biggest day', `${fmtNum(s.bigDay.count)} msgs`],
    ['Fastest replies', s.fastest ? fmtDuration(s.fastest.sec) : '—'],
    ['Laughs', fmtNum(s.laughs)],
    ['Longest message', s.longest ? `${fmtNum(s.longest.words)} words` : '—'],
  ]
  for (let i = 0; i < 5; i++) {
    const y = 470 + i * 190
    const e = s.topEmoji[i]
    disp(c, 74); c.fillStyle = t.ink; c.textAlign = 'left'
    c.fillText(String(i + 1), 90, y + 70)
    if (e) {
      c.font = `96px ${UI}`; c.fillText(e[0], 160, y + 78)
      ui(c, 34, 700); c.fillStyle = t.sub; c.fillText(`${fmtNum(e[1])}×`, 300, y + 62)
    }
    ui(c, 30, 700); c.fillStyle = t.sub; c.fillText(records[i][0], 580, y + 20)
    fit(c, records[i][1], 74, 44, 410, n => disp(c, n)); c.fillStyle = t.ink
    c.fillText(records[i][1], 580, y + 98)
  }
  const by = 1450
  fill(c, bubble(90, by, 900, 250, 'in', 44), t.card)
  ui(c, 30, 700); c.fillStyle = 'rgba(11,20,26,.62)'; c.textAlign = 'left'
  c.fillText('Messages', 136, by + 70)
  c.fillText(s.isGroup ? 'Group personality' : 'Personality', 560, by + 70)
  fit(c, s.total.toLocaleString('en-US'), 110, 60, 400, n => disp(c, n)); c.fillStyle = DARK
  c.fillText(s.total.toLocaleString('en-US'), 136, by + 190)
  disp(c, 60)
  wrap(c, s.archetype.title, 400, 2).forEach((l, i, a) => c.fillText(l, 560, by + (a.length > 1 ? 150 : 185) + i * 62))
}

function us(c: Ctx, t: Theme, _model: StoryModel, s: Summary) {
  if (s.isGroup && s.awards.length) {
    kicker(c, t, 'The group awards', 90, 270)
    s.awards.forEach((a, i) => {
      const y = 360 + i * 330
      fill(c, bubble(90, y, 900, 290, i % 2 ? 'out' : 'in', 44), t.card)
      const img = fxImage(a.fx)
      if (img) c.drawImage(img, 130, y + 55, 180, 180)
      ui(c, 30, 700); c.fillStyle = 'rgba(11,20,26,.6)'; c.textAlign = 'left'
      if (c.letterSpacing !== undefined) c.letterSpacing = '5px'
      c.fillText(a.title.toUpperCase(), 350, y + 92)
      if (c.letterSpacing !== undefined) c.letterSpacing = '0px'
      fit(c, a.name, 96, 50, 600, n => disp(c, n)); c.fillStyle = DARK
      c.fillText(a.name, 350, y + 190)
      ui(c, 34, 600); c.fillStyle = '#7c3aed'; c.fillText(a.detail, 350, y + 244)
    })
    const ppl = s.people.slice(0, 4)
    let x = 90
    ppl.forEach(p => {
      const w = 900 * p.share
      fill(c, rrect(x, 1400, Math.max(8, w - 6), 60, 30), p.color === '#00A884' ? '#25D366' : '#ffffff')
      x += w
    })
    ui(c, 34, 700); c.fillStyle = t.ink; c.textAlign = 'left'
    c.fillText(`${ppl[0]?.name ?? ''} sends ${Math.round((ppl[0]?.share ?? 0) * 100)}% of everything`, 90, 1540)
    return
  }
  const [a, b] = s.people
  if (!a || !b) return
  kicker(c, t, 'Head to head', 540, 270, 'center')
  const pa = a.share / (a.share + b.share)
  const ra = 120 + 140 * Math.sqrt(pa), rb = 120 + 140 * Math.sqrt(1 - pa)
  const bubbleAt = (cx: number, r: number, color: string, ink: string, side: 'in' | 'out', name: string, pct: number) => {
    const tail = side === 'in' ? `M${cx - r * 0.62} ${600 + r * 0.62}L${cx - r * 0.98} ${600 + r * 0.98}L${cx - r * 0.2} ${600 + r * 0.9}Z` : `M${cx + r * 0.62} ${600 + r * 0.62}L${cx + r * 0.98} ${600 + r * 0.98}L${cx + r * 0.2} ${600 + r * 0.9}Z`
    fill(c, tail, color)
    c.beginPath(); c.arc(cx, 600, r, 0, Math.PI * 2); c.fillStyle = color; c.fill()
    ui(c, 34, 700); c.fillStyle = ink; c.textAlign = 'center'
    let n = name
    while (n.length > 3 && c.measureText(n).width > r * 1.6) n = n.slice(0, -2)
    c.fillText(n === name ? n : n + '…', cx, 600 - r * 0.25)
    fit(c, `${pct}%`, r * 0.8, 50, r * 1.6, x => disp(c, x)); c.fillText(`${pct}%`, cx, 600 + r * 0.42)
  }
  bubbleAt(330, ra, '#ffffff', DARK, 'in', a.name, Math.round(pa * 100))
  bubbleAt(760, rb, DARK, '#ffffff', 'out', b.name, 100 - Math.round(pa * 100))

  const rows: [string, number, number, (n: number) => string, boolean][] = [
    ['Messages', a.messages, b.messages, fmtNum, true],
    ['Typical reply', a.replySec ?? 0, b.replySec ?? 0, n => (n ? fmtDuration(n) : '—'), false],
    ['Laughs', a.laughs, b.laughs, fmtNum, true],
    ['Characters a message', a.avgLen, b.avgLen, fmtNum, true],
  ]
  rows.forEach(([label, va, vb, f, more], i) => {
    const y = 1000 + i * 165
    ui(c, 30, 700); c.fillStyle = t.sub; c.textAlign = 'center'
    c.fillText(label, 540, y + 12)
    const winA = va !== vb && (more ? va > vb : va < vb && va > 0)
    const winB = va !== vb && !winA && vb > 0
    ;[[va, 290, winA], [vb, 790, winB]].forEach(([v, x, win]) => {
      const text = f(v as number)
      disp(c, 76)
      const w = c.measureText(text).width + 56
      if (win) fill(c, rrect((x as number) - w / 2, y + 30, w, 104, 52), '#ffffff')
      c.fillStyle = win ? DARK : '#ffffff'; c.textAlign = 'center'
      c.fillText(text, x as number, y + 110)
    })
  })
}

function clock(c: Ctx, t: Theme, _model: StoryModel, s: Summary) {
  kicker(c, t, 'The body clock', 90, 270)
  const cx = 540, cy = 800, r0 = 180
  const hours = s.hours.length === 24 ? s.hours : Array(24).fill(40)
  hours.forEach((v, h) => {
    const a = (h * 15 * Math.PI) / 180, len = 30 + 200 * (v / 100)
    const d = `M${cx + r0 * Math.sin(a)} ${cy - r0 * Math.cos(a)}L${cx + (r0 + len) * Math.sin(a)} ${cy - (r0 + len) * Math.cos(a)}`
    if (h === s.peakHour) { stroke(c, d, '#ffffff', 50); stroke(c, d, DARK, 22) }
    else stroke(c, d, `rgba(11,20,26,${0.3 + 0.6 * (v / 100)})`, 24)
  })
  c.beginPath(); c.arc(cx, cy, r0 - 26, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill()
  const label = hourLabel(s.peakHour)
  fit(c, label, 140, 70, 290, n => disp(c, n)); c.fillStyle = DARK; c.textAlign = 'center'
  c.fillText(label, cx, cy + 46)
  ui(c, 30, 700); c.fillStyle = t.sub
  ;[['12am', 0], ['6am', 90], ['12pm', 180], ['6pm', 270]].forEach(([l, deg]) => {
    const a = ((deg as number) * Math.PI) / 180
    c.fillText(l as string, cx + 455 * Math.sin(a), cy - 455 * Math.cos(a) + 10)
  })
  const night = s.peakHour >= 22 || s.peakHour < 5, early = s.peakHour >= 5 && s.peakHour < 10
  echo(c, t, `Most alive at ${label}`, 90, 1360, fit(c, `Most alive at ${label}`, 104, 60, 900, n => disp(c, n)), 'left', DARK, '#ffffff')
  ui(c, 44, 600); c.fillStyle = DARK; c.textAlign = 'left'
  c.fillText(`especially on ${DOW[s.peakDow]}s. ${night ? 'Certified night owls.' : early ? 'Early birds.' : 'Prime-time texters.'}`, 94, 1440)
  if (s.fastest) {
    const y = 1520
    fill(c, rrect(90, y, 900, 150, 75), t.card)
    stroke(c, `M150 ${y + 78}l24 24l44-50M196 ${y + 98}l4 4l44-50`, '#53BDEB', 10)
    ui(c, 34, 700); c.fillStyle = '#ffffff'; c.textAlign = 'left'
    c.fillText(`Replies land in ${fmtDuration(s.fastest.sec)}`, 280, y + 70)
    ui(c, 30, 500); c.fillStyle = 'rgba(255,255,255,.7)'
    c.fillText(`${s.fastest.name} is quickest on the draw`, 280, y + 114)
  }
}

// ---------- public ----------

export interface PosterDef { id: string; name: string; theme: Theme; draw: (c: Ctx, t: Theme, model: StoryModel, s: Summary) => void }

export function postersFor(model: StoryModel): PosterDef[] {
  const s = model.summary
  if (!s) return []
  const list: PosterDef[] = [
    { id: 'overview', name: 'The overview', theme: THEMES.overview, draw: overview },
    { id: 'personality', name: 'Personality', theme: THEMES.personality, draw: personality },
    { id: 'top', name: 'Top 5s', theme: THEMES.top, draw: top },
  ]
  if ((s.isGroup && s.awards.length) || (!s.isGroup && s.people.length >= 2)) {
    list.push({ id: 'us', name: s.isGroup ? 'Group awards' : 'Head to head', theme: THEMES.us, draw: us })
  }
  list.push({ id: 'clock', name: 'Body clock', theme: THEMES.clock, draw: clock })
  return list
}

export async function preparePosters(model: StoryModel) {
  await Promise.all([preloadModel(model), loadDisplayFont()])
}

/** Paint one poster onto a canvas at any scale (1 = 1080×1920). */
export function drawPoster(canvas: HTMLCanvasElement, model: StoryModel, def: PosterDef, scale = 1) {
  canvas.width = Math.round(PW * scale)
  canvas.height = Math.round(PH * scale)
  const c = canvas.getContext('2d')! as Ctx
  c.setTransform(scale, 0, 0, scale, 0, 0)
  c.textBaseline = 'alphabetic'
  c.fillStyle = def.theme.bg
  c.fillRect(0, 0, PW, PH)
  pattern(c, def.theme)
  chrome(c, def.theme, model, model.summary!)
  def.draw(c, def.theme, model, model.summary!)
  grain(c)
}

export async function posterBlob(model: StoryModel, def: PosterDef): Promise<Blob> {
  await preparePosters(model)
  const canvas = document.createElement('canvas')
  drawPoster(canvas, model, def, 1)
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not render the poster.'))), 'image/png'))
}
