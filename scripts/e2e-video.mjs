// Video check: encode the Rewind to MP4 in the page (Mediabunny/WebCodecs), then decode it
// with a <video> element and grab frames (incl. a bubble-wipe transition) as PNGs.
//   npm run dev   (in another terminal)
//   OUT=screens ENGINE=chromium|webkit node scripts/e2e-video.mjs
import { chromium, webkit } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const OUT = process.env.OUT ?? 'screens'
const name = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium'
mkdirSync(OUT, { recursive: true })
const b = await (name === 'webkit' ? webkit : chromium).launch()
const page = await (await b.newContext()).newPage()
await page.goto('http://localhost:5173')
const r = await page.evaluate(async () => {
  const { importExport } = await import('/src/lib/importer.ts')
  await importExport(new File([await (await fetch('/demo/demo-chat.txt')).blob()], 'WhatsApp Chat with Yash.txt'))
  const { db } = await import('/src/lib/db.ts')
  const { buildStory } = await import('/src/lib/story/model.ts')
  const { recordStoryVideo } = await import('/src/lib/shareCard.ts')
  const c = (await db.chats.toArray())[0]
  const model = buildStory(c, await db.stats.get(c.id), {})
  const t0 = performance.now()
  const { blob, ext } = await recordStoryVideo(model, () => {})
  const ms = Math.round(performance.now() - t0)
  const v = document.createElement('video')
  v.muted = true; v.src = URL.createObjectURL(blob)
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode failed')) })
  const frames = {}
  for (const t of [1.5, 3.95, 9.0, 30.0]) {
    v.currentTime = t
    await new Promise(res => { v.onseeked = res })
    const cv = document.createElement('canvas'); cv.width = 360; cv.height = 640
    cv.getContext('2d').drawImage(v, 0, 0, 360, 640)
    frames[t] = cv.toDataURL('image/png').split(',')[1]
  }
  // audio: render the soundtrack on its own, cross-correlate with the MP4's decoded audio → sync offset
  let audio = null
  try {
    const { renderSoundtrack } = await import('/src/lib/story/soundtrack.ts')
    const { videoSeconds } = await import('/src/lib/shareCard.ts')
    const ref = await renderSoundtrack(model, videoSeconds(model))
    const got = await new AudioContext({ sampleRate: 48000 }).decodeAudioData(await blob.arrayBuffer())
    const env = buf => { const d = buf.getChannelData(0), w = Math.floor(buf.sampleRate * 0.002), out = []; for (let i = 0; i + w < d.length && out.length < 10000; i += w) { let s = 0; for (let j = i; j < i + w; j++) s += Math.abs(d[j]); out.push(s / w) } return out }
    const A = env(ref), B = env(got)
    let best = 0, lag = 0
    for (let l = -100; l <= 100; l++) { let s = 0; for (let i = 100; i < A.length - 100; i++) s += A[i] * B[i + l]; if (s > best) { best = s; lag = l } }
    audio = { seconds: Math.round(got.duration * 10) / 10, channels: got.numberOfChannels, syncOffsetMs: lag * 2 }
  } catch (e) { audio = { error: String(e) } }
  const bytes = btoa(Array.from(new Uint8Array(await blob.arrayBuffer()), c => String.fromCharCode(c)).join(''))
  return { ext, kb: Math.round(blob.size / 1024), ms, duration: v.duration, w: v.videoWidth, h: v.videoHeight, audio, frames, bytes }
})
for (const [t, data] of Object.entries(r.frames)) writeFileSync(`${OUT}/video-${name}-${t}.png`, Buffer.from(data, 'base64'))
writeFileSync(`${OUT}/rewind-${name}.${r.ext}`, Buffer.from(r.bytes, 'base64'))
delete r.frames
delete r.bytes
console.log(name, JSON.stringify(r))
await b.close()
