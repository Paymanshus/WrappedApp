import type Anthropic from '@anthropic-ai/sdk'
import { PROVIDERS, baseUrl, type AskConfig, type ModelRef, type ProviderId } from './providers'

// One turn of a tool-using conversation, provider-neutral. The agent loop (run.ts) speaks AMsg;
// each driver translates to its wire format, streams text back, and returns the tool calls.

export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; input: unknown; bad?: string }
export interface ToolResult { id: string; name: string; content: string; isError?: boolean }

export type AMsg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: ToolCall[]; native?: unknown }   // native: provider's own content (Claude's thinking blocks must go back verbatim)
  | { role: 'tool'; results: ToolResult[] }

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Turn { text: string; calls: ToolCall[]; stop: 'end' | 'tools' | 'length' | 'refusal'; usage: Usage; native?: unknown }

export interface TurnArgs {
  system: string
  messages: AMsg[]
  tools: ToolSpec[]
  maxTokens: number
  onText: (t: string) => void
  signal: AbortSignal
}

export interface Driver { ref: ModelRef; turn(a: TurnArgs): Promise<Turn> }

/** A readable error for the UI, from any provider's failure. */
export class AskError extends Error {
  hint?: string
  constructor(message: string, hint?: string) { super(message); this.hint = hint }
}

export function makeDriver(ref: ModelRef, config: AskConfig, key: string | undefined): Driver {
  if (PROVIDERS[ref.provider].needsKey && !key) throw new AskError(`Add your ${PROVIDERS[ref.provider].label} key in Ask settings.`)
  if (ref.provider === 'anthropic') return anthropicDriver(ref, key!)
  if (ref.provider === 'ollama') return ollamaDriver(ref, ollamaRoot(baseUrl(config, 'ollama')), !!config.localThink)
  return openAIDriver(ref, baseUrl(config, ref.provider), key)
}

/** Ollama's own API lives at the server root; accept a pasted ".../v1" too. */
const ollamaRoot = (base: string) => base.replace(/\/v1$/, '')

// ---------- Anthropic (official SDK, loaded on first use) ----------

let sdk: Promise<typeof import('@anthropic-ai/sdk')> | null = null
const loadSdk = () => (sdk ??= import('@anthropic-ai/sdk'))

function anthropicDriver(ref: ModelRef, key: string): Driver {
  return {
    ref,
    async turn({ system, messages, tools, maxTokens, onText, signal }) {
      const { default: AnthropicSDK } = await loadSdk()
      const client = new AnthropicSDK({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 })
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: ref.model,
        max_tokens: maxTokens,
        system,
        // tools and system never change within a chat, so automatic caching reuses the whole prefix
        cache_control: { type: 'ephemeral' },
        messages: toAnthropic(messages),
      }
      if (tools.length) params.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema, eager_input_streaming: true }))
      // eager input streaming hands back tool inputs as they're generated; if one can't be parsed,
      // finalMessage() rejects with a non-API error — re-issue the turn (twice at most)
      for (let attempt = 0; ; attempt++) {
        try {
          const stream = client.messages.stream(params, { signal })
          stream.on('text', onText)
          const msg = await stream.finalMessage()
          const calls: ToolCall[] = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input }))
          const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
          const u = msg.usage
          return {
            text, calls, native: msg.content,
            stop: msg.stop_reason === 'tool_use' ? 'tools' : msg.stop_reason === 'max_tokens' ? 'length' : msg.stop_reason === 'refusal' ? 'refusal' : 'end',
            usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
          }
        } catch (e) {
          if (signal.aborted) throw e
          if (e instanceof AnthropicSDK.APIError) throw anthropicError(e)
          if (attempt >= 2) throw e
        }
      }
    },
  }
}

function anthropicError(e: { status?: number; message: string }) {
  if (e.status === 401) return new AskError('Claude rejected the API key.', 'Check the key in Ask settings.')
  if (e.status === 404) return new AskError('That Claude model isn\'t available to this key.', 'Pick another model in Ask settings.')
  if (e.status === 429) return new AskError('Claude rate limit reached.', 'Wait a minute and ask again.')
  if (e.status === 529 || e.status === 503) return new AskError('Claude is overloaded right now.', 'Try again shortly.')
  if (e.status === 400 && /credit/i.test(e.message)) return new AskError('Your Anthropic account is out of credit.')
  return new AskError(`Claude error${e.status ? ` ${e.status}` : ''}: ${e.message}`)
}

function toAnthropic(messages: AMsg[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === 'user') return { role: 'user', content: m.text }
    if (m.role === 'tool') return { role: 'user', content: m.results.map(r => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, is_error: r.isError })) }
    if (m.native) return { role: 'assistant', content: m.native as Anthropic.ContentBlockParam[] }
    const content: Anthropic.ContentBlockParam[] = []
    if (m.text) content.push({ type: 'text', text: m.text })
    for (const c of m.calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input ?? {} })
    return { role: 'assistant', content }
  })
}

// ---------- OpenAI-compatible (OpenAI, Gemini, OpenRouter, Ollama, LM Studio…) ----------

function headers(provider: ProviderId, key?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) h.Authorization = `Bearer ${key}`
  if (provider === 'openrouter') { h['HTTP-Referer'] = location.origin; h['X-Title'] = 'WrappedApp' }
  return h
}

type OAIMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

function toOpenAI(system: string, messages: AMsg[]): OAIMsg[] {
  const out: OAIMsg[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text })
    else if (m.role === 'tool') for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content })
    else out.push({
      role: 'assistant', content: m.text || null,
      ...(m.calls.length ? { tool_calls: m.calls.map(c => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
    })
  }
  return out
}

/** Hides <think>…</think> reasoning that some local models put inline in the answer stream. */
function thinkFilter(emit: (t: string) => void) {
  let inThink = false, buf = ''
  return {
    push(chunk: string) {
      buf += chunk
      for (;;) {
        if (inThink) {
          const end = buf.indexOf('</think>')
          if (end < 0) { buf = buf.slice(-8); return }
          buf = buf.slice(end + 8); inThink = false
        } else {
          const start = buf.indexOf('<think>')
          if (start < 0) {
            const keep = buf.lastIndexOf('<') > buf.length - 8 ? buf.slice(buf.lastIndexOf('<')) : ''
            const out = buf.slice(0, buf.length - keep.length)
            if (out) emit(out)
            buf = keep
            return
          }
          if (start) emit(buf.slice(0, start))
          buf = buf.slice(start + 7); inThink = true
        }
      }
    },
    flush() { if (!inThink && buf) emit(buf); buf = '' },
  }
}

function openAIDriver(ref: ModelRef, base: string, key?: string): Driver {
  const label = PROVIDERS[ref.provider].label
  return {
    ref,
    async turn({ system, messages, tools, onText, signal }) {
      const body: Record<string, unknown> = {
        model: ref.model,
        messages: toOpenAI(system, messages),
        stream: true,
      }
      // some providers reject an empty tools list, so plain completions send none
      if (tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
      if (ref.provider === 'openai' || ref.provider === 'openrouter' || ref.provider === 'ollama') body.stream_options = { include_usage: true }
      let res: Response
      try {
        res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: headers(ref.provider, key), body: JSON.stringify(body), signal })
      } catch (e) {
        if (signal.aborted) throw e
        throw unreachable(ref.provider, base)
      }
      if (!res.ok) throw await httpError(res, label)

      let text = ''
      const calls = new Map<number, { id: string; name: string; args: string }>()
      let finish = '', usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      const filter = thinkFilter(t => { text += t; onText(t) })
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          let chunk: {
            choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
            usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
            error?: { message?: string }
          }
          try { chunk = JSON.parse(data) } catch { continue }
          if (chunk.error) throw new AskError(`${label}: ${chunk.error.message ?? 'error'}`)
          const ch = chunk.choices?.[0]
          if (ch?.delta?.content) filter.push(ch.delta.content)
          for (const tc of ch?.delta?.tool_calls ?? []) {
            const i = tc.index ?? calls.size
            const cur = calls.get(i) ?? { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name += tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            calls.set(i, cur)
          }
          if (ch?.finish_reason) finish = ch.finish_reason
          if (chunk.usage) usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0, cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0 }
        }
      }
      filter.flush()
      const out: ToolCall[] = [...calls.values()].filter(c => c.name).map((c, k) => {
        try { return { id: c.id || `call_${k}_${Date.now()}`, name: c.name, input: c.args ? JSON.parse(c.args) : {} } }
        catch { return { id: c.id || `call_${k}_${Date.now()}`, name: c.name, input: {}, bad: c.args } }
      })
      return {
        text, calls: out,
        stop: out.length ? 'tools' : finish === 'length' ? 'length' : finish === 'content_filter' ? 'refusal' : 'end',
        usage,
      }
    },
  }
}

function unreachable(provider: ProviderId, base: string) {
  if (provider === 'ollama') return new AskError(`Can't reach Ollama at ${base}.`, `Make sure Ollama is running. If it is, allow this site: OLLAMA_ORIGINS="${location.origin}" ollama serve`)
  if (provider === 'custom') return new AskError(`Can't reach ${base}.`, 'Is the server running, with CORS enabled for this site?')
  return new AskError(`Can't reach ${PROVIDERS[provider].label}.`, 'Check your connection.')
}

async function httpError(res: Response, label: string) {
  let msg = ''
  try {
    const raw = await res.json()
    const j = Array.isArray(raw) ? raw[0] : raw          // Gemini wraps errors in an array
    msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || j?.message || ''
  } catch { /* not json */ }
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _-]?key/i.test(msg))) return new AskError(`${label} rejected the API key.`, 'Check the key in Ask settings.')
  if (res.status === 404) return new AskError(`${label} doesn't know that model.`, msg || 'Pick another model in Ask settings.')
  if (res.status === 429) return new AskError(`${label} rate limit or quota reached.`, msg || 'Wait a minute and ask again.')
  if (res.status === 400 && /tool|function/i.test(msg)) return new AskError(`This ${label} model can't use tools.`, 'Ask needs a model with tool calling. Pick another one.')
  return new AskError(`${label} error ${res.status}${msg ? `: ${msg}` : ''}`)
}

// ---------- Ollama (native API: lets us size the context window) ----------

/**
 * Ollama gives every conversation a 4,096-token window unless asked, and silently drops the
 * oldest half when it overflows ("context shift"): a few searches plus a thinking model's
 * reasoning blow through that. Its native /api/chat takes num_ctx (the OpenAI-compatible
 * endpoint can't), so we ask for 16k — roughly 2 GB of memory for a 4B model.
 */
const OLLAMA_CTX = 16384

type OllamaMsg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: { function: { name: string; arguments: unknown } }[] }
  | { role: 'tool'; content: string; tool_name: string }

function ollamaDriver(ref: ModelRef, root: string, think: boolean): Driver {
  return {
    ref,
    async turn({ system, messages, tools, onText, signal }) {
      const msgs: OllamaMsg[] = [{ role: 'system', content: system }]
      for (const m of messages) {
        if (m.role === 'user') msgs.push({ role: 'user', content: m.text })
        else if (m.role === 'tool') for (const r of m.results) msgs.push({ role: 'tool', content: r.content, tool_name: r.name })
        else msgs.push({ role: 'assistant', content: m.text, ...(m.calls.length ? { tool_calls: m.calls.map(c => ({ function: { name: c.name, arguments: c.input ?? {} } })) } : {}) })
      }
      // think:false skips the hidden reasoning pass on hybrid models (Qwen 3.5, Qwen3 8B…); models
      // that always reason (qwen3:4b's 2507 build, deepseek-r1) ignore it — the UI flags those
      // keep_alive: stay loaded between questions (Ollama unloads after 5 idle min; a reload costs ~15 s)
      const body: Record<string, unknown> = { model: ref.model, messages: msgs, stream: true, think, keep_alive: '30m', options: { num_ctx: OLLAMA_CTX } }
      if (tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
      let res: Response
      try {
        res = await fetch(`${root}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
      } catch (e) {
        if (signal.aborted) throw e
        throw unreachable('ollama', root)
      }
      if (!res.ok) {
        let msg = ''
        try { msg = (await res.json())?.error ?? '' } catch { /* not json */ }
        if (res.status === 404) throw new AskError(`Ollama doesn't have ${ref.model}.`, `Download it with: ollama pull ${ref.model}`)
        if (/does not support tools/i.test(msg)) throw new AskError(`${ref.model} can't use tools.`, 'Ask needs a model with tool calling, e.g. qwen3:4b-instruct.')
        throw new AskError(`Ollama error ${res.status}${msg ? `: ${msg}` : ''}`)
      }
      let text = '', done = '', usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      const calls: ToolCall[] = []
      const filter = thinkFilter(t => { text += t; onText(t) })
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done: end } = await reader.read()
        if (end) break
        buf += value
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const lineStr = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!lineStr) continue
          let c: { message?: { content?: string; tool_calls?: { id?: string; function: { name: string; arguments: unknown } }[] }; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number; error?: string }
          try { c = JSON.parse(lineStr) } catch { continue }
          if (c.error) throw new AskError(`Ollama: ${c.error}`)
          if (c.message?.content) filter.push(c.message.content)
          for (const tc of c.message?.tool_calls ?? []) calls.push({ id: tc.id || `call_${calls.length}_${Date.now()}`, name: tc.function.name, input: tc.function.arguments ?? {} })
          if (c.done) { done = c.done_reason ?? 'stop'; usage = { input: c.prompt_eval_count ?? 0, output: c.eval_count ?? 0, cacheRead: 0, cacheWrite: 0 } }
        }
      }
      filter.flush()
      return { text, calls, usage, stop: calls.length ? 'tools' : done === 'length' ? 'length' : 'end' }
    },
  }
}

/** Models that reason before every reply (slow on a laptop); the UI suggests a faster variant. */
export const isThinkingModel = (model: string) => /^qwen3:(4b|30b|235b)?$|^qwen3:4b-thinking|thinking|deepseek-r1|qwq|magistral/i.test(model)

// ---------- model lists ----------

/** Live model list for a provider (tool-capable ones first where the provider says). */
export async function listModels(provider: ProviderId, config: AskConfig, key?: string, signal?: AbortSignal): Promise<string[]> {
  if (provider === 'anthropic') {
    if (!key) return PROVIDERS.anthropic.suggested
    const { default: AnthropicSDK } = await loadSdk()
    const client = new AnthropicSDK({ apiKey: key, dangerouslyAllowBrowser: true })
    const out: string[] = []
    try {
      for await (const m of client.models.list({ limit: 100 }, { signal })) out.push(m.id)
    } catch (e) {
      if (e instanceof AnthropicSDK.APIError) throw anthropicError(e)
      throw unreachable('anthropic', PROVIDERS.anthropic.base)
    }
    return out
  }
  if (provider === 'ollama') {
    const root = ollamaRoot(baseUrl(config, 'ollama'))
    let r: Response
    try { r = await fetch(`${root}/api/tags`, { signal }) } catch (e) {
      if (signal?.aborted) throw e
      throw unreachable('ollama', root)
    }
    if (!r.ok) throw new AskError(`Ollama error ${r.status}`)
    const j: { models?: { name: string }[] } = await r.json()
    return (j.models ?? []).map(m => m.name).filter(n => !/embed/i.test(n)).sort()
  }
  const base = baseUrl(config, provider)
  let res: Response
  // OpenRouter's model list is public, so check the key itself first
  if (provider === 'openrouter' && key) {
    const r = await fetch(`${base}/key`, { headers: headers(provider, key), signal }).catch(() => null)
    if (r && !r.ok) throw await httpError(r, PROVIDERS.openrouter.label)
  }
  try { res = await fetch(`${base}/models`, { headers: headers(provider, key), signal }) } catch (e) {
    if (signal?.aborted) throw e
    throw unreachable(provider, base)
  }
  if (!res.ok) throw await httpError(res, PROVIDERS[provider].label)
  const j: { data?: { id: string; supported_parameters?: string[] }[]; models?: { name?: string; id?: string }[] } = await res.json()
  const rows: { id: string; supported_parameters?: string[] }[] = j.data ?? j.models?.map(m => ({ id: m.id ?? m.name ?? '' })) ?? []
  return rows
    .filter(m => m.id && (!m.supported_parameters || m.supported_parameters.includes('tools')))
    .map(m => m.id.replace(/^models\//, ''))
    .filter(id => !/embed|tts|whisper|dall-e|image|audio|moderation|realtime|transcribe/i.test(id))
    .sort()
}
