import { LinkBreak } from '@phosphor-icons/react'
import { Story } from './Story'
import { ShareButton } from './ShareButton'
import type { StoryModel } from '../lib/story/model'

/** Someone opened a #r= link: play the story they were sent, then invite them in. */
export function SharedRewind({ result, onExit }: { result: StoryModel | 'invalid'; onExit: () => void }) {
  if (result === 'invalid') {
    return (
      <div className="h-dvh grid place-items-center bg-chatbg px-8">
        <div className="max-w-sm text-center">
          <LinkBreak size={44} className="mx-auto mb-4 text-wa-bright" />
          <h1 className="text-xl font-bold mb-2">This Rewind link is incomplete</h1>
          <p className="text-ink-2 text-[14px] leading-relaxed mb-6">
            Part of the link got cut off. Ask the person who sent it to copy the link again from WrappedApp.
          </p>
          <button onClick={onExit} className="rounded-full bg-wa hover:bg-wa-bright text-app font-semibold px-6 py-2.5 transition-colors">
            Open WrappedApp
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="h-dvh bg-[#05090c]">
      <Story
        model={result}
        onClose={onExit}
        renderShare={(_i, onOpenChange) => <ShareButton variant="icon" model={result} onOpenChange={onOpenChange} />}
        outro={{ label: 'Make your own Rewind', onClick: onExit }}
        posters={{ getModel: () => result, canHide: false }}
      />
    </div>
  )
}
