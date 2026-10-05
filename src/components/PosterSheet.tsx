import { useEffect, useMemo, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import { CaretLeft, CaretRight, DownloadSimple, ExportIcon, FilmStrip, LinkSimple, X } from '@phosphor-icons/react'
import { drawPoster, posterBlob, postersFor, preparePosters } from '../lib/story/posters'
import type { StoryModel } from '../lib/story/model'
import { canShareFiles, download, recordStoryVideo, shareOrDownload, storyLink, videoSeconds, videoSupported } from '../lib/shareCard'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rewind'

/** The share hub (Wrapped-style end screen): swipe through highlight posters and share one or
 *  all, make the motion-graphics video, or copy a link. */
export function PosterSheet({ getModel, canHide, onClose }: {
  getModel: (hideNames: boolean) => StoryModel
  canHide: boolean
  onClose: () => void
}) {
  const [hide, setHide] = useState(false)
  const model = useMemo(() => getModel(hide), [getModel, hide])
  const defs = useMemo(() => postersFor(model), [model])
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const track = useRef<HTMLDivElement>(null)
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  const [rec, setRec] = useState<number | null>(null)
  const [video, setVideo] = useState<{ blob: Blob; ext: string; hide: boolean; sound: boolean } | null>(null)
  const [sound, setSound] = useState(true)
  const recAbort = useRef<AbortController | null>(null)
  useEffect(() => () => recAbort.current?.abort(), [])
  const fileShare = useMemo(() => canShareFiles(new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' })), [])

  useEffect(() => {
    let live = true
    preparePosters(model).then(() => { if (live) setReady(true) })
    return () => { live = false }
  }, [model])

  useEffect(() => {
    if (!ready) return
    defs.forEach((d, i) => { const c = canvases.current[i]; if (c) drawPoster(c, model, d, 0.5) })
  }, [ready, defs, model])

  const go = (i: number) => {
    const n = Math.max(0, Math.min(defs.length - 1, i))
    const el = track.current?.children[n] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  const onScroll = () => {
    const t = track.current
    if (!t) return
    const mid = t.scrollLeft + t.clientWidth / 2
    let best = 0, dist = Infinity
    Array.from(t.children).forEach((ch, i) => {
      const el = ch as HTMLElement
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid)
      if (d < dist) { dist = d; best = i }
    })
    setActive(best)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(active + 1)
      else if (e.key === 'ArrowLeft') go(active - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const flash = (s: string) => { setStatus(s); window.setTimeout(() => setStatus(cur => (cur === s ? '' : cur)), 2600) }
  const fileName = (id: string) => `wrappedapp-${slug(model.title)}-${id}.png`

  async function shareOne() {
    const d = defs[active]
    if (!d) return
    setBusy(true)
    try {
      const r = await shareOrDownload(await posterBlob(model, d), fileName(d.id), `${model.title} · WrappedApp`)
      if (r === 'saved') flash('Saved')
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not create the image.') } finally { setBusy(false) }
  }

  async function shareAll() {
    setBusy(true)
    try {
      const files = await Promise.all(defs.map(async d => new File([await posterBlob(model, d)], fileName(d.id), { type: 'image/png' })))
      if (navigator.canShare?.({ files })) {
        try { await navigator.share({ files, title: `${model.title} · WrappedApp` }); return } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
        }
      }
      // browsers block a burst of downloads after the first, so bundle them into one zip
      const zip = zipSync(Object.fromEntries(await Promise.all(files.map(async f => [f.name, new Uint8Array(await f.arrayBuffer())] as const))), { level: 0 })
      download(new Blob([zip], { type: 'application/zip' }), `wrappedapp-${slug(model.title)}-posters.zip`)
      flash(`Saved ${files.length} posters as one .zip`)
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not create the images.') } finally { setBusy(false) }
  }

  async function makeVideo() {
    const abort = new AbortController()
    recAbort.current = abort
    setVideo(null)
    setRec(0)
    try {
      const out = await recordStoryVideo(model, p => setRec(p), abort.signal, { sound })
      setVideo({ ...out, hide, sound })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.error('[WrappedApp] video export failed', e)
        flash(`Couldn't make the video: ${e instanceof Error ? e.message : String(e)}`)
      }
    } finally {
      setRec(null)
    }
  }

  async function shareVideo() {
    if (!video) return
    const r = await shareOrDownload(video.blob, `wrappedapp-${slug(model.title)}.${video.ext}`, `${model.title} · WrappedApp`)
    if (r === 'saved') flash('Video saved')
  }

  async function copyLink() {
    const url = storyLink(model)
    try { await navigator.clipboard.writeText(url); flash('Link copied: it opens the story, nothing else') } catch { window.prompt('Copy this link', url) }
  }

  const videoReady = video && video.hide === hide && video.sound === sound
  const secs = Math.round(videoSeconds(model))

  if (!defs.length) return null

  return (
    <div className="a-fade fixed inset-0 z-[75] flex flex-col bg-[#05090c]/95 backdrop-blur-md" role="dialog" aria-modal aria-label="Share your Rewind posters">
      <div className="flex items-center gap-3 px-5 pt-[max(16px,env(safe-area-inset-top))] pb-2">
        <div className="flex-1">
          <h2 className="font-display text-[28px] font-extrabold leading-none text-wa-bright">Share your Rewind</h2>
          <p className="mt-1 text-[13px] text-ink-2">Swipe for {defs.length} looks · made for stories and status</p>
        </div>
        <button onClick={onClose} autoFocus aria-label="Close" className="grid place-items-center size-10 rounded-full bg-panel/80 text-ink-2 hover:text-ink"><X size={18} weight="bold" /></button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center">
        <button onClick={() => go(active - 1)} disabled={active === 0} aria-label="Previous poster"
          className="hidden md:grid absolute left-6 z-10 place-items-center size-11 rounded-full bg-panel/90 text-ink disabled:opacity-20"><CaretLeft size={20} weight="bold" /></button>
        <div ref={track} onScroll={onScroll}
          className="flex h-full w-full items-center gap-5 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-[calc(50%-min(36vw,170px))] md:px-[calc(50%-150px)]">
          {defs.map((d, i) => (
            <button key={d.id} onClick={() => go(i)} aria-label={`${d.name} poster`}
              className={`snap-center shrink-0 w-[min(72vw,340px)] md:w-[300px] max-h-full aspect-[9/16] overflow-hidden rounded-[22px] shadow-2xl shadow-black/60 transition-[transform,opacity] duration-300 ${i === active ? 'scale-100 opacity-100' : 'scale-[.9] opacity-55'}`}
              style={{ background: d.theme.bg }}>
              <canvas ref={el => { canvases.current[i] = el }} width={540} height={960} className="h-full w-full" />
            </button>
          ))}
        </div>
        <button onClick={() => go(active + 1)} disabled={active === defs.length - 1} aria-label="Next poster"
          className="hidden md:grid absolute right-6 z-10 place-items-center size-11 rounded-full bg-panel/90 text-ink disabled:opacity-20"><CaretRight size={20} weight="bold" /></button>
      </div>

      <div className="px-5 pb-[max(18px,env(safe-area-inset-bottom))] pt-3 mx-auto w-full max-w-md space-y-3">
        <div className="flex items-center justify-center gap-2">
          {defs.map((d, i) => (
            <button key={d.id} onClick={() => go(i)} aria-label={`Go to ${d.name}`}
              className={`h-2 rounded-full transition-all ${i === active ? 'w-6' : 'w-2 opacity-40'}`} style={{ background: i === active ? d.theme.bg : '#8696A0' }} />
          ))}
        </div>
        <p className="text-center text-[13px] text-ink-2">{active + 1} of {defs.length} · <span className="text-ink">{defs[active]?.name}</span></p>
        {canHide && (
          <label className="flex items-center justify-between gap-3 rounded-xl bg-panel/70 px-4 py-2.5 cursor-pointer">
            <span className="text-[14px]">Hide names <span className="text-ink-3 text-[12px]">· initials only</span></span>
            <input type="checkbox" checked={hide} onChange={e => { setHide(e.target.checked); setReady(false) }} className="peer sr-only" />
            <span className="relative h-6 w-11 shrink-0 rounded-full bg-panel-2 transition-colors peer-checked:bg-wa peer-focus-visible:ring-2 peer-focus-visible:ring-wa-bright after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2.5">
          <button onClick={shareOne} disabled={busy || !ready}
            className="flex items-center justify-center gap-2 rounded-full bg-wa-bright hover:bg-wa disabled:opacity-60 text-app font-bold py-3.5 transition-colors">
            {fileShare ? <ExportIcon size={18} weight="bold" /> : <DownloadSimple size={18} weight="bold" />}
            {fileShare ? 'Share this one' : 'Save this one'}
          </button>
          <button onClick={shareAll} disabled={busy || !ready}
            className="rounded-full bg-panel hover:bg-panel-2 disabled:opacity-60 px-5 text-[14px] font-semibold transition-colors">
            {fileShare ? 'Share all' : 'Save all'}
          </button>
        </div>

        {videoSupported() && (
          <div className="rounded-2xl border border-wa/45 bg-wa/10 p-3.5">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center size-11 shrink-0 rounded-full bg-wa/20 text-wa-bright"><FilmStrip size={22} weight="fill" /></span>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-semibold">{videoReady ? 'Your video is ready' : 'Make a video of your Rewind'}</div>
                <div className="text-[12px] text-ink-2">{secs}-second animated story{sound ? ' with a synced soundtrack' : ''}, made on this device</div>
              </div>
              {rec == null && !videoReady && (
                <button onClick={makeVideo} className="shrink-0 rounded-full bg-wa-bright hover:bg-wa text-app font-bold text-[14px] px-4 py-2 transition-colors">Make video</button>
              )}
              {videoReady && rec == null && (
                <button onClick={shareVideo} className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-wa-bright hover:bg-wa text-app font-bold text-[14px] px-4 py-2 transition-colors">
                  {fileShare ? <ExportIcon size={15} weight="bold" /> : <DownloadSimple size={15} weight="bold" />}{fileShare ? 'Share' : 'Save'}
                </button>
              )}
            </div>
            {rec == null && (
              <label className="mt-2.5 flex items-center justify-between gap-3 cursor-pointer text-[13px] text-ink-2">
                <span>Sound <span className="text-ink-3">· music and effects timed to the animation</span></span>
                <input type="checkbox" checked={sound} onChange={e => setSound(e.target.checked)} className="peer sr-only" />
                <span className="relative h-5 w-9 shrink-0 rounded-full bg-panel-2 transition-colors peer-checked:bg-wa peer-focus-visible:ring-2 peer-focus-visible:ring-wa-bright after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-ink after:transition-transform peer-checked:after:translate-x-4" />
              </label>
            )}
            {rec != null && (
              <button onClick={() => recAbort.current?.abort()} className="mt-3 relative block w-full overflow-hidden rounded-full bg-panel py-2 text-[12.5px] text-ink-2">
                <span className="absolute inset-y-0 left-0 bg-wa/35 transition-[width]" style={{ width: `${Math.round(rec * 100)}%` }} />
                <span className="relative">Making video {Math.round(rec * 100)}% · tap to cancel</span>
              </button>
            )}
          </div>
        )}

        <button onClick={copyLink} className="mx-auto flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
          <LinkSimple size={15} weight="bold" className="text-wa-bright" /> Copy a link to the story
        </button>
        <p aria-live="polite" className="min-h-5 text-center text-[13px] text-wa-bright">{status}</p>
      </div>
    </div>
  )
}
