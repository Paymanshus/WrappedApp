import { fxUrl, type FxName } from './fx'
import type { PosterCard, Seg, StoryModel, Viz } from './model'
import { DISPLAY_FAMILY, loadDisplayFont } from '../fonts'
import { drawPrims, H as CARD_H_, SETTLED, TEXT_TOP, TEXT_TOP_NO_HERO, W as CARD_W_, sceneFor } from './scene'

// Canvas renderer for story cards: 1080×1920 (9:16, Instagram/WhatsApp status size).
// Mirrors the DOM story layout exactly (see design_spec.md → "Rewind card anatomy"):
//   scene layer (lib/story/scene.ts) → 3D illustration slot → text zone (kicker, headline, body, viz).
// drawCard() is pure in (model, index, t, time) so the same code paints a still PNG and
// every frame of the exported video.

export const CARD_W = CARD_W_
export const CARD_H = CARD_H_

const C = {
  bg: '#0B141A', ink: '#E9EDEF', ink2: '#8696A0', ink3: '#667781',
  wa: '#00A884', bright: '#25D366', alert: '#fb7185', panel: '#202C33',
}
const UI = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const DISPLAY = `"${DISPLAY_FAMILY}", ${UI}`

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string }

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3)
/** Entrance progress for an element that starts at `start` seconds into the card. */
const enter = (t: number, start: number, dur = 0.4) => easeOut((t - start) / dur)

// ---------- assets ----------

const loaded = new Map<string, HTMLImageElement>()
const loading = new Map<string, Promise<void>>()

function loadImage(src: string): Promise<void> {
  let p = loading.get(src)
  if (!p) {
    p = new Promise<void>(resolve => {
      const img = new Image()
      img.onload = () => { loaded.set(src, img); resolve() }
      img.onerror = () => resolve()
      img.src = src
    })
    loading.set(src, p)
  }
  return p
}

/** A loaded Fluent 3D image (after preloadModel), for other canvas renderers (posters). */
export const fxImage = (name: FxName) => loaded.get(fxUrl(name))

export async function preloadModel(model: StoryModel): Promise<void> {
  const names = new Set<FxName>()
  for (const c of model.cards) {
    if (c.fx) names.add(c.fx)
    if (c.viz?.kind === 'awards') c.viz.items.forEach(a => names.add(a.fx))
  }
  if (model.summary) {
    names.add(model.summary.archetype.fx)
    model.summary.awards.forEach(a => names.add(a.fx))
  }
  await Promise.all([
    ...[...names].map(n => loadImage(fxUrl(n))),
    loadDisplayFont(),
  ])
}

// ---------- text helpers ----------

const font = (size: number, weight = 400) => `${weight} ${size}px ${UI}`

function display(ctx: Ctx, size: number) { ctx.font = `800 ${size}px ${DISPLAY}` }
function undisplay(_ctx: Ctx) { /* display face is a fixed-width family; nothing to reset */ }

function fitSize(ctx: Ctx, text: string, start: number, min: number, maxW: number, setter: (s: number) => void) {
  let s = start
  setter(s)
  while (s > min && ctx.measureText(text).width > maxW) { s -= 4; setter(s) }
  return s
}

interface Tok { t: string; hl?: 1 | 2; w: number; space: boolean }
interface Line { toks: Tok[]; w: number }

function richLines(ctx: Ctx, segs: Seg[], size: number, maxW: number, setFont = (hl?: 1 | 2) => { ctx.font = font(size, hl ? 700 : 400) }): Line[] {
  const toks: Tok[] = []
  for (const s of segs) {
    for (const piece of s.t.split(/(\s+)/)) {
      if (!piece) continue
      setFont(s.hl)
      toks.push({ t: piece, hl: s.hl, w: ctx.measureText(piece).width, space: /^\s+$/.test(piece) })
    }
  }
  const lines: Line[] = [{ toks: [], w: 0 }]
  for (const tok of toks) {
    const line = lines[lines.length - 1]
    if (tok.space && !line.toks.length) continue
    if (!tok.space && line.w + tok.w > maxW && line.toks.length) {
      while (line.toks.length && line.toks[line.toks.length - 1].space) line.w -= line.toks.pop()!.w
      lines.push({ toks: [tok], w: tok.w })
    } else {
      line.toks.push(tok)
      line.w += tok.w
    }
  }
  return lines.filter(l => l.toks.length)
}

function drawRich(ctx: Ctx, lines: Line[], size: number, lineH: number, y: number) {
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  lines.forEach((line, i) => {
    let x = CARD_W / 2 - line.w / 2
    for (const tok of line.toks) {
      ctx.font = font(size, tok.hl ? 700 : 400)
      ctx.fillStyle = tok.hl === 1 ? C.bright : tok.hl === 2 ? C.alert : C.ink
      ctx.fillText(tok.t, x, y + i * lineH + size)
      x += tok.w
    }
  })
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2))
}

// ---------- chrome ----------

function drawLogo(ctx: Ctx, cx: number, cy: number, r: number) {
  const g = typeof ctx.createConicGradient === 'function'
    ? ctx.createConicGradient(0, cx, cy)
    : ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  ;['#075E54', '#00A884', '#25D366', '#86efac', '#25D366', '#00A884', '#075E54'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c))
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill()
  ctx.beginPath(); ctx.arc(cx, cy, r - 5, 0, Math.PI * 2); ctx.fillStyle = C.bg; ctx.fill()
  ctx.beginPath(); ctx.arc(cx, cy, r - 10, 0, Math.PI * 2); ctx.fillStyle = C.wa; ctx.fill()
}

function drawChrome(ctx: Ctx, model: StoryModel, index: number, prog: number) {
  const n = model.cards.length
  const gap = 10, x0 = 48, w = (CARD_W - x0 * 2 - gap * (n - 1)) / n
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (w + gap)
    roundRect(ctx, x, 52, w, 6, 3); ctx.fillStyle = 'rgba(134,150,160,.28)'; ctx.fill()
    const f = i < index ? 1 : i === index ? clamp(prog) : 0
    if (f > 0) { roundRect(ctx, x, 52, w * f, 6, 3); ctx.fillStyle = C.bright; ctx.fill() }
  }
  drawLogo(ctx, 76, 124, 26)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = font(34, 700); ctx.fillStyle = C.ink
  ctx.fillText('Wrapped', 118, 126)
  const waW = ctx.measureText('Wrapped').width
  ctx.fillStyle = C.bright
  ctx.fillText('App', 118 + waW, 126)
  ctx.textAlign = 'right'
  ctx.font = font(30, 500); ctx.fillStyle = C.ink2
  const label = model.title + (model.yearLabel ? ` · ${model.yearLabel}` : '')
  let title = label
  while (title.length > 4 && ctx.measureText(title).width > 520) title = title.slice(0, -2)
  ctx.fillText(title === label ? title : title + '…', CARD_W - 48, 126)

}

// ---------- text zone ----------

interface Block { h: number; gap: number; draw: (y: number) => void }

function vizBlock(ctx: Ctx, viz: Viz, t: number): Block {
  if (viz.kind === 'split') {
    const total = Math.max(1, viz.parts.reduce((x, p) => x + p.value, 0))
    const legendRows = Math.ceil(viz.parts.length / 2)
    return {
      h: 44 + 30 + legendRows * 52, gap: 0,
      draw: y => {
        const bw = 900, x0 = (CARD_W - bw) / 2, grow = enter(t, 0.5, 1)
        roundRect(ctx, x0, y, bw, 44, 22); ctx.fillStyle = 'rgba(42,57,66,.6)'; ctx.fill()
        let x = x0
        viz.parts.forEach((p, i) => {
          const w = (p.value / total) * bw * grow - (i < viz.parts.length - 1 ? 4 : 0)
          if (w > 0) { roundRect(ctx, x, y, w, 44, 22); ctx.fillStyle = p.color; ctx.fill() }
          x += (p.value / total) * bw * grow
        })
        ctx.globalAlpha = enter(t, 0.8)
        ctx.textBaseline = 'middle'
        viz.parts.forEach((p, i) => {
          const row = Math.floor(i / 2), col = i % 2
          const inRow = Math.min(2, viz.parts.length - row * 2)
          const cx = inRow === 1 ? CARD_W / 2 : CARD_W / 2 + (col === 0 ? -230 : 230)
          const cy = y + 44 + 30 + row * 52 + 18
          const label = `${p.label}  ${Math.round((p.value / total) * 100)}%`
          ctx.font = font(34, 600)
          const lw = ctx.measureText(label).width
          ctx.beginPath(); ctx.arc(cx - lw / 2 - 20, cy, 10, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill()
          ctx.textAlign = 'center'; ctx.fillStyle = C.ink2
          ctx.fillText(label, cx + 8, cy)
        })
        ctx.globalAlpha = 1
      },
    }
  }
  if (viz.kind === 'emoji') {
    const sizes = [170, 128, 128]
    return {
      h: 240, gap: 0,
      draw: y => {
        const order = [1, 0, 2].filter(i => i < viz.items.length)
        const widths = order.map(i => sizes[i] + 60)
        let x = CARD_W / 2 - widths.reduce((a, b) => a + b, 0) / 2
        order.forEach((i, k) => {
          const a = enter(t, 0.4 + i * 0.15, 0.4)
          const cx = x + widths[k] / 2
          ctx.globalAlpha = a
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
          ctx.font = font(sizes[i] * (0.7 + 0.3 * a))
          ctx.fillText(viz.items[i][0], cx, y + 180 - (1 - a) * 50)
          ctx.font = font(34, 600); ctx.fillStyle = C.ink2
          ctx.fillText(`${viz.items[i][1].toLocaleString('en-US')}×`, cx, y + 232)
          ctx.globalAlpha = 1
          x += widths[k]
        })
      },
    }
  }
  if (viz.kind === 'chips') {
    ctx.font = font(34, 600)
    const pads = viz.items.map(s => ctx.measureText(s).width + 60)
    const rows: number[][] = [[]]
    let rw = 0
    pads.forEach((w, i) => {
      if (rw + w > 940 && rows[rows.length - 1].length) { rows.push([]); rw = 0 }
      rows[rows.length - 1].push(i); rw += w + 16
    })
    return {
      h: rows.length * 84, gap: 0,
      draw: y => {
        rows.forEach((row, r) => {
          const tw = row.reduce((x, i) => x + pads[i], 0) + (row.length - 1) * 16
          let x = CARD_W / 2 - tw / 2
          row.forEach(i => {
            ctx.globalAlpha = enter(t, 0.7 + i * 0.1)
            roundRect(ctx, x, y + r * 84, pads[i], 66, 33)
            ctx.fillStyle = 'rgba(0,168,132,.14)'; ctx.fill()
            ctx.strokeStyle = 'rgba(0,168,132,.55)'; ctx.lineWidth = 2; ctx.stroke()
            ctx.font = font(34, 600); ctx.fillStyle = C.ink
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            ctx.fillText(viz.items[i], x + pads[i] / 2, y + r * 84 + 34)
            x += pads[i] + 16
          })
        })
        ctx.globalAlpha = 1
      },
    }
  }
  const rowH = 190
  return {
    h: viz.items.length * rowH, gap: 0,
    draw: y => {
      viz.items.forEach((a, i) => {
        const k = enter(t, 0.2 + i * 0.14, 0.45)
        const ry = y + i * rowH + (1 - k) * 40
        ctx.globalAlpha = k
        roundRect(ctx, 90, ry, 900, rowH - 24, 32)
        ctx.fillStyle = 'rgba(32,44,51,.85)'; ctx.fill()
        const img = loaded.get(fxUrl(a.fx))
        if (img) ctx.drawImage(img, 120, ry + 23, 120, 120)
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
        if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '3px'
        ctx.font = font(28, 600); ctx.fillStyle = C.ink2
        ctx.fillText(a.title.toUpperCase(), 272, ry + 52)
        if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px'
        fitSize(ctx, a.name, 52, 32, 680, s => display(ctx, s))
        ctx.fillStyle = C.ink
        ctx.fillText(a.name, 272, ry + 108)
        undisplay(ctx)
        ctx.font = font(32, 600); ctx.fillStyle = C.bright
        ctx.fillText(a.detail, 272, ry + 148)
        ctx.globalAlpha = 1
      })
    },
  }
}

/** Condensed display headline that draws as an outline, then fills from the bottom up. */
function headlineBlock(ctx: Ctx, card: PosterCard, t: number): Block | null {
  const headline = card.count != null
    ? Math.round(card.count * enter(t, 0.2, 1.3)).toLocaleString('en-US') + (card.suffix ?? '')
    : card.big
  if (!headline) return null
  const final = card.count != null ? card.count.toLocaleString('en-US') + (card.suffix ?? '') : headline
  const size = fitSize(ctx, final, 210, 104, 940, s => display(ctx, s))
  let lines = [headline]
  if (size <= 104 && card.count == null) {
    lines = richLines(ctx, [{ t: headline }], 104, 940, () => display(ctx, 104)).map(l => l.toks.map(k => k.t).join(''))
  }
  undisplay(ctx)
  const lh = size * 0.98
  return {
    h: lines.length * lh, gap: 34,
    draw: y => {
      const a = enter(t, 0.15, 0.45)
      const fill = enter(t, 0.35, 0.9)
      const h = lines.length * lh
      const rise = (1 - a) * 40
      ctx.save()
      ctx.globalAlpha = a
      display(ctx, size)
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = C.bright; ctx.lineWidth = 3
      lines.forEach((l, i) => ctx.strokeText(l, CARD_W / 2, y + (i + 1) * lh - size * 0.16 + rise))
      ctx.beginPath()
      ctx.rect(0, y + rise + h * (1 - fill) - 10, CARD_W, h * fill + 30)
      ctx.clip()
      ctx.fillStyle = C.bright
      ctx.shadowColor = 'rgba(37,211,102,.45)'; ctx.shadowBlur = 60
      lines.forEach((l, i) => ctx.fillText(l, CARD_W / 2, y + (i + 1) * lh - size * 0.16 + rise))
      undisplay(ctx)
      ctx.restore()
    },
  }
}

function textBlocks(ctx: Ctx, card: PosterCard, t: number): Block[] {
  const blocks: Block[] = [{
    h: 40, gap: 26,
    draw: y => {
      ctx.globalAlpha = enter(t, 0.1)
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '8px'
      ctx.font = font(32, 600); ctx.fillStyle = C.ink2
      ctx.fillText(card.kicker.toUpperCase(), CARD_W / 2, y + 32)
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px'
      ctx.globalAlpha = 1
    },
  }]
  const head = headlineBlock(ctx, card, t)
  if (head) blocks.push(head)
  if (card.body.length) {
    const lines = richLines(ctx, card.body, 44, 900)
    blocks.push({
      h: lines.length * 64, gap: 48,
      draw: y => {
        const a = enter(t, 0.4)
        ctx.globalAlpha = a
        drawRich(ctx, lines, 44, 64, y + (1 - a) * 30)
        ctx.globalAlpha = 1
      },
    })
  }
  if (card.viz) blocks.push(vizBlock(ctx, card.viz, t))
  if (blocks.length) blocks[blocks.length - 1].gap = 0
  return blocks
}

/**
 * Paint one card. t: seconds since the card appeared (SETTLED = fully entered, used for
 * stills). time: ambient seconds (loops). prog: fill of the current progress segment.
 */
export function drawCard(ctx: CanvasRenderingContext2D, model: StoryModel, index: number, t = SETTLED, time = 1.2, prog = 1) {
  const c = ctx as Ctx
  const card = model.cards[index]
  const scene = sceneFor(card)
  c.fillStyle = C.bg
  c.fillRect(0, 0, CARD_W, CARD_H)
  drawPrims(c, scene.bg)
  drawPrims(c, scene.fg(t, time))
  if (scene.fx) {
    const img = loaded.get(fxUrl(scene.fx.name))
    if (img) {
      const a = enter(t, 0, 0.5)
      const s = scene.fx.size * (0.75 + 0.25 * a)
      c.save()
      c.globalAlpha = a
      c.shadowColor = 'rgba(37,211,102,.35)'; c.shadowBlur = 50
      c.drawImage(img, scene.fx.x - s / 2, scene.fx.y - s / 2 + Math.sin(time * 1.6) * 10, s, s)
      c.restore()
    }
  }
  drawChrome(c, model, index, prog)

  const blocks = textBlocks(c, card, t)
  const top = scene.hero ? TEXT_TOP : TEXT_TOP_NO_HERO
  const avail = CARD_H - 150 - top
  const total = blocks.reduce((x, b) => x + b.h + b.gap, 0)
  c.save()
  if (total > avail) {
    const k = avail / total
    c.translate(CARD_W / 2, top)
    c.scale(k, k)
    c.translate(-CARD_W / 2, -top)
  }
  let y = top
  for (const b of blocks) { b.draw(y); y += b.h + b.gap }
  c.restore()
}

/** Bubble-wipe between two cards (video): the next card grows out of a circle. */
export function drawTransition(ctx: CanvasRenderingContext2D, model: StoryModel, from: number, to: number, p: number, time: number, holdT: number, toT: number) {
  drawCard(ctx, model, from, holdT, time, 1)
  // easeInOutCubic — same curve as the DOM .a-wipe (cubic-bezier(.65,0,.35,1))
  const k = clamp(p)
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
  const r = e * Math.hypot(CARD_W, CARD_H) * 0.75
  ctx.save()
  ctx.beginPath()
  ctx.arc(CARD_W / 2, CARD_H * 0.42, r, 0, Math.PI * 2)
  ctx.clip()
  drawCard(ctx, model, to, toT, time, 0)
  ctx.restore()
}

export async function renderCardBlob(model: StoryModel, index: number): Promise<Blob> {
  await preloadModel(model)
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  drawCard(canvas.getContext('2d')!, model, index)
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not render the image.'))), 'image/png'))
}
