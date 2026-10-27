import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAi } from '../api/_ai'
import { handleStatus } from '../api/_routes'
import { memorySpend, setSpendStore, spendDay, type SpendStore } from '../api/_spend'

const KEY = 'sk-test-company-key-0000000000'
let store: SpendStore

const chat = (body: unknown, code = 'right-code-123') =>
  new Request('https://app.test/api/ai?op=chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-key': code },
    body: JSON.stringify(body),
  })

const okFetch = (usage = { prompt_tokens: 1000, completion_tokens: 500 }) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage }), {
        status: 200,
      }),
  )

const request = { model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 1000 }

beforeEach(() => {
  process.env.APP_ACCESS_KEY = 'right-code-123'
  process.env.OPENAI_API_KEY = KEY
  process.env.AI_DAILY_CAP_USD = '10'
  store = memorySpend()
  setSpendStore(store)
})
afterEach(() => {
  delete process.env.APP_ACCESS_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.AI_DAILY_CAP_USD
  setSpendStore(undefined)
})

describe('/api/ai (company key on the server)', () => {
  it('needs no access code', async () => {
    const f = okFetch()
    expect((await handleAi(chat(request, ''), f)).status).toBe(200)
  })

  it('adds the key on the server, never returns it, and counts the cost', async () => {
    const f = okFetch()
    const res = await handleAi(chat(request), f)
    expect(res.status).toBe(200)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(await res.text()).not.toContain(KEY)
    // 1,000 in × $2/M + 500 out × $10/M = $0.007
    expect(await store.get(spendDay())).toBeCloseTo(0.007, 6)
    expect(res.headers.get('x-ai-spent-today')).toBe('0.0070')
  })

  it('only runs built-in GPT models', async () => {
    const f = okFetch()
    const res = await handleAi(chat({ ...request, model: 'claude-opus-5-5' }), f)
    expect(res.status).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses with a clear message once today’s limit is reached', async () => {
    await store.add(spendDay(), 10)
    const f = okFetch()
    const res = await handleAi(chat(request), f)
    expect(res.status).toBe(429)
    const body = (await res.json()) as { code: string; error: string; capUsd: number }
    expect(body).toMatchObject({ code: 'daily_cap', capUsd: 10 })
    expect(body.error).toMatch(/\$10\.00/)
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses a call whose largest possible cost would pass the limit', async () => {
    await store.add(spendDay(), 9.95)
    // 16,000 output tokens × $10/M = $0.16 worst case → over $10.
    const res = await handleAi(chat({ ...request, max_completion_tokens: 16_000 }), okFetch())
    expect(res.status).toBe(429)
  })

  it('reports the company key and today’s spend in the status, never the key', async () => {
    await store.add(spendDay(), 1.5)
    const body = (await (await handleStatus(new Request('https://app.test/api/status'))).json()) as {
      companyAi?: { spentUsd: number; capUsd: number }
    }
    expect(body).toMatchObject({ accessRequired: false, accessOk: true, companyKey: true })
    expect(body.companyAi).toMatchObject({ spentUsd: 1.5, capUsd: 10 })
    expect(JSON.stringify(body)).not.toContain(KEY)
  })

  it('says when the server has no company key', async () => {
    delete process.env.OPENAI_API_KEY
    expect((await handleAi(chat(request), okFetch())).status).toBe(503)
  })
})

describe('spend day', () => {
  it('uses Sri Lanka time', () => {
    // 20:00 UTC is 01:30 the next day in Colombo.
    expect(spendDay(new Date('2026-10-27T20:00:00Z'))).toBe('2026-10-28')
  })
})
