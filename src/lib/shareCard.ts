import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import { CARD_H, CARD_W, drawCard, drawTransition, preloadModel, renderCardBlob } from './story/canvas'
import { sanitizeModel, type StoryModel } from './story/model'
import { CARD_SECONDS, TAIL_SECONDS, WIPE_SECONDS, renderSoundtrack } from './story/soundtrack'

// Sharing, all client-side:
//  • cards → PNG (canvas renderer), shared via the Web Share API when available
//  • whole story → video (same renderer, recorded with MediaRecorder)
//  • whole story → link: the story model is compressed into the URL *fragment* (#r=…).
//    Fragments are never sent to any server, so the link carries only the numbers and
//    copy on the cards — no messages — and needs no backend.

export { renderCardBlob }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rewind'
export const cardFileName = (model: StoryModel, index: number) => `wrappedapp-${slug(model.title)}-${index + 1}.png`

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function canShareFiles(sample: File): boolean {
  try { return !!navigator.canShare?.({ files: [sample] }) } catch { return false }
}

/** Opens the OS share sheet with the file; falls back to a download. Returns what happened. */
export async function shareOrDownload(blob: Blob, name: string, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type })
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  download(blob, name)
  return 'saved'
}

// ---------- link ----------

export function storyLink(model: StoryModel): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}#r=${compressToEncodedURIComponent(JSON.stringify(model))}`
}

export function readStoryHash(hash = location.hash): StoryModel | null | 'invalid' {
  if (!hash.startsWith('#r=')) return null
  try {
    const json = decompressFromEncodedURIComponent(hash.slice(3))
    return (json && sanitizeModel(JSON.parse(json))) || 'invalid'
  } catch {
    return 'invalid'
  }
}

// ---------- video ----------
// One timeline, two encoders. Preferred: Mediabunny (WebCodecs → MP4/H.264), which renders
// frame by frame — deterministic, faster than real time, works in a background tab.
// Fallback: MediaRecorder on a canvas stream (real time, tab must stay visible).

// card timing lives with the soundtrack: one card = 8 beats at 128 BPM, wipes on downbeats
const FPS = 30

export function videoSeconds(model: StoryModel) { return model.cards.length * CARD_SECONDS + TAIL_SECONDS }

/** Paint the frame at `sec` seconds into the video. */
function frameAt(ctx: CanvasRenderingContext2D, model: StoryModel, sec: number) {
  const idx = Math.min(model.cards.length - 1, Math.floor(sec / CARD_SECONDS))
  const local = sec - idx * CARD_SECONDS
  if (idx > 0 && local < WIPE_SECONDS) drawTransition(ctx, model, idx - 1, idx, local / WIPE_SECONDS, sec, CARD_SECONDS, local)
  else drawCard(ctx, model, idx, local, sec, Math.min(1, local / CARD_SECONDS))
}

export function videoSupported(): boolean {
  return typeof VideoEncoder !== 'undefined'
    || (typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function')
}

/** Slice [from, from + seconds) out of an AudioBuffer (for interleaving with video frames). */
function sliceAudio(buf: AudioBuffer, from: number, seconds: number): AudioBuffer {
  const a = Math.floor(from * buf.sampleRate)
  const len = Math.max(1, Math.min(buf.length - a, Math.floor(seconds * buf.sampleRate)))
  const out = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, a + len), ch)
  return out
}

export async function recordStoryVideo(
  model: StoryModel,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  opts: { sound?: boolean } = {},
): Promise<{ blob: Blob; ext: string }> {
  await preloadModel(model)
  let audio: AudioBuffer | null = null
  if (opts.sound !== false && typeof OfflineAudioContext !== 'undefined') {
    try { audio = await renderSoundtrack(model, videoSeconds(model)) } catch (e) { console.warn('[WrappedApp] soundtrack failed; exporting silent video', e) }
  }
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')!
  if (typeof VideoEncoder !== 'undefined') {
    const mb = await import('mediabunny')
    if (await mb.canEncodeVideo('avc', { width: CARD_W, height: CARD_H, bitrate: 5_000_000 })) {
      return encodeWithWebCodecs(mb, canvas, ctx, model, onProgress, signal, audio)
    }
  }
  return recordRealtime(canvas, ctx, model, onProgress, signal, audio)
}

/**
 * Some AAC encoders (Chrome's) prepend priming samples the MP4 doesn't trim, so audio would land
 * ~44 ms late. Measure it once per browser: encode a click at 200 ms, decode, see where it lands.
 */
async function audioOffset(mb: typeof import('mediabunny'), codec: 'aac' | 'opus', sampleRate: number): Promise<number> {
  const key = `wrappedapp-audio-offset-${codec}-${sampleRate}`
  try { const v = localStorage.getItem(key); if (v != null) return Number(v) } catch { /* no storage */ }
  try {
    const len = Math.floor(sampleRate * 0.6), at = Math.floor(sampleRate * 0.2)
    const probe = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate })
    for (let ch = 0; ch < 2; ch++) { const d = probe.getChannelData(ch); for (let i = 0; i < 48; i++) d[at + i] = 0.9 * Math.sin(i / 3) }
    const out = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() })
    const src = new mb.AudioBufferSource({ codec, bitrate: 160_000 })
    out.addAudioTrack(src)
    await out.start(); await src.add(probe); src.close(); await out.finalize()
    const ac = new AudioContext({ sampleRate })
    const dec = await ac.decodeAudioData(out.target.buffer!.slice(0))
    ac.close()
    const d = dec.getChannelData(0)
    let peak = 0, idx = at
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > peak) { peak = Math.abs(d[i]); idx = i }
    const offset = Math.max(0, Math.min(0.2, (idx - at - 16) / dec.sampleRate))
    try { localStorage.setItem(key, String(offset)) } catch { /* no storage */ }
    return offset
  } catch {
    return 0
  }
}

async function encodeWithWebCodecs(
  mb: typeof import('mediabunny'),
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  model: StoryModel,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  audio: AudioBuffer | null = null,
) {
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() })
  const source = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: 5_000_000 })
  output.addVideoTrack(source, { frameRate: FPS })
  let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null
  let audioLead = 0
  if (audio) {
    const fmt = { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate }
    const codec = (await mb.canEncodeAudio('aac', fmt)) ? 'aac' : (await mb.canEncodeAudio('opus', fmt)) ? 'opus' : null
    if (codec) { audioSource = new mb.AudioBufferSource({ codec, bitrate: 160_000 }); output.addAudioTrack(audioSource) }
    if (codec) audioLead = await audioOffset(mb, codec, audio.sampleRate)
  }
  await output.start()
  const total = videoSeconds(model)
  const frames = Math.round(total * FPS)
  let audioAt = audioLead      // skip the encoder's priming delay so sound lands on its frame
  const feedAudio = async (until: number) => {
    while (audioSource && audio && audioAt < Math.min(until + audioLead, audio.duration)) {
      await audioSource.add(sliceAudio(audio, audioAt, 1))
      audioAt += 1
    }
  }
  try {
    for (let f = 0; f < frames; f++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      await feedAudio(f / FPS + 1)          // keep audio about a second ahead, interleaved with video
      frameAt(ctx, model, f / FPS)
      await source.add(f / FPS, 1 / FPS)
      if (f % 6 === 0) { onProgress(f / frames); await new Promise(r => setTimeout(r)) }
    }
    await feedAudio(total + 1)
    audioSource?.close()
    source.close()
    await output.finalize()
  } catch (e) {
    await output.cancel().catch(() => {})
    throw e
  }
  onProgress(1)
  return { blob: new Blob([output.target.buffer!], { type: 'video/mp4' }), ext: 'mp4' }
}

function pickMime(): string {
  const prefs = ['video/mp4;codecs=avc1.4d002a', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  return prefs.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
}

async function recordRealtime(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  model: StoryModel,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  audio: AudioBuffer | null = null,
): Promise<{ blob: Blob; ext: string }> {
  frameAt(ctx, model, 0)
  const mime = pickMime()
  const stream = canvas.captureStream(FPS)
  let ac: AudioContext | null = null
  let player: AudioBufferSourceNode | null = null
  if (audio) {
    ac = new AudioContext({ sampleRate: audio.sampleRate })
    const dest = ac.createMediaStreamDestination()
    player = ac.createBufferSource(); player.buffer = audio; player.connect(dest)
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>(resolve => { rec.onstop = () => resolve() })
  const total = videoSeconds(model)
  rec.start(250)
  player?.start()
  const t0 = performance.now()
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
      const el = (performance.now() - t0) / 1000
      if (el >= total) { resolve(); return }
      frameAt(ctx, model, el)
      onProgress(el / total)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }).finally(() => {
    if (rec.state !== 'inactive') rec.stop()
    stream.getTracks().forEach(t => t.stop())
    ac?.close()
  })
  await stopped
  onProgress(1)
  const type = mime.split(';')[0]
  return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' }
}
