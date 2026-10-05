// Ask's model providers. Two wire formats cover everything: Anthropic's Messages API (via the
// official SDK) and the OpenAI-compatible chat/completions API, which OpenAI, Gemini, OpenRouter,
// Ollama, LM Studio, llama.cpp and vLLM all speak. Keys live only in this browser.

export type ProviderId = 'ollama' | 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom'

export interface ProviderInfo {
  id: ProviderId
  label: string
  blurb: string
  local: boolean          // runs on this device: message text never leaves it
  needsKey: boolean
  base: string            // default API base URL
  keyUrl?: string
  keyHint?: string
  suggested: string[]     // shown before the live model list loads
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  ollama: {
    id: 'ollama', label: 'Ollama', blurb: 'Free and private. Runs on this computer.', local: true, needsKey: false,
    base: 'http://localhost:11434', suggested: ['qwen3.5:9b', 'qwen3.5:4b', 'qwen3.5:2b', 'qwen3:8b', 'llama3.1:8b'],
  },
  anthropic: {
    id: 'anthropic', label: 'Claude', blurb: 'Anthropic API key. Best answers.', local: false, needsKey: true,
    base: 'https://api.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…',
    suggested: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  },
  openai: {
    id: 'openai', label: 'OpenAI', blurb: 'OpenAI API key.', local: false, needsKey: true,
    base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', suggested: [],
  },
  gemini: {
    id: 'gemini', label: 'Gemini', blurb: 'Google AI Studio key.', local: false, needsKey: true,
    base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', suggested: [],
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', blurb: 'One key, hundreds of models.', local: false, needsKey: true,
    base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…', suggested: [],
  },
  custom: {
    id: 'custom', label: 'Local server', blurb: 'LM Studio, llama.cpp, vLLM… any OpenAI-compatible server on localhost.', local: true, needsKey: false,
    base: 'http://localhost:1234/v1', suggested: [],
  },
}
export const PROVIDER_ORDER: ProviderId[] = ['ollama', 'anthropic', 'openai', 'gemini', 'openrouter', 'custom']

export interface ModelRef { provider: ProviderId; model: string }

export interface AskConfig {
  answer: ModelRef | null
  /** Optional second model that reads raw messages and hands the answer model notes instead. */
  reader: ModelRef | null
  baseUrls: Partial<Record<ProviderId, string>>
  remember: boolean       // keep keys after the tab closes
  /** Ollama: let the model reason before replying. Off by default: on a laptop it multiplies the
   *  time per step, and Qwen 3.5's small models call tools more reliably without it. */
  localThink?: boolean
}

const CONF = 'wrappedapp-ask'
const KEYS = 'wrappedapp-ask-keys'

export function loadConfig(): AskConfig {
  try {
    const c = JSON.parse(localStorage.getItem(CONF) ?? 'null')
    if (c) return { answer: null, reader: null, baseUrls: {}, remember: true, ...c }
  } catch { /* fresh */ }
  return { answer: null, reader: null, baseUrls: {}, remember: true }
}

export function saveConfig(c: AskConfig) {
  try { localStorage.setItem(CONF, JSON.stringify(c)) } catch { /* storage off */ }
}

/** Keys: localStorage when "remember" is on, otherwise sessionStorage (gone when the tab closes). */
export function loadKeys(): Partial<Record<ProviderId, string>> {
  try { return JSON.parse(localStorage.getItem(KEYS) ?? sessionStorage.getItem(KEYS) ?? '{}') } catch { return {} }
}

export function saveKeys(keys: Partial<Record<ProviderId, string>>, remember: boolean) {
  try {
    const v = JSON.stringify(keys)
    if (remember) { localStorage.setItem(KEYS, v); sessionStorage.removeItem(KEYS) }
    else { sessionStorage.setItem(KEYS, v); localStorage.removeItem(KEYS) }
  } catch { /* storage off */ }
}

export function forgetKeys() {
  try { localStorage.removeItem(KEYS); sessionStorage.removeItem(KEYS) } catch { /* nothing stored */ }
}

export const baseUrl = (c: AskConfig, p: ProviderId) => (c.baseUrls[p] || PROVIDERS[p].base).replace(/\/+$/, '')

/** USD per million tokens [input, output, cache read] for models we know; others show tokens only. */
const PRICES: [RegExp, [number, number, number]][] = [
  [/claude-fable-5-1/, [10, 50, 0.25]],
  [/claude-opus-5-5/, [4, 20, 0.2]],
  [/claude-opus-5(?!-)/, [5, 25, 0.5]],
  [/claude-sonnet-5/, [2, 10, 0.2]],
  [/claude-haiku-4-5/, [1, 5, 0.1]],
]
export function priceOf(ref: ModelRef): [number, number, number] | null {
  if (ref.provider !== 'anthropic') return null
  return PRICES.find(([re]) => re.test(ref.model))?.[1] ?? null
}

export function describe(ref: ModelRef | null) {
  if (!ref) return 'Not set'
  return `${PROVIDERS[ref.provider].label} · ${ref.model}`
}
