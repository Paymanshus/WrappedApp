import { useEffect, useRef, useState } from 'react'
import { CaretDown, X } from '@phosphor-icons/react'

/** A filter pill that opens a panel: a dropdown on desktop, a bottom sheet on phones. */
export function FilterChip({ label, icon, active, onClear, children, align = 'left', wide = false }: {
  label: string
  icon?: React.ReactNode
  active: boolean
  onClear?: () => void
  children: (close: () => void) => React.ReactNode
  align?: 'left' | 'right'
  wide?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key) }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <div className={`inline-flex items-center rounded-full border text-[13px] transition-colors ${active ? 'bg-wa/15 border-wa/60 text-ink' : 'border-stroke text-ink-2 hover:text-ink hover:border-ink-3'}`}>
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog"
          className={`inline-flex items-center gap-1.5 py-1.5 ${active && onClear ? 'pl-3 pr-1' : 'px-3'} max-w-[14rem]`}>
          {icon}<span className="truncate">{label}</span>{!(active && onClear) && <CaretDown size={12} weight="bold" className="shrink-0 opacity-70" />}
        </button>
        {active && onClear && (
          <button onClick={onClear} aria-label={`Clear ${label}`} className="grid place-items-center size-6 mr-1 rounded-full hover:bg-white/10"><X size={12} weight="bold" /></button>
        )}
      </div>
      {open && (
        <>
          <div className="a-fade md:hidden fixed inset-0 z-40 bg-black/60" onPointerDown={() => setOpen(false)} />
          <div role="dialog" aria-label={label}
            className={`a-sheet z-50 bg-panel border border-stroke shadow-2xl shadow-black/50 overflow-y-auto
              max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[75dvh] max-md:rounded-t-3xl max-md:p-5 max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))]
              md:absolute md:top-full md:mt-2 md:max-h-[min(70dvh,560px)] md:rounded-2xl md:p-4 ${wide ? 'md:w-[360px]' : 'md:w-[290px]'} ${align === 'right' ? 'md:right-0' : 'md:left-0'}`}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-panel-2 md:hidden" />
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  )
}

/** Row inside a filter panel: a checkbox or radio styled as a list item. */
export function Option({ on, onClick, children, radio = false, meta }: { on: boolean; onClick: () => void; children: React.ReactNode; radio?: boolean; meta?: React.ReactNode }) {
  return (
    <button role={radio ? 'radio' : 'checkbox'} aria-checked={on} onClick={onClick}
      className="w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left text-[14px] hover:bg-panel-2">
      <span className={`grid place-items-center size-[18px] shrink-0 border-2 ${radio ? 'rounded-full' : 'rounded-[5px]'} ${on ? 'border-wa bg-wa' : 'border-ink-3'}`}>
        {on && (radio ? <span className="size-1.5 rounded-full bg-app" /> : <svg viewBox="0 0 12 12" className="size-3 text-app"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
      </span>
      <span className="flex-1 min-w-0 flex items-center gap-2">{children}</span>
      {meta != null && <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{meta}</span>}
    </button>
  )
}

export function PanelTitle({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-2 first:pt-0 text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">{children}</div>
}
