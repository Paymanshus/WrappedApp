import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExportIcon } from '@phosphor-icons/react'
import { buildStory, type StoryModel } from '../lib/story/model'
import type { ChatStats } from '../lib/types'
import { PosterSheet } from './PosterSheet'

type Source =
  | { chat: { name: string; isGroup: boolean }; stats: ChatStats; year?: number | null; model?: undefined }
  | { model: StoryModel; chat?: undefined; stats?: undefined; year?: undefined }

export function ShareButton(props: Source & {
  target?: 'story' | 'dashboard'
  variant?: 'pill' | 'icon'
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const { chat, stats, year, model, variant = 'pill', onOpenChange } = props
  const getModel = useCallback(
    (hide: boolean) => (model ?? buildStory(chat!, stats!, { hideNames: hide, year })),
    [model, chat, stats, year],
  )
  const toggle = (o: boolean) => { setOpen(o); onOpenChange?.(o) }

  return (
    <>
      {variant === 'icon' ? (
        <button onClick={e => { e.stopPropagation(); toggle(true) }} aria-label="Share" title="Share"
          className="grid place-items-center size-9 rounded-full text-ink-2 hover:text-wa-bright hover:bg-white/5 transition-colors">
          <ExportIcon size={19} weight="bold" />
        </button>
      ) : (
        <button onClick={() => toggle(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-wa hover:bg-wa-bright text-app font-semibold text-[13px] px-3.5 py-1.5 transition-colors">
          <ExportIcon size={15} weight="bold" /> Share
        </button>
      )}
      {/* portal: the story frame uses container queries (layout containment), which would
          otherwise trap this fixed-position sheet inside the 9:16 frame */}
      {open && createPortal(<PosterSheet getModel={getModel} canHide={!model} onClose={() => toggle(false)} />, document.body)}
    </>
  )
}
