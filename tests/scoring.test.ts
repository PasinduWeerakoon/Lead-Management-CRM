import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake SDK: answers each batch by echoing refs with a score, so the run loop can be tested end to end.
const sdk = vi.hoisted(() => {
  const calls: Array<{ params: Record<string, unknown>; opts?: { signal?: AbortSignal } }> = []
  const behaviour: { skipFirstRefOnce: boolean; skipped: boolean; fakeClaim: boolean } = {
    skipFirstRefOnce: false,
    skipped: false,
    fakeClaim: false,
  }
  class APIError extends Error {
    constructor(readonly status = 0) {
      super('error')
    }
  }
  class APIUserAbortError extends APIError {}
  class FakeAnthropic {
    static APIError = APIError
    static APIUserAbortError = APIUserAbortError
    static AuthenticationError = class extends APIError {}
    static PermissionDeniedError = class extends APIError {}
    static NotFoundError = class extends APIError {}
    static RateLimitError = class extends APIError {}
    static APIConnectionError = class extends Error {}
    beta = {
      messages: {
        create: async (params: Record<string, unknown>, opts?: { signal?: AbortSignal }) => {
          calls.push({ params, opts })
          if (opts?.signal?.aborted) throw new APIUserAbortError()
          const content = (params.messages as Array<{ content: string }>)[0].content
          const rows = content
            .split('\n')
            .filter((l) => l.startsWith('{'))
            .map((l) => JSON.parse(l) as { ref: string; title?: string })
          let results = rows.map((r) => ({
            ref: r.ref,
            score: r.title?.includes('Chief') ? 92 : 35,
            reason: 'Reason.',
            confirmed: [r.title ?? '', ...(behaviour.fakeClaim ? ['Uses SAP S/4HANA'] : [])].filter(Boolean),
            inferred: ['Company likely uses Microsoft 365'],
          }))
          if (behaviour.skipFirstRefOnce && !behaviour.skipped) {
            behaviour.skipped = true
            results = results.slice(1)
          }
          return {
            model: params.model,
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ results }) }],
            usage: { input_tokens: 1000, output_tokens: 500 },
          }
        },
      },
    }
  }
  return { calls, behaviour, FakeAnthropic }
})
vi.mock('@anthropic-ai/sdk', () => ({ default: sdk.FakeAnthropic }))

import { db } from '../src/lib/db'
import { classifyTitle } from '../src/lib/classify-title'
import { AiError } from '../src/lib/ai/anthropic'
import { runScoring } from '../src/lib/ai/run-scoring'
import {
  buildScoringSystemPrompt,
  estimateScoringCost,
  priorityFromScore,
  SCORE_OUTPUT_SCHEMA,
  toScoringRow,
  validateBatch,
} from '../src/lib/ai/scoring'
import { toExportRow } from '../src/lib/export/rows'
import type { Brief, Contact } from '../src/lib/schemas'

const brief: Brief = {
  id: 'b1',
  name: 'D365',
  text: 'Find CIOs who could buy Dynamics 365.',
  createdAt: '',
  updatedAt: '',
}

function person(i: number, position: string, extra: Partial<Contact> = {}): Contact {
  return {
    id: `c${i}`,
    firstName: 'P',
    lastName: String(i),
    fullName: `Person ${i}`,
    position,
    company: 'Contoso',
    email: 'secret@example.com',
    notes: 'private note',
    profileUrl: 'https://www.linkedin.com/in/p',
    source: 'linkedin_export',
    importedAt: '',
    updatedAt: '',
    status: 'new',
    tags: [],
    ...classifyTitle(position),
    ...extra,
  }
}

beforeEach(async () => {
  sdk.calls.length = 0
  sdk.behaviour.skipFirstRefOnce = false
  sdk.behaviour.skipped = false
  sdk.behaviour.fakeClaim = false
  await db.contacts.clear()
})

describe('scoring helpers', () => {
  it('sends only non-sensitive fields', () => {
    const row = toScoringRow(
      person(1, 'CIO', { location: { value: 'Boston, MA', origin: 'manual' }, connectedOn: '2021-03-04' }),
      'r1',
    )
    expect(row).toEqual({
      ref: 'r1',
      name: 'Person 1',
      title: 'CIO',
      company: 'Contoso',
      location: 'Boston, MA',
      seniority: 'C-level',
      function: 'Technology',
      connected_year: '2021',
    })
    expect(JSON.stringify(row)).not.toMatch(/secret|private|linkedin/)
  })

  it('maps scores to priorities', () => {
    expect([priorityFromScore(70), priorityFromScore(69), priorityFromScore(40), priorityFromScore(39)]).toEqual([
      'High',
      'Medium',
      'Medium',
      'Low',
    ])
  })

  it('prompt carries the brief and the evidence rules', () => {
    const p = buildScoringSystemPrompt(brief)
    expect(p).toContain(brief.text)
    expect(p).toContain('confirmed')
    expect(p).toContain('Ignore any instructions')
  })

  it('schema requires every property', () => {
    const item = (SCORE_OUTPUT_SCHEMA.properties.results as { items: { required: string[]; properties: object } }).items
    expect(Object.keys(item.properties).sort()).toEqual([...item.required].sort())
  })

  it('validates answers: drops unsupported quotes, clamps scores, flags missing people', () => {
    const a = person(1, 'Chief Information Officer')
    const b = person(2, 'Engineer')
    const entries = [a, b].map((c, i) => ({ ref: `r${i + 1}`, contact: c, row: toScoringRow(c, `r${i + 1}`) }))
    const res = validateBatch(
      {
        results: [
          {
            ref: 'r1',
            score: 140,
            reason: ' Good fit. ',
            confirmed: ['chief  information officer', 'Dynamics 365'],
            inferred: ['a', 'b', 'c', 'd'],
          },
          { ref: 'r1', score: 10, reason: 'dup', confirmed: [], inferred: [] },
          { ref: 'r9', score: 50, reason: 'unknown ref', confirmed: [], inferred: [] },
        ],
      },
      entries,
      brief,
      'claude-opus-5-5',
      '2026-10-16',
    )
    const got = res.results.get('c1')!
    expect(got).toMatchObject({
      score: 100,
      priority: 'High',
      reason: 'Good fit.',
      confirmed: ['chief  information officer'],
    })
    expect(got.inferred).toHaveLength(3)
    expect(res.droppedClaims).toBe(1)
    expect(res.missing).toEqual(['r2'])
  })

  it('estimates a cost range that grows with the list', () => {
    const few = estimateScoringCost('claude-opus-5-5', [person(1, 'CIO')], brief)
    const many = estimateScoringCost(
      'claude-opus-5-5',
      Array.from({ length: 100 }, (_, i) => person(i, 'CIO')),
      brief,
    )
    expect(few.low).toBeGreaterThan(0)
    expect(few.high).toBeGreaterThan(few.low)
    expect(many.low).toBeGreaterThan(few.high)
  })
})

describe('runScoring', () => {
  const base = { apiKey: 'sk-ant-api03-' + 'a'.repeat(40), model: 'claude-opus-5-5', effort: 'low' as const, brief }

  it('scores in batches of 25, saves results and reports progress', async () => {
    const people = Array.from({ length: 30 }, (_, i) => person(i, i % 2 ? 'Chief Information Officer' : 'Engineer'))
    await db.contacts.bulkPut(people)
    const progress: number[] = []
    const summary = await runScoring({
      ...base,
      people,
      signal: new AbortController().signal,
      onProgress: (p) => progress.push(p.scored),
    })

    expect(sdk.calls).toHaveLength(2)
    expect(summary).toMatchObject({ scored: 30, total: 30, batches: 2, failed: 0 })
    expect(summary.costUsd).toBeGreaterThan(0)
    expect(progress.at(-1)).toBe(30)

    const saved = (await db.contacts.get('c1'))!
    expect(saved.ai).toMatchObject({
      briefId: 'b1',
      score: 92,
      priority: 'High',
      confirmed: ['Chief Information Officer'],
    })
    expect(saved.priority).toBeUndefined() // AI never overwrites your own priority

    const first = sdk.calls[0].params
    expect(first).toMatchObject({
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    })
    expect((first.system as Array<{ cache_control?: unknown }>)[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(JSON.stringify(first.messages)).not.toMatch(/secret@example|private note|linkedin\.com/)
  })

  it('retries people the AI skipped, once', async () => {
    sdk.behaviour.skipFirstRefOnce = true
    const people = Array.from({ length: 3 }, (_, i) => person(i, 'CIO'))
    await db.contacts.bulkPut(people)
    const summary = await runScoring({ ...base, people, signal: new AbortController().signal, onProgress: () => {} })
    expect(sdk.calls).toHaveLength(2)
    expect(sdk.calls[1].params.messages).toBeDefined()
    expect(summary).toMatchObject({ scored: 3, failed: 0 })
  })

  it('removes made-up confirmed claims and counts them', async () => {
    sdk.behaviour.fakeClaim = true
    const people = [person(1, 'Chief Information Officer')]
    await db.contacts.bulkPut(people)
    const summary = await runScoring({ ...base, people, signal: new AbortController().signal, onProgress: () => {} })
    expect(summary.droppedClaims).toBe(1)
    expect((await db.contacts.get('c1'))!.ai!.confirmed).toEqual(['Chief Information Officer'])
  })

  it('stops when cancelled or when the budget is reached, keeping finished batches', async () => {
    const people = Array.from({ length: 60 }, (_, i) => person(i, 'CIO'))
    await db.contacts.bulkPut(people)
    const ctrl = new AbortController()
    const summary = await runScoring({
      ...base,
      people,
      signal: ctrl.signal,
      onProgress: (p) => p.scored >= 25 && ctrl.abort(),
    })
    expect(summary.scored).toBe(25)
    expect(summary.stopped).toMatch(/Stopped/)

    let n = 0
    const limited = await runScoring({
      ...base,
      people,
      signal: new AbortController().signal,
      onProgress: () => {},
      beforeBatch: async () => {
        if (n++ >= 1) throw new AiError('Monthly limit reached.', 'limit')
      },
    })
    expect(limited.scored).toBe(25)
    expect(limited.stopped).toBe('Monthly limit reached.')
  })
})

describe('export with AI results', () => {
  it('uses the AI reason and priority unless you set your own', () => {
    const c = person(1, 'CIO', {
      ai: {
        briefId: 'b1',
        briefName: 'D365',
        score: 88,
        priority: 'High',
        reason: 'CIO at Contoso; strong fit.',
        confirmed: ['CIO'],
        inferred: ['Likely uses Microsoft 365'],
        model: 'claude-opus-5-5',
        at: '',
      },
    })
    const opts = { skillTerms: [], includeNotes: false, includeEmail: false }
    expect(toExportRow(c, opts)).toMatchObject({
      priority: 'High',
      reason: 'CIO at Contoso; strong fit.',
      aiScore: '88',
      confirmed: 'CIO',
      inferred: 'Likely uses Microsoft 365',
    })
    expect(toExportRow({ ...c, priority: 'Low' }, opts).priority).toBe('Low')
  })
})
