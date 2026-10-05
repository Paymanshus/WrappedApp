import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Sparkle, ChatCircle, Play, UsersThree, MagnifyingGlass, DownloadSimple, UserGear, Question } from '@phosphor-icons/react'
import { Sidebar } from './components/Sidebar'
import { Reader } from './components/Reader'
import { Dashboard } from './components/Dashboard'
import { Story } from './components/Story'
import { ShareButton } from './components/ShareButton'
import { SharedRewind } from './components/SharedRewind'
import { PeopleSheet } from './components/PeopleSheet'
import { Find } from './components/Find'
import { AskPanel } from './components/AskPanel'
import { AllChats } from './components/AllChats'
import { Fx } from './components/Fx'
import { db } from './lib/db'
import { importExport, repairChat, DATA_VERSION } from './lib/importer'
import { initials } from './lib/format'
import { readStoryHash } from './lib/shareCard'
import { buildStory } from './lib/story/model'
import { useChatStats } from './lib/useStats'
import { guessYou } from './lib/people'
import { colorMap } from './lib/colors'
import type { Chat } from './lib/types'

type View = 'dashboard' | 'reader' | 'find' | 'ask'

export default function App() {
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const shared = useMemo(() => readStoryHash(hash), [hash])

  if (shared) {
    return (
      <SharedRewind result={shared} onExit={() => {
        history.replaceState(null, '', location.pathname + location.search)
        setHash('')
      }} />
    )
  }
  return <Workspace />
}

function Workspace() {
  const [chatId, setChatId] = useState<number | null>(null)
  const [view, setView] = useState<View>('dashboard')
  const [storyOpen, setStoryOpen] = useState(false)
  const [year, setYear] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [focus, setFocus] = useState<{ id: number; n: number } | null>(null)
  const [askFor, setAskFor] = useState<{ q: string; n: number } | null>(null)

  const chat = useLiveQuery(() => (chatId != null ? db.chats.get(chatId) : undefined), [chatId])
  const stats = useChatStats(chatId, year)
  const allTime = useChatStats(chatId, null)
  const years = useMemo(() => allTime?.yearly.map(y => y.year) ?? [], [allTime])
  // colors resolved once from all-time ranking, so switching years never repaints anyone
  const colored = useMemo(() => (chat && allTime ? { ...chat, colors: colorMap(chat, allTime) } : chat), [chat, allTime])
  const model = useMemo(() => (colored && stats && stats.totalMessages ? buildStory(colored, stats, { year }) : null), [colored, stats, year])

  function openChat(c: Chat, mode: 'story' | 'chat') {
    setChatId(c.id!)
    setYear(null)
    setView('dashboard')
    setFocus(null)
    setStoryOpen(mode === 'story')
  }

  /** From Find / Ask: open the reader on one message (in whichever chat it's from). */
  const openMessage = useCallback((cid: number, msgId: number) => {
    if (cid !== chatId) { setChatId(cid); setYear(null) }
    setFocus({ id: msgId, n: Date.now() })
    setView('reader')
  }, [chatId])

  /** From the dashboard's Dig deeper: open Ask with a question already sent. */
  const askAbout = useCallback((q: string) => { setAskFor({ q, n: Date.now() }); setView('ask') }, [])

  const posterModel = useCallback(
    (hide: boolean) => buildStory(colored!, stats!, { hideNames: hide, year }),
    [colored, stats, year],
  )

  // mark the story as watched once it's closed, so the sidebar ring goes subdued
  const closeStory = useCallback(() => {
    if (chatId != null) db.chats.update(chatId, { storySeen: Date.now() })
    setStoryOpen(false)
  }, [chatId])

  // chats imported by an older pipeline: fix them in place (e.g. repeated export blocks)
  useEffect(() => {
    if (chat?.id != null && chat.status !== 'processing' && (chat.dataV ?? 0) < DATA_VERSION) repairChat(chat.id)
  }, [chat?.id, chat?.status, chat?.dataV])

  // chats imported before "who is you" detection: fill it in from the title / saved name
  useEffect(() => {
    if (!chat || chat.you || chat.status === 'processing') return
    const who = guessYou(chat)
    if (who.you) db.chats.update(chat.id!, { you: who.you, youSource: who.source ?? undefined })
  }, [chat])

  // drop a .zip / .txt anywhere to import it
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true) } }
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false) }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])].filter(f => /\.(zip|txt)$/i.test(f.name))
      ;(async () => {
        for (const f of files) {
          try { await importExport(f) } catch (err) { alert(err instanceof Error ? err.message : String(err)) }
        }
      })()
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const tabs: { id: View; label: string; Icon: typeof Sparkle }[] = [
    { id: 'dashboard', label: 'Rewind', Icon: Sparkle },
    { id: 'reader', label: 'Chat', Icon: ChatCircle },
    { id: 'find', label: 'Find', Icon: MagnifyingGlass },
    { id: 'ask', label: 'Ask', Icon: Question },
  ]

  return (
    <div className="h-dvh flex overflow-hidden">
      <Sidebar selected={chatId} onSelect={openChat} className={chat ? 'hidden md:flex' : 'flex'} inert={storyOpen} />

      <main inert={storyOpen} className={`${chat ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
        {!chat && <AllChats onOpen={openChat} />}
        {chat && (
          <>
            <header className="h-[60px] shrink-0 flex items-center gap-2 sm:gap-3 pl-1 pr-2 sm:px-4 bg-panel border-b border-stroke pt-[env(safe-area-inset-top)] box-content">
              <button onClick={() => setChatId(null)} aria-label="Back to chats"
                className="md:hidden grid place-items-center size-10 rounded-full text-ink-2 hover:text-ink">
                <ArrowLeft size={22} />
              </button>
              <div className="size-10 shrink-0 rounded-full grid place-items-center bg-wa text-app font-bold">
                {chat.isGroup ? <UsersThree size={20} weight="fill" /> : initials(chat.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{chat.name}</div>
                <div className="text-[12px] text-ink-2 truncate">
                  {chat.isGroup ? `${chat.participants.length} participants` : chat.participants.join(', ')}
                </div>
              </div>
              <div className="hidden md:flex rounded-lg overflow-hidden border border-stroke text-[13px]">
                {tabs.map(({ id, label, Icon }) => (
                  <button key={id} onClick={() => setView(id)}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 transition-colors ${view === id ? 'bg-wa text-app font-semibold' : 'bg-panel hover:bg-panel-2 text-ink-2'}`}>
                    <Icon size={15} weight={view === id ? 'fill' : 'regular'} /> {label}
                  </button>
                ))}
              </div>
              {stats && stats.totalMessages > 0 && (
                <div className="md:hidden">
                  <ShareButton variant="icon" chat={colored!} stats={stats} year={year} />
                </div>
              )}
              {allTime && (
                <button onClick={() => setPeopleOpen(true)} title="People & colors" aria-label="People and colors"
                  className="grid place-items-center size-10 rounded-full text-ink-2 hover:text-wa-bright hover:bg-panel-2 transition-colors">
                  <UserGear size={20} />
                </button>
              )}
              <button onClick={() => setStoryOpen(true)} disabled={!model} title="Play the Rewind" aria-label="Play the Rewind"
                className="grid place-items-center size-10 rounded-full text-ink-2 hover:text-wa-bright hover:bg-panel-2 transition-colors disabled:opacity-40">
                <Play size={19} weight="fill" />
              </button>
            </header>

            {/* phone tabs, WhatsApp-style underline */}
            <nav className="md:hidden flex bg-panel border-b border-stroke" role="tablist">
              {tabs.map(({ id, label }) => (
                <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
                  className={`relative flex-1 py-2.5 text-[14px] font-medium transition-colors ${view === id ? 'text-wa-bright' : 'text-ink-2'}`}>
                  {label}
                  {view === id && <span className="absolute inset-x-6 bottom-0 h-[3px] rounded-t-full bg-wa-bright" />}
                </button>
              ))}
            </nav>

            {view === 'dashboard' && (stats
              ? <Dashboard chat={colored!} stats={stats} year={year} years={years} onYear={setYear} onPlay={() => setStoryOpen(true)}
                onOpenMessage={id => openMessage(chat.id!, id)} onAsk={askAbout} />
              : <div className="flex-1 grid place-items-center bg-chatbg text-ink-3 text-sm animate-pulse">Crunching {year ?? 'all-time'} stats…</div>)}
            {view === 'reader' && <Reader key={chat.id} chat={chat} focus={focus} />}
            {view === 'find' && <Find key={chat.id} chat={chat} onOpen={openMessage} />}
            {view === 'ask' && <AskPanel key={chat.id} chat={chat} onOpen={openMessage} initial={askFor} onInitialUsed={() => setAskFor(null)} />}

          </>
        )}
      </main>

      {storyOpen && model && chat && (
        <Story
          model={model}
          onClose={closeStory}
          renderShare={(_i, onOpenChange) => <ShareButton variant="icon" chat={colored!} stats={stats!} year={year} onOpenChange={onOpenChange} />}
          outro={{ label: 'Open the full dashboard', onClick: closeStory }}
          posters={{ getModel: posterModel, canHide: true }}
        />
      )}

      {peopleOpen && chat && allTime && <PeopleSheet chat={chat} stats={allTime} onClose={() => setPeopleOpen(false)} />}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-app/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-wa px-14 py-12 text-center">
            <DownloadSimple size={40} className="text-wa-bright" />
            <div className="text-lg font-semibold">Drop to import</div>
            <div className="text-[13px] text-ink-2">.zip or .txt chat exports</div>
          </div>
        </div>
      )}
    </div>
  )
}

export function EmptyState() {
  return (
    <div className="flex-1 grid place-items-center chat-wallpaper">
      <div className="text-center max-w-md px-8">
        <div className="mx-auto mb-6 size-28 rounded-full bg-wa/10 grid place-items-center glow-green">
          <Fx name="speech" size={72} className="float-soft" glow />
        </div>
        <h2 className="text-2xl font-bold tracking-tight mb-2">Your chats, <span className="text-wa-bright">rewound</span></h2>
        <p className="text-ink-2 text-[14px] leading-relaxed">
          Import a WhatsApp export (<b>.zip</b> or <b>.txt</b>) from the sidebar, or drop it anywhere on this page.
          Everything stays on this device. Messages, media and stats live in your browser's local storage, and it works offline.
        </p>
        <p className="text-ink-3 text-[12.5px] mt-4">
          On your phone: <i>Chat → ⋮ → More → Export chat → Attach media</i>
        </p>
      </div>
    </div>
  )
}
