import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the Anthropic SDK: records requests and returns canned responses.
const sdk = vi.hoisted(() => {
  const calls: unknown[] = []
  const state: { next: unknown; throwErr?: unknown } = { next: undefined }
  class APIError extends Error {
    constructor(
      readonly status: number,
      message = 'error',
    ) {
      super(message)
    }
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionError extends Error {}
  class APIUserAbortError extends APIError {}
  class FakeAnthropic {
    static APIError = APIError
    static AuthenticationError = AuthenticationError
    static PermissionDeniedError = PermissionDeniedError
    static NotFoundError = NotFoundError
    static RateLimitError = RateLimitError
    static APIConnectionError = APIConnectionError
    static APIUserAbortError = APIUserAbortError
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
      calls.push({ ctor: opts })
    }
    models = { retrieve: async (id: string) => (state.throwErr ? Promise.reject(state.throwErr) : { id }) }
    beta = {
      messages: {
        create: async (params: unknown) => {
          calls.push({ params })
          if (state.throwErr) throw state.throwErr
          return state.next
        },
      },
    }
  }
  return { calls, state, FakeAnthropic, AuthenticationError }
})
vi.mock('@anthropic-ai/sdk', () => ({ default: sdk.FakeAnthropic }))

import { decryptSecret, encryptSecret } from '../src/lib/crypto'
import { generateFilters, testKey } from '../src/lib/ai/anthropic'
import {
  AiFilterOutput,
  buildFilterSystemPrompt,
  convertAiFilter,
  FILTER_OUTPUT_SCHEMA,
} from '../src/lib/ai/filter-prompt'
import { costUsd, formatUsd } from '../src/lib/ai/models'
import {
  forgetKey,
  loadAiSettings,
  looksLikeAnthropicKey,
  recordUsage,
  spendThisMonth,
  storeKey,
  unlockKey,
} from '../src/lib/ai/settings'
import { appDb } from '../src/lib/app-db'
import { BUILT_IN_PACKS } from '../src/lib/filters/presets'
import { FilterGroupSchema, type KeywordPack } from '../src/lib/filters/schema'

const packs: KeywordPack[] = BUILT_IN_PACKS.map((p) => ({ ...p, updatedAt: '' }))
const KEY = 'sk-ant-api03-' + 'a'.repeat(40)

const textResponse = (json: unknown, extra: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(json) }],
  usage: { input_tokens: 2000, output_tokens: 300 },
  ...extra,
})

const goodOutput: AiFilterOutput = {
  combinator: 'and',
  conditions: [{ field: 'seniority', op: 'any_of', values: ['C-level', 'director'], number: null }],
  groups: [
    {
      combinator: 'or',
      conditions: [
        { field: 'titleTags', op: 'any_of', values: ['CIO', 'IT Director'], number: null },
        { field: 'keywordPack', op: 'matches_pack', values: ['pack-microsoft-d365'], number: null },
      ],
    },
  ],
  explanation: 'Senior people who are CIOs/IT directors or mention the Microsoft stack.',
  unsupported: ['Company size is not in your data.'],
}

beforeEach(() => {
  sdk.calls.length = 0
  sdk.state.next = undefined
  sdk.state.throwErr = undefined
})

describe('crypto', () => {
  it('round-trips with the right passphrase and fails with the wrong one', async () => {
    const enc = await encryptSecret(KEY, 'correct horse battery')
    expect(new TextDecoder().decode(enc.data)).not.toContain('sk-ant')
    expect(await decryptSecret(enc, 'correct horse battery')).toBe(KEY)
    await expect(decryptSecret(enc, 'wrong passphrase')).rejects.toThrow()
  })
})

describe('key storage', () => {
  it('stores the device key only in encrypted form and unlocks it', async () => {
    await storeKey(KEY, 'device', 'a long passphrase')
    const s = await loadAiSettings()
    expect(s.keys.anthropic?.storage).toBe('device')
    expect(s.keys.anthropic?.keyHint).toBe('aaaa')
    expect(JSON.stringify(s)).not.toContain('sk-ant')
    expect(await unlockKey('a long passphrase')).toBe(KEY)
    await expect(unlockKey('nope nope nope')).rejects.toThrow("That passphrase didn't work.")

    await forgetKey()
    expect((await loadAiSettings()).keys.anthropic).toBeUndefined()
  })

  it('rejects short passphrases and spots key shapes', async () => {
    await expect(storeKey(KEY, 'device', 'short')).rejects.toThrow('at least 8')
    expect(looksLikeAnthropicKey(KEY)).toBe(true)
    expect(looksLikeAnthropicKey('sk-proj-123')).toBe(false)
  })
})

describe('costs', () => {
  it('prices tokens per model, including cache reads and writes', () => {
    expect(costUsd('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBe(4)
    expect(costUsd('claude-haiku-5-5', { input_tokens: 0, output_tokens: 1_000_000 })).toBe(0.5)
    expect(
      costUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }),
    ).toBeCloseTo(0.2)
    expect(formatUsd(0.004)).toBe('<$0.01')
    expect(formatUsd(1.234)).toBe('$1.23')
  })

  it('adds up this month', async () => {
    await appDb.aiUsage.clear()
    await recordUsage('claude-opus-5-5', 'filters', { input_tokens: 2000, output_tokens: 300 })
    await recordUsage('claude-opus-5-5', 'filters', { input_tokens: 2000, output_tokens: 300 })
    expect(await spendThisMonth()).toBeCloseTo((2 * (2000 * 4 + 300 * 20)) / 1e6)
  })
})

describe('describe-to-filter output', () => {
  it('schema requires every property (structured outputs rule)', () => {
    const check = (node: Record<string, unknown>) => {
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false)
        expect(Object.keys(node.properties as object).sort()).toEqual([...(node.required as string[])].sort())
        Object.values(node.properties as object).forEach((v) => check(v))
      }
      if (node.type === 'array') check(node.items as Record<string, unknown>)
    }
    check(FILTER_OUTPUT_SCHEMA)
  })

  it('converts valid output into a normal filter', () => {
    const { filter, dropped } = convertAiFilter(goodOutput, packs)
    expect(dropped).toEqual([])
    expect(FilterGroupSchema.safeParse(filter).success).toBe(true)
    expect(filter.items[0]).toMatchObject({ field: 'seniority', op: 'any_of', value: ['C-level', 'Director'] })
    expect(filter.items[1]).toMatchObject({ kind: 'group', combinator: 'or' })
  })

  it('drops conditions that do not fit the real fields', () => {
    const { filter, dropped } = convertAiFilter(
      {
        ...goodOutput,
        conditions: [
          { field: 'seniority', op: 'contains', values: ['VP'], number: null },
          { field: 'function', op: 'any_of', values: ['Astronaut'], number: null },
          { field: 'keywordPack', op: 'matches_pack', values: ['made-up-pack'], number: null },
          { field: 'connectedOn', op: 'within_last', values: [], number: 24 },
          { field: 'connectedOn', op: 'before', values: ['last tuesday'], number: null },
          { field: 'keywords', op: 'has_any_word', values: ['Dynamics', ' ', 'Dynamics'], number: null },
        ],
        groups: [
          { combinator: 'or', conditions: [{ field: 'location', op: 'contains', values: ['Boston'], number: null }] },
        ],
      },
      packs,
    )
    expect(dropped).toHaveLength(4)
    expect(
      filter.items.map((i) => (i.kind === 'condition' ? `${i.field}:${JSON.stringify(i.value)}` : 'group')),
    ).toEqual([
      'connectedOn:24',
      'keywords:["Dynamics"]',
      'location:"Boston"', // a one-condition group is flattened
    ])
  })

  it('prompt lists fields and packs but carries no contact data', () => {
    const prompt = buildFilterSystemPrompt(packs, '2026-10-15')
    expect(prompt).toContain('pack-microsoft-d365')
    expect(prompt).toContain('titleTags')
    expect(prompt).toContain('Today is 2026-10-15')
  })
})

describe('Anthropic provider', () => {
  it('sends a structured-output request with fallbacks and only the description', async () => {
    sdk.state.next = textResponse(goodOutput)
    const res = await generateFilters({
      apiKey: KEY,
      model: 'claude-opus-5-5',
      effort: 'low',
      description: 'CIOs into Dynamics',
      packs,
    })

    const ctor = sdk.calls.find((c) => (c as { ctor?: unknown }).ctor) as { ctor: Record<string, unknown> }
    expect(ctor.ctor).toMatchObject({ apiKey: KEY, dangerouslyAllowBrowser: true })
    const { params } = sdk.calls.find((c) => (c as { params?: unknown }).params) as { params: Record<string, unknown> }
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    })
    expect(JSON.stringify(params.messages)).toContain('CIOs into Dynamics')
    expect(res.filter.items).toHaveLength(2)
    expect(res.unsupported).toEqual(['Company size is not in your data.'])
    expect(res.servedBy).toBe('claude-opus-5-5')
  })

  it('does not send fallbacks for Haiku (not supported there)', async () => {
    sdk.state.next = textResponse(goodOutput, { model: 'claude-haiku-5-5' })
    await generateFilters({ apiKey: KEY, model: 'claude-haiku-5-5', effort: 'low', description: 'x', packs })
    const { params } = sdk.calls.find((c) => (c as { params?: unknown }).params) as { params: Record<string, unknown> }
    expect(params.fallbacks).toBeUndefined()
    expect(params.betas).toBeUndefined()
  })

  it('reports refusals and unreadable answers kindly', async () => {
    sdk.state.next = textResponse({}, { stop_reason: 'refusal', content: [] })
    await expect(
      generateFilters({ apiKey: KEY, model: 'claude-opus-5-5', effort: 'low', description: 'x', packs }),
    ).rejects.toMatchObject({ kind: 'refused' })
    sdk.state.next = { ...textResponse({}), content: [{ type: 'text', text: 'not json' }] }
    await expect(
      generateFilters({ apiKey: KEY, model: 'claude-opus-5-5', effort: 'low', description: 'x', packs }),
    ).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('maps a bad key to a friendly message that never contains the key', async () => {
    sdk.state.throwErr = new sdk.AuthenticationError(401, 'invalid x-api-key')
    const err = await testKey(KEY, 'claude-opus-5-5').catch((e) => e)
    expect(err.kind).toBe('auth')
    expect(err.message).not.toContain(KEY)
  })
})

describe('Groq provider', () => {
  const GROQ_KEY = 'gsk_' + 'b'.repeat(52)

  it('converts nullable anyOf into a type list for Groq strict mode', async () => {
    const { toGroqSchema } = await import('../src/lib/ai/openai-compat')
    const out = toGroqSchema(FILTER_OUTPUT_SCHEMA) as {
      properties: { conditions: { items: { properties: Record<string, unknown> } } }
    }
    expect(out.properties.conditions.items.properties.number).toEqual({ type: ['integer', 'null'] })
  })

  it('routes Groq models to api.groq.com with strict json_schema, effort and no contact data', async () => {
    const { generateFilters } = await import('../src/lib/ai/provider')
    const calls: Array<{ url: string; init: RequestInit }> = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(
        JSON.stringify({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: JSON.stringify(goodOutput) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1200, completion_tokens: 300 },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    try {
      const res = await generateFilters({
        apiKey: GROQ_KEY,
        model: 'openai/gpt-oss-120b',
        effort: 'low',
        description: 'CIOs into Dynamics',
        packs,
      })
      expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions')
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GROQ_KEY}`)
      const body = JSON.parse(calls[0].init.body as string)
      expect(body).toMatchObject({
        model: 'openai/gpt-oss-120b',
        reasoning_effort: 'low',
        response_format: { type: 'json_schema', json_schema: { strict: true } },
      })
      expect(res.filter.items).toHaveLength(2)
      expect(res.usage).toEqual({ input_tokens: 1200, output_tokens: 300 })
      expect(sdk.calls).toHaveLength(0) // the Anthropic SDK was never touched
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('maps Groq HTTP errors to friendly messages', async () => {
    const { generateFilters } = await import('../src/lib/ai/provider')
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })) as typeof fetch
    try {
      const err = await generateFilters({
        apiKey: GROQ_KEY,
        model: 'openai/gpt-oss-20b',
        effort: 'low',
        description: 'x',
        packs,
      }).catch((e) => e)
      expect(err.kind).toBe('auth')
      expect(err.message).not.toContain(GROQ_KEY)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('stops (instead of retrying) when Groq says the daily allowance is used up', async () => {
    const { hqBatch } = await import('../src/lib/ai/provider')
    const realFetch = globalThis.fetch
    const respond = (message: string) =>
      (async () => new Response(JSON.stringify({ error: { message } }), { status: 429 })) as typeof fetch
    try {
      globalThis.fetch = respond('Rate limit reached ... on tokens per day (TPD): Limit 200000, Used 194976')
      const daily = await hqBatch({ apiKey: GROQ_KEY, model: 'openai/gpt-oss-120b', effort: 'high', rows: [] }).catch(
        (e) => e,
      )
      expect(daily.kind).toBe('limit')
      globalThis.fetch = respond('Rate limit reached ... on tokens per minute (TPM)')
      const minute = await hqBatch({ apiKey: GROQ_KEY, model: 'openai/gpt-oss-120b', effort: 'high', rows: [] }).catch(
        (e) => e,
      )
      expect(minute.kind).toBe('rate')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('keeps one key slot per provider and migrates old single-key settings', async () => {
    await appDb.settings.put({
      key: 'ai',
      value: { provider: 'anthropic', model: 'claude-opus-5-5', keyStorage: 'session', keyHint: 'zzzz' },
    })
    let s = await loadAiSettings()
    expect(s.keys.anthropic).toEqual({ storage: 'session', encryptedKey: undefined, keyHint: 'zzzz' })

    await storeKey(GROQ_KEY, 'session', undefined, 'groq')
    s = await loadAiSettings()
    expect(s.keys.groq?.keyHint).toBe('bbbb')
    expect(s.keys.anthropic?.keyHint).toBe('zzzz')

    await appDb.settings.put({ key: 'ai', value: { ...s, provider: 'groq', model: 'claude-opus-5-5' } })
    expect((await loadAiSettings()).model).toBe('openai/gpt-oss-120b') // model follows the provider
  })
})

describe('long briefs', () => {
  it('joins role tags and seniority with OR, so either one counts', async () => {
    const { mergeWhoConditions } = await import('../src/lib/ai/filter-prompt')
    const c = (field: 'titleTags' | 'seniority' | 'anyLocation', value: string[] | string) => ({
      id: field,
      kind: 'condition' as const,
      field,
      op: field === 'anyLocation' ? ('contains' as const) : ('any_of' as const),
      value,
    })
    const out = mergeWhoConditions({
      combinator: 'and',
      items: [c('titleTags', ['CIO']), c('seniority', ['C-level']), c('anyLocation', 'Boston')],
    })
    expect(out.items).toHaveLength(2)
    expect(out.items[0]).toMatchObject({
      kind: 'group',
      combinator: 'or',
      conditions: [{ field: 'titleTags' }, { field: 'seniority' }],
    })
    expect(out.items[1]).toMatchObject({ field: 'anyLocation' })
  })
})
