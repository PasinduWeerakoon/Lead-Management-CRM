import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appDb } from '../src/lib/app-db'
import {
  apiModelId,
  hasModel,
  modelById,
  perM,
  priceKnown,
  PROVIDERS,
  registerCustomModels,
  storedModelId,
} from '../src/lib/ai/models'
import { generateFilters, listModels, testKey } from '../src/lib/ai/provider'
import { addCustomModels, loadAiSettings, removeCustomModel, saveAiSettings } from '../src/lib/ai/settings'

const realFetch = globalThis.fetch
let calls: Array<{ url: string; init: RequestInit; body?: Record<string, unknown> }> = []

function mockFetch(respond: (url: string, body?: Record<string, unknown>) => { status: number; body: unknown }) {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ url, init, body })
    const r = respond(url, body)
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as typeof fetch
}

const filterAnswer = {
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          combinator: 'and',
          conditions: [{ field: 'seniority', op: 'any_of', values: ['C-level'], number: null }],
          groups: [],
          explanation: 'C-level people.',
          unsupported: [],
        }),
      },
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
}

const ask = (model: string) =>
  generateFilters({ apiKey: 'sk-test-key-0123456789abcdef', model, effort: 'low', description: 'C-level', packs: [] })

beforeEach(() => {
  calls = []
  registerCustomModels([])
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('OpenAI-compatible providers', () => {
  it('sends each provider to its own endpoint with a bearer key, strict JSON schema and its effort format', async () => {
    mockFetch(() => ({ status: 200, body: filterAnswer }))
    const cases = [
      ['gpt-6.1-sol', 'https://api.openai.com/v1/chat/completions', 'gpt-6.1-sol'],
      [
        'gemini-3.8-flash',
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        'gemini-3.8-flash',
      ],
      ['openai/gpt-oss-120b', 'https://api.groq.com/openai/v1/chat/completions', 'openai/gpt-oss-120b'],
      ['openrouter/openai/gpt-oss-120b', 'https://openrouter.ai/api/v1/chat/completions', 'openai/gpt-oss-120b'],
    ] as const
    for (const [model, url, apiId] of cases) {
      calls = []
      const res = await ask(model)
      expect(res.filter.items).toHaveLength(1)
      expect(calls[0].url).toBe(url)
      expect((calls[0].init.headers as Record<string, string>).Authorization).toMatch(/^Bearer sk-test/)
      expect(calls[0].body?.model).toBe(apiId)
      expect(calls[0].body?.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
      if (model.startsWith('openrouter/')) expect(calls[0].body?.reasoning).toEqual({ effort: 'low' })
      else expect(calls[0].body?.reasoning_effort).toBe('low')
    }
  })

  it('asks again without a reasoning setting when a model rejects it', async () => {
    registerCustomModels([{ id: 'gpt-4.1-mini', provider: 'openai' }])
    mockFetch((_url, body) =>
      body && 'reasoning_effort' in body
        ? { status: 400, body: { error: { message: "Unsupported parameter: 'reasoning_effort'" } } }
        : { status: 200, body: filterAnswer },
    )
    const res = await ask('gpt-4.1-mini')
    expect(res.explanation).toBe('C-level people.')
    expect(calls).toHaveLength(2)
    expect(calls[1].body).not.toHaveProperty('reasoning_effort')
  })

  it('explains provider errors in plain words, never echoing the key', async () => {
    mockFetch(() => ({
      status: 429,
      body: { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } },
    }))
    const quota = await ask('gpt-6-luna').catch((e) => e)
    expect(quota.kind).toBe('limit')
    mockFetch(() => ({ status: 401, body: { error: { message: 'Incorrect API key provided: sk-test-…' } } }))
    const auth = await ask('gemini-3.8-flash').catch((e) => e)
    expect(auth.kind).toBe('auth')
    expect(auth.message).not.toContain('sk-test')
  })

  it('checks a key against the provider’s model list (OpenRouter checks the key itself)', async () => {
    mockFetch((url) =>
      url.endsWith('/key')
        ? { status: 200, body: { data: { label: 'k' } } }
        : { status: 200, body: { data: [{ id: 'models/gemini-3.8-flash' }, { id: 'models/gemini-2.5-flash-lite' }] } },
    )
    await expect(testKey('AIza-test-key-0123456789abcdefghijk', 'gemini-3.8-flash')).resolves.toBeUndefined()
    await expect(testKey('AIza-test-key-0123456789abcdefghijk', 'gemini-4-argon')).rejects.toMatchObject({
      kind: 'model',
    })
    await expect(testKey('sk-or-test-0123456789abcdefghij', 'openrouter/openai/gpt-oss-120b')).resolves.toBeUndefined()
    expect(calls.at(-1)?.url).toBe('https://openrouter.ai/api/v1/key')
  })

  it('loads the provider’s full model list, leaving out non-text models; OpenRouter brings prices', async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        data: [{ id: 'gpt-6-sol' }, { id: 'text-embedding-3-small' }, { id: 'gpt-realtime-2.1' }, { id: 'tts-1' }],
      },
    }))
    expect(await listModels('openai', 'sk-test')).toEqual([{ id: 'gpt-6-sol', provider: 'openai' }])

    mockFetch(() => ({
      status: 200,
      body: {
        data: [
          {
            id: 'deepseek/deepseek-v4',
            name: 'DeepSeek V4',
            pricing: { prompt: '0.0000003', completion: '0.0000012' },
          },
        ],
      },
    }))
    const [ds] = await listModels('openrouter', 'sk-or-test')
    expect(ds).toMatchObject({ id: 'openrouter/deepseek/deepseek-v4', provider: 'openrouter', label: 'DeepSeek V4' })
    expect(ds.inputPerM).toBeCloseTo(0.3)
    expect(ds.outputPerM).toBeCloseTo(1.2)
    expect(await listModels('anthropic', 'sk-ant-x')).toEqual([])
  })
})

describe('models you add', () => {
  beforeEach(async () => {
    await appDb.settings.delete('ai')
  })

  it('registers custom models, keeps OpenRouter ids apart, and marks unknown prices', () => {
    registerCustomModels([{ id: storedModelId('openrouter', 'openai/gpt-oss-120b'), provider: 'openrouter' }])
    expect(modelById('openai/gpt-oss-120b').provider).toBe('groq')
    expect(modelById('openrouter/openai/gpt-oss-120b').provider).toBe('openrouter')
    expect(apiModelId(modelById('openrouter/openai/gpt-oss-120b'))).toBe('openai/gpt-oss-120b')

    registerCustomModels([{ id: 'gpt-6-sol', provider: 'openai' }])
    expect(hasModel('gpt-6-sol')).toBe(true)
    expect(priceKnown('gpt-6-sol')).toBe(false)
    expect(priceKnown('gpt-6.1-sol')).toBe(true)
  })

  it('saves added models with the AI settings and can select and remove them', async () => {
    await saveAiSettings({ provider: 'openai', model: 'gpt-6.1-sol' })
    await addCustomModels([{ id: 'gpt-6-sol', provider: 'openai' }])
    await saveAiSettings({ model: 'gpt-6-sol' })
    let s = await loadAiSettings()
    expect(s.model).toBe('gpt-6-sol')
    expect(s.customModels).toEqual([{ id: 'gpt-6-sol', provider: 'openai' }])

    s = await removeCustomModel('openai', 'gpt-6-sol')
    expect(s.customModels).toEqual([])
    expect(s.model).toBe('gpt-6.1-sol')
  })

  it('every provider has a key format, a host for the security policy, and a default model', () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.host).toMatch(/\./)
      expect(p.keyPlaceholder).toBeTruthy()
    }
    expect(perM(2)).toBe('$2')
    expect(perM(0.15)).toBe('$0.15')
    expect(perM(0.0004)).toBe('$0.0004')
  })
})

describe('prices you set', () => {
  beforeEach(async () => {
    await appDb.settings.delete('ai')
  })

  it('costs added models once you set a price, and lets you change or reset built-in prices', async () => {
    const { costUsd } = await import('../src/lib/ai/models')
    const { setModelPrice } = await import('../src/lib/ai/settings')
    await addCustomModels([{ id: 'gpt-6-sol', provider: 'openai' }])
    expect(priceKnown('gpt-6-sol')).toBe(false)
    expect(costUsd('gpt-6-sol', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(0)

    await setModelPrice('gpt-6-sol', { inputPerM: 2, outputPerM: 10 })
    expect(priceKnown('gpt-6-sol')).toBe(true)
    expect(costUsd('gpt-6-sol', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(12)

    await setModelPrice('gemini-3.8-flash', { inputPerM: 1.5, outputPerM: 7.5 })
    expect(modelById('gemini-3.8-flash')).toMatchObject({ inputPerM: 1.5, outputPerM: 7.5, priceSet: true })
    await setModelPrice('gemini-3.8-flash', undefined)
    expect(modelById('gemini-3.8-flash')).toMatchObject({ inputPerM: 0.75, outputPerM: 3.75 })
    expect(modelById('gemini-3.8-flash').priceSet).toBeUndefined()
  })
})

describe('daily limits', () => {
  it('reports a daily token cap as a daily limit, even when the message mentions billing', async () => {
    mockFetch(() => ({
      status: 429,
      body: {
        error: {
          message:
            'Rate limit reached on tokens per day (TPD). Need more tokens? Upgrade at https://console.groq.com/settings/billing',
        },
      },
    }))
    const err = await ask('openai/gpt-oss-120b').catch((e) => e)
    expect(err.kind).toBe('limit')
    expect(err.message).toMatch(/daily allowance/)
  })
})
