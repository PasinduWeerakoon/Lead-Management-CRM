export type Effort = 'low' | 'medium' | 'high'
export type Provider = 'anthropic' | 'openai' | 'gemini' | 'groq' | 'openrouter'

export interface ProviderInfo {
  id: Provider
  label: string
  /** Where requests go (also allowed in the CSP). */
  host: string
  /** OpenAI-compatible chat completions base URL (every provider except Anthropic). */
  baseUrl?: string
  keyPattern: RegExp
  keyPlaceholder: string
  keyHelp: string
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    host: 'api.anthropic.com',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    keyPlaceholder: 'sk-ant-…',
    keyHelp: 'Create one in the Anthropic Console under API keys. Tip: use a dedicated key with a spend limit.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT)',
    host: 'api.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
    keyPlaceholder: 'sk-…',
    keyHelp: 'Create one at platform.openai.com → API keys. Tip: use a project key with a budget limit.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google (Gemini)',
    host: 'generativelanguage.googleapis.com',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyPattern: /^[A-Za-z0-9_-]{30,}$/,
    keyPlaceholder: 'AIza…',
    keyHelp: 'Create one in Google AI Studio → Get API key.',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    host: 'api.groq.com',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyPattern: /^gsk_[A-Za-z0-9]{20,}$/,
    keyPlaceholder: 'gsk_…',
    keyHelp: 'Create one in the Groq console under API Keys.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (any model)',
    host: 'openrouter.ai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyPattern: /^sk-or-[A-Za-z0-9_-]{20,}$/,
    keyPlaceholder: 'sk-or-…',
    keyHelp:
      'One key for hundreds of models (Claude, GPT, Gemini, Llama, DeepSeek…). Create one at openrouter.ai → Keys.',
  },
}

export interface AiModel {
  id: string
  provider: Provider
  label: string
  blurb: string
  /** USD per million tokens (provider list prices; Anthropic for prompts under 100K tokens). */
  inputPerM: number
  outputPerM: number
  /** Accepts a low / medium / high reasoning-effort setting. */
  effort: boolean
  /** Largest answer the model can return, in tokens. */
  maxOutput: number
  /** Anthropic server-side refusal fallback (`fallbacks: "default"`) is available. */
  serverFallback: boolean
  /** False for models added by ID whose price the app doesn't know (cost shows as unknown). */
  priceKnown?: boolean
  /** Added by you (by ID or from the provider's model list), not built in. */
  custom?: boolean
  /** The price shown is one you set. */
  priceSet?: boolean
}

export const AI_MODELS: AiModel[] = [
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    label: 'Claude Opus 5.5',
    blurb: 'Best judgement. Recommended on Anthropic.',
    inputPerM: 4,
    outputPerM: 20,
    effort: true,
    maxOutput: 128_000,
    serverFallback: true,
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    blurb: 'Fast and capable, half the price.',
    inputPerM: 2,
    outputPerM: 10,
    effort: true,
    maxOutput: 128_000,
    serverFallback: true,
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5.5',
    blurb: 'Cheapest Claude. Good for simple requests.',
    inputPerM: 0.1,
    outputPerM: 0.5,
    effort: true,
    maxOutput: 128_000,
    serverFallback: false,
  },
  // OpenAI and Gemini list prices (official pricing pages, Oct 2026). Gemini Flash prices double on 1 Jan 2027.
  {
    id: 'gpt-6.1-sol',
    provider: 'openai',
    label: 'GPT-6.1 Sol',
    blurb: 'Balanced quality and price. Recommended on OpenAI.',
    inputPerM: 2,
    outputPerM: 10,
    effort: true,
    maxOutput: 64_000,
    serverFallback: false,
  },
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna',
    blurb: 'Cheapest current GPT. Fine for filters and first-pass scoring.',
    inputPerM: 0.1,
    outputPerM: 0.5,
    effort: true,
    maxOutput: 64_000,
    serverFallback: false,
  },
  {
    id: 'gpt-6-astra',
    provider: 'openai',
    label: 'GPT-6 Astra',
    blurb: 'Most capable GPT; expensive for large lists.',
    inputPerM: 10,
    outputPerM: 50,
    effort: true,
    maxOutput: 64_000,
    serverFallback: false,
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash',
    blurb: 'Fast and capable. Recommended on Gemini.',
    inputPerM: 0.75,
    outputPerM: 3.75,
    effort: true,
    maxOutput: 64_000,
    serverFallback: false,
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash-Lite',
    blurb: 'Low cost for big lists.',
    inputPerM: 0.25,
    outputPerM: 1.5,
    effort: true,
    maxOutput: 64_000,
    serverFallback: false,
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash-Lite',
    blurb: 'Cheapest Gemini.',
    inputPerM: 0.1,
    outputPerM: 0.4,
    effort: true,
    maxOutput: 64_000,
    serverFallback: false,
  },
  {
    id: 'gemini-4-argon',
    provider: 'gemini',
    label: 'Gemini 4 Argon',
    blurb: 'Most capable Gemini.',
    inputPerM: 2,
    outputPerM: 10,
    effort: true,
    maxOutput: 64_000,
    serverFallback: false,
  },
  {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    label: 'GPT-OSS 120B',
    blurb: 'Strong reasoning at a very low price. Recommended on Groq.',
    inputPerM: 0.15,
    outputPerM: 0.6,
    effort: true,
    maxOutput: 65_536,
    serverFallback: false,
  },
  {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    label: 'GPT-OSS 20B',
    blurb: 'Fastest and cheapest. Fine for describe-to-filter.',
    inputPerM: 0.075,
    outputPerM: 0.3,
    effort: true,
    maxOutput: 65_536,
    serverFallback: false,
  },
  {
    id: 'qwen/qwen3.8-27b',
    provider: 'groq',
    label: 'Qwen 3.8 27B',
    blurb: 'Alternative model family; higher price on Groq.',
    inputPerM: 0.8,
    outputPerM: 4,
    effort: false,
    maxOutput: 16_384,
    serverFallback: false,
  },
  {
    // OpenRouter ids are prefixed here so they never clash with the same model on another provider.
    id: 'openrouter/openai/gpt-oss-120b',
    provider: 'openrouter',
    label: 'GPT-OSS 120B (via OpenRouter)',
    blurb: 'A low-cost starting point. Use “Load all models” for live prices and every other model.',
    inputPerM: 0,
    outputPerM: 0,
    effort: true,
    maxOutput: 32_000,
    serverFallback: false,
    priceKnown: false,
  },
]

export const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-6.1-sol',
  gemini: 'gemini-3.8-flash',
  groq: 'openai/gpt-oss-120b',
  openrouter: 'openrouter/openai/gpt-oss-120b',
}

export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.anthropic

// --- models you add ---------------------------------------------------------------------------

/** Models added by ID or from a provider's list. Kept with the AI settings; registered on load. */
export interface CustomModel {
  id: string
  provider: Provider
  label?: string
  /** USD per million tokens, when known (OpenRouter publishes prices). */
  inputPerM?: number
  outputPerM?: number
}

let customModels: AiModel[] = []

export function toAiModel(c: CustomModel): AiModel {
  const priced = c.inputPerM !== undefined && c.outputPerM !== undefined
  return {
    id: c.id,
    provider: c.provider,
    label: c.label || c.id,
    blurb: priced ? 'Added by you.' : 'Added by you — price unknown, so costs show as unknown.',
    inputPerM: c.inputPerM ?? 0,
    outputPerM: c.outputPerM ?? 0,
    // Sent when supported; retried without it if the model rejects it.
    effort: true,
    maxOutput: 16_000,
    serverFallback: false,
    priceKnown: priced,
    custom: true,
  }
}

export function registerCustomModels(list: CustomModel[] = []) {
  customModels = list.filter((c) => !AI_MODELS.some((m) => m.id === c.id && m.provider === c.provider)).map(toAiModel)
}

/** Prices you set, per model id (USD per million tokens). They replace the built-in or unknown price. */
export type PriceOverrides = Record<string, { inputPerM: number; outputPerM: number }>
let priceOverrides: PriceOverrides = {}

export function registerPriceOverrides(map: PriceOverrides = {}) {
  priceOverrides = map
}

const withPrice = (m: AiModel): AiModel => {
  const p = priceOverrides[m.id]
  return p ? { ...m, inputPerM: p.inputPerM, outputPerM: p.outputPerM, priceKnown: true, priceSet: true } : m
}

const allModels = () => [...AI_MODELS, ...customModels].map(withPrice)

export const modelsFor = (provider: Provider) => allModels().filter((m) => m.provider === provider)

/** Built-in or custom model; unknown ids fall back to the first built-in model. */
export const modelById = (id: string) => allModels().find((m) => m.id === id) ?? AI_MODELS[0]

/** The id the provider's API expects (OpenRouter ids are stored with an "openrouter/" prefix). */
export const apiModelId = (m: Pick<AiModel, 'id' | 'provider'>) =>
  m.provider === 'openrouter' ? m.id.replace(/^openrouter\//, '') : m.id

/** The id stored for a model a provider's API calls `apiId`. */
export const storedModelId = (provider: Provider, apiId: string) =>
  provider === 'openrouter' ? `openrouter/${apiId}` : apiId

/** Whether this exact model id is known (built in or added). */
export const hasModel = (id: string) => allModels().some((m) => m.id === id)

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** Cost of one response. Cache writes bill at 1.25× input, cache reads at 0.1×. */
export function costUsd(modelId: string, u: TokenUsage): number {
  const m = modelById(modelId)
  const input =
    u.input_tokens * m.inputPerM +
    (u.cache_creation_input_tokens ?? 0) * m.inputPerM * 1.25 +
    (u.cache_read_input_tokens ?? 0) * m.inputPerM * 0.1
  return (input + u.output_tokens * m.outputPerM) / 1_000_000
}

/** Cost text for estimates: "unknown" when the model's price isn't known. */
export const priceKnown = (modelId: string) => modelById(modelId).priceKnown !== false

/** Price per million tokens, short: "$2", "$0.15", "$0.0004". */
export function perM(n: number) {
  if (n === 0) return '$0'
  return `$${n >= 1 ? +n.toFixed(2) : n >= 0.01 ? +n.toFixed(3) : +n.toPrecision(2)}`
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}
