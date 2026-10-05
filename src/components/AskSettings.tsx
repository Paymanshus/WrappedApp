import { useEffect, useState } from 'react'
import { ArrowClockwise, CheckCircle, Eye, EyeSlash, Laptop, Cloud, WarningCircle, X, ArrowSquareOut } from '@phosphor-icons/react'
import { listModels, AskError, isThinkingModel } from '../lib/agent/drivers'
import { PROVIDERS, PROVIDER_ORDER, type ModelRef, type ProviderId } from '../lib/agent/providers'
import { clearKeys, setKey, updateConfig, useAskSettings } from '../lib/agent/store'

/** Choose a provider + model (+ key / server URL). Lists live models so names never go stale. */
export function ModelPicker({ value, onChange, title, sub }: { value: ModelRef | null; onChange: (r: ModelRef | null) => void; title: string; sub?: string }) {
  const { config, keys } = useAskSettings()
  const [provider, setProvider] = useState<ProviderId>(value?.provider ?? 'ollama')
  const info = PROVIDERS[provider]
  const key = keys[provider] ?? ''
  const [models, setModels] = useState<string[] | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; msg?: string; hint?: string }>({ kind: 'idle' })
  const [showKey, setShowKey] = useState(false)
  const [nonce, setNonce] = useState(0)
  const base = config.baseUrls[provider] ?? ''

  // load the live model list whenever the provider / key / server changes
  useEffect(() => {
    if (info.needsKey && !key) { setModels(null); setStatus({ kind: 'idle' }); return }
    const ac = new AbortController()
    setStatus({ kind: 'loading' })
    const t = setTimeout(() => {
      listModels(provider, config, key || undefined, ac.signal)
        .then(list => {
          setModels(list)
          setStatus({ kind: 'ok', msg: list.length ? `Connected · ${list.length} models` : 'Connected, but no models found' })
          // keep the chosen model if it still exists, else pick a sensible default
          if (!value || value.provider !== provider || !list.includes(value.model)) {
            const pick = info.suggested.find(m => list.includes(m)) ?? list[0]
            if (pick) onChange({ provider, model: pick })
          }
        })
        .catch(e => {
          if (ac.signal.aborted) return
          setModels(null)
          setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e), hint: e instanceof AskError ? e.hint : undefined })
        })
    }, info.needsKey ? 500 : 0)
    return () => { ac.abort(); clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value/onChange are outputs, not inputs, of this effect
  }, [provider, key, base, nonce])

  const options = models ?? info.suggested
  const listId = `models-${title.replace(/\W/g, '')}`

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {value && <span className="text-[12px] text-ink-3 truncate">{PROVIDERS[value.provider].label} · {value.model}</span>}
      </div>
      {sub && <p className="mt-0.5 text-[12.5px] text-ink-2">{sub}</p>}

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label={`${title} provider`}>
        {PROVIDER_ORDER.map(p => {
          const on = provider === p
          return (
            <button key={p} role="radio" aria-checked={on} onClick={() => { setProvider(p); if (value?.provider !== p) onChange(null) }}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${on ? 'border-wa bg-wa/10' : 'border-stroke hover:border-ink-3'}`}>
              <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                {PROVIDERS[p].local ? <Laptop size={14} className="text-wa-bright" /> : <Cloud size={14} className="text-read" />}{PROVIDERS[p].label}
              </div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3 line-clamp-2">{PROVIDERS[p].blurb}</div>
            </button>
          )
        })}
      </div>

      <div className="mt-3 space-y-2.5">
        {info.needsKey && (
          <label className="block text-[12.5px] text-ink-2">
            <span className="flex justify-between">API key {info.keyUrl && <a href={info.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-wa-bright hover:underline">Get a key <ArrowSquareOut size={12} /></a>}</span>
            <span className="relative mt-1 block">
              <input type={showKey ? 'text' : 'password'} value={key} onChange={e => setKey(provider, e.target.value)} placeholder={info.keyHint} autoComplete="off" spellCheck={false}
                className="w-full bg-panel rounded-lg pl-3 pr-10 py-2 text-[13.5px] text-ink font-mono outline-none focus:ring-1 focus:ring-wa" />
              <button type="button" onClick={() => setShowKey(v => !v)} aria-label={showKey ? 'Hide key' : 'Show key'} className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center size-7 text-ink-3 hover:text-ink">
                {showKey ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
        )}
        {(provider === 'ollama' || provider === 'custom') && (
          <label className="block text-[12.5px] text-ink-2">Server
            <input value={base} onChange={e => updateConfig({ baseUrls: { ...config.baseUrls, [provider]: e.target.value.trim() || undefined } })} placeholder={info.base} spellCheck={false}
              className="mt-1 w-full bg-panel rounded-lg px-3 py-2 text-[13.5px] text-ink font-mono outline-none focus:ring-1 focus:ring-wa" />
          </label>
        )}
        <label className="block text-[12.5px] text-ink-2">Model
          <span className="mt-1 flex gap-2">
            <input list={listId} value={value?.provider === provider ? value.model : ''} onChange={e => onChange(e.target.value.trim() ? { provider, model: e.target.value.trim() } : null)}
              placeholder={options[0] ?? 'model name'} spellCheck={false}
              className="flex-1 min-w-0 bg-panel rounded-lg px-3 py-2 text-[13.5px] text-ink font-mono outline-none focus:ring-1 focus:ring-wa" />
            <button type="button" onClick={() => setNonce(n => n + 1)} aria-label="Reload model list" title="Reload model list"
              className="grid place-items-center size-9 shrink-0 rounded-lg border border-stroke text-ink-2 hover:text-ink"><ArrowClockwise size={16} className={status.kind === 'loading' ? 'animate-spin' : ''} /></button>
          </span>
          <datalist id={listId}>{options.map(m => <option key={m} value={m} />)}</datalist>
        </label>
        <div className="min-h-5 text-[12.5px]" aria-live="polite">
          {status.kind === 'loading' && <span className="text-ink-3">Connecting…</span>}
          {status.kind === 'ok' && <span className="inline-flex items-center gap-1.5 text-wa-bright"><CheckCircle size={15} weight="fill" /> {status.msg}</span>}
          {status.kind === 'error' && (
            <span className="flex items-start gap-1.5 text-coral"><WarningCircle size={15} weight="fill" className="mt-px shrink-0" />
              <span>{status.msg}{status.hint && <span className="block text-ink-2 mt-0.5 break-words">{status.hint}</span>}</span>
            </span>
          )}
          {status.kind === 'idle' && info.needsKey && <span className="text-ink-3">Paste a key to load models.</span>}
          {provider === 'ollama' && value?.provider === 'ollama' && isThinkingModel(value.model) && (
            <span className="block mt-1.5 text-ink-2">
              {value.model} always thinks before replying, so each step takes a minute or more on a laptop.{' '}
              {models?.find(m => m.startsWith('qwen3.5'))
                ? <button type="button" onClick={() => onChange({ provider, model: models.find(m => m.startsWith('qwen3.5'))! })} className="text-wa-bright hover:underline">Switch to {models.find(m => m.startsWith('qwen3.5'))}</button>
                : <>Faster and better at tools: <code className="text-ink">ollama pull qwen3.5:9b</code> (6.6 GB; <code className="text-ink">qwen3.5:4b</code> on 8–16 GB machines).</>}
            </span>
          )}
          {provider === 'ollama' && (
            <label className="mt-2 flex items-start gap-2 text-ink-2 cursor-pointer">
              <input type="checkbox" checked={!!config.localThink} onChange={e => updateConfig({ localThink: e.target.checked })} className="mt-0.5 size-4 accent-[#00A884]" />
              <span>Let the model think before answering <span className="text-ink-3">(slower, sometimes better on hard questions)</span></span>
            </label>
          )}
          {provider === 'ollama' && status.kind === 'error' && (
            <span className="block mt-1 text-ink-3">New to Ollama? Install it from ollama.com, then run <code className="text-ink-2">ollama pull qwen3.5:9b</code>.</span>
          )}
        </div>
      </div>
    </section>
  )
}

export function AskSettings({ onClose }: { onClose: () => void }) {
  const { config, keys } = useAskSettings()
  const [useReader, setUseReader] = useState(!!config.reader)
  const cloudAnswer = config.answer && !PROVIDERS[config.answer.provider].local
  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center" role="dialog" aria-modal aria-label="Ask settings">
      <div className="a-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="a-sheet relative w-full md:w-[600px] max-h-[92dvh] overflow-y-auto bg-app border border-stroke rounded-t-3xl md:rounded-3xl p-5 md:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-panel-2 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Ask settings</h2>
            <p className="text-[13px] text-ink-2">Pick the model that answers. Search, counting and reading always run on this device; the model only sees what its searches return.</p>
          </div>
          <button onClick={onClose} autoFocus aria-label="Close" className="grid place-items-center size-9 shrink-0 rounded-full hover:bg-panel text-ink-2"><X size={18} weight="bold" /></button>
        </div>

        <div className="mt-5 space-y-6">
          <ModelPicker title="Answer model" value={config.answer} onChange={answer => updateConfig({ answer })} />

          <section className="rounded-2xl border border-stroke p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={useReader} onChange={e => { setUseReader(e.target.checked); if (!e.target.checked) updateConfig({ reader: null }) }}
                className="mt-1 size-4 accent-[#00A884]" />
              <span>
                <span className="block text-[14px] font-medium">Use a separate reader model</span>
                <span className="block text-[12.5px] text-ink-2">It reads the raw messages and hands the answer model notes. Pick a local model here and a cloud answer model never sees your message text.</span>
              </span>
            </label>
            {useReader && <div className="mt-4"><ModelPicker title="Reader model" sub={cloudAnswer ? 'Tip: Ollama keeps message text on this device.' : undefined} value={config.reader} onChange={reader => updateConfig({ reader })} /></div>}
          </section>

          <section className="text-[12.5px] text-ink-2 space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={config.remember} onChange={e => updateConfig({ remember: e.target.checked })} className="size-4 accent-[#00A884]" />
              Remember API keys on this device (otherwise they're forgotten when you close the tab)
            </label>
            <p className="text-ink-3">Keys stay in this browser and go only to the provider you picked. Usage is billed by the provider to your key.</p>
            {Object.values(keys).some(Boolean) && <button onClick={clearKeys} className="text-coral hover:underline">Forget all keys</button>}
          </section>
        </div>

        <button onClick={onClose} disabled={!config.answer}
          className="mt-6 w-full rounded-full bg-wa hover:bg-wa-bright text-app font-semibold py-3 disabled:opacity-40 transition-colors">
          {config.answer ? 'Done' : 'Pick a model to continue'}
        </button>
      </div>
    </div>
  )
}
