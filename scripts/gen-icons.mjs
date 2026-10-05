// Generates the app icons from one SVG: the story ring (WA green gradient) around
// Phosphor's ChatCircleDots glyph (MIT, from @phosphor-icons). Run: node scripts/gen-icons.mjs
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

const BUBBLE = 'M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24ZM84,140a12,12,0,1,1,12-12A12,12,0,0,1,84,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,128,140Zm44,0a12,12,0,1,1,12-12A12,12,0,0,1,172,140Z'

function svg({ rounded, scale = 1 }) {
  const s = 1.12
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#86efac"/>
      <stop offset="0.35" stop-color="#25D366"/>
      <stop offset="0.7" stop-color="#00A884"/>
      <stop offset="1" stop-color="#075E54"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="#0B141A"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="192" fill="none" stroke="url(#ring)" stroke-width="24"/>
    <path d="${BUBBLE}" fill="#25D366" transform="translate(${256 - 128 * s} ${256 - 128 * s}) scale(${s})"/>
  </g>
</svg>`
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/favicon.svg', svg({ rounded: true }))
const out = [
  ['public/icons/icon-192.png', 192, svg({ rounded: true })],
  ['public/icons/icon-512.png', 512, svg({ rounded: true })],
  ['public/icons/maskable-512.png', 512, svg({ rounded: false, scale: 0.78 })],
  ['public/icons/apple-touch-icon.png', 180, svg({ rounded: false, scale: 0.86 })],
]
for (const [file, size, src] of out) {
  await sharp(Buffer.from(src)).resize(size, size).png().toFile(file)
  console.log('wrote', file)
}
