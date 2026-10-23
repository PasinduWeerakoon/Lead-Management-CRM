import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { classifyTitle } from '../src/lib/classify-title'
import { companyKey, domainOf, hqText, planHqLookup, type CompanyHq } from '../src/lib/company-hq'
import { saveHq, setManualHq } from '../src/lib/company-hq-store'
import { db } from '../src/lib/db'
import { estimateHqCost, toHqRow, validateHqBatch } from '../src/lib/ai/company-hq'
import { toScoringRow } from '../src/lib/ai/scoring'
import { compileFilter } from '../src/lib/filters/engine'
import { builtInPresetId, PRESETS } from '../src/lib/filters/presets'
import type { Condition, FilterGroup } from '../src/lib/filters/schema'
import { toExportRow } from '../src/lib/export/rows'
import { mergeContact, normalizeCompany } from '../src/lib/normalize'
import type { Contact } from '../src/lib/schemas'

let seq = 0
function person(company: string | undefined, extra: Partial<Contact> = {}): Contact {
  const n = ++seq
  return {
    id: `p${n}`,
    firstName: 'P',
    lastName: String(n),
    fullName: `Person ${n}`,
    position: 'CIO',
    company,
    source: 'linkedin_export',
    importedAt: '2026-01-01',
    updatedAt: '2026-01-01',
    status: 'new',
    tags: [],
    ...classifyTitle('CIO'),
    ...extra,
  }
}

const hq = (value: string, extra: Partial<CompanyHq> = {}): CompanyHq => ({
  status: 'found',
  value,
  origin: 'ai',
  confidence: 'high',
  at: '2026-10-18',
  ...extra,
})

describe('company identity', () => {
  it('treats legal suffixes and punctuation as the same company', () => {
    expect(normalizeCompany('Contoso, Inc.')).toBe(normalizeCompany('contoso'))
    expect(normalizeCompany('Fabrikam LLC')).toBe('fabrikam')
    expect(normalizeCompany('AT&T')).toBe('at&t')
  })

  it('prefers the website domain over the name', () => {
    expect(domainOf('https://www.contoso.com/about')).toBe('contoso.com')
    expect(domainOf('not a url')).toBeUndefined()
    expect(
      companyKey({ company: 'Contoso', enrichment: { website: 'https://contoso.com', source: 'x', updatedAt: '' } }),
    ).toBe('d:contoso.com')
    expect(companyKey({ company: 'Contoso Ltd' })).toBe('n:contoso')
    expect(companyKey({ company: '  ' })).toBeUndefined()
  })
})

describe('planHqLookup', () => {
  it('looks each company up once and reuses HQs already known', () => {
    const known = person('Woodgrove Bank', { companyHq: hq('Boston, Massachusetts, United States') })
    const a = person('Contoso, Inc.')
    const b = person('contoso')
    const c = person('Woodgrove Bank')
    const d = person(undefined)
    const plan = planHqLookup([a, b, c, d], [known, a, b, c, d])
    expect(plan.lookup).toHaveLength(1)
    expect(plan.lookup[0].people.map((p) => p.id)).toEqual([a.id, b.id])
    expect(plan.copy).toEqual([{ ids: [c.id], hq: known.companyHq }])
    expect(plan.noCompany).toBe(1)
  })

  it('matches a colleague by name when only one of them has the website', () => {
    const withSite = person('Contoso', {
      enrichment: { website: 'https://contoso.com', source: 'x', updatedAt: '' },
      companyHq: hq('Redmond, Washington, United States'),
    })
    const plain = person('Contoso')
    const plan = planHqLookup([plain], [withSite, plain])
    expect(plan.lookup).toHaveLength(0)
    expect(plan.copy[0].ids).toEqual([plain.id])
  })

  it('skips people already done unless redoing, and never touches typed HQs', () => {
    const sure = person('Northwind', { companyHq: hq('Seattle') })
    const fairly = person('Adatum', { companyHq: hq('Austin', { confidence: 'medium' }) })
    const unknown = person('Litware', { companyHq: { status: 'unknown', origin: 'ai', at: '' } })
    const typed = person('Fabrikam', { companyHq: hq('Boston', { origin: 'manual', confidence: undefined }) })
    const everyone = [sure, fairly, unknown, typed]
    expect(planHqLookup(everyone, everyone).lookup).toHaveLength(0)
    expect(
      planHqLookup(everyone, everyone, true)
        .lookup.map((g) => g.company)
        .sort(),
    ).toEqual(['Adatum', 'Litware', 'Northwind'])
  })
})

describe('validateHqBatch', () => {
  it('keeps good answers, turns vague ones into unknown and reports skipped refs', () => {
    const out = {
      results: [
        {
          ref: 'c1',
          status: 'found' as const,
          city: 'Cambridge',
          region: 'Massachusetts',
          country: 'United States',
          metro: 'Greater Boston',
          confidence: 'high' as const,
        },
        {
          ref: 'c2',
          status: 'found' as const,
          city: 'N/A',
          region: null,
          country: null,
          metro: null,
          confidence: 'low' as const,
        },
        {
          ref: 'c5',
          status: 'found' as const,
          city: 'Rochester',
          region: null,
          country: 'United States',
          metro: null,
          confidence: 'low' as const,
        },
        {
          ref: 'c3',
          status: 'unknown' as const,
          city: null,
          region: null,
          country: null,
          metro: null,
          confidence: 'low' as const,
        },
        {
          ref: 'zz',
          status: 'found' as const,
          city: 'X',
          region: null,
          country: null,
          metro: null,
          confidence: 'high' as const,
        },
      ],
    }
    const { results, missing } = validateHqBatch(out, ['c1', 'c2', 'c3', 'c4', 'c5'], 'openai/gpt-oss-120b', 'now')
    expect(results.get('c1')).toEqual({
      status: 'found',
      value: 'Cambridge, Massachusetts, United States',
      metro: 'Greater Boston',
      confidence: 'high',
      origin: 'ai',
      model: 'openai/gpt-oss-120b',
      at: 'now',
    })
    expect(results.get('c2')?.status).toBe('unknown')
    expect(results.get('c3')?.status).toBe('unknown')
    expect(results.get('c5')?.status).toBe('unknown') // a guess isn't kept
    expect(results.has('zz')).toBe(false)
    expect(missing).toEqual(['c4'])
  })

  it('sends only the company name and domain', () => {
    const row = toHqRow(
      { key: 'd:contoso.com', company: 'Contoso', domain: 'contoso.com', people: [person('Contoso')] },
      'c1',
    )
    expect(row).toEqual({ ref: 'c1', company: 'Contoso', domain: 'contoso.com' })
    const est = estimateHqCost('openai/gpt-oss-120b', [{ key: 'n:x', company: 'X', people: [] }])
    expect(est.low).toBeGreaterThan(0)
    expect(est.high).toBeGreaterThan(est.low)
  })
})

describe('location filters', () => {
  const cond = (field: Condition['field'], op: Condition['op'], value?: string): FilterGroup => ({
    combinator: 'and',
    items: [{ id: 'x', kind: 'condition', field, op, value }],
  })
  const local = person('A', { location: { value: 'Boston, MA', origin: 'manual' } })
  const hqBoston = person('B', {
    companyHq: hq('Cambridge, Massachusetts, United States', { metro: 'Greater Boston' }),
  })
  const hqElsewhere = person('C', { companyHq: hq('Austin, Texas, United States') })
  const unknownHq = person('D', { companyHq: { status: 'unknown', origin: 'ai', at: '' } })
  const all = [local, hqBoston, hqElsewhere, unknownHq]
  const run = (f: FilterGroup) => {
    const pred = compileFilter(f, { packs: new Map() })!
    return all.filter((c) => pred(c)).map((c) => c.id)
  }

  it('"Location or company HQ" matches either one, including the metro area', () => {
    expect(run(cond('anyLocation', 'contains', 'boston'))).toEqual([local.id, hqBoston.id])
    expect(run(cond('anyLocation', 'not_contains', 'boston'))).toEqual([hqElsewhere.id, unknownHq.id])
    expect(run(cond('anyLocation', 'is_empty'))).toEqual([unknownHq.id])
  })

  it('"Company HQ" only looks at the company', () => {
    expect(run(cond('companyHq', 'contains', 'Boston'))).toEqual([hqBoston.id])
    expect(run(cond('companyHq', 'is_not_empty'))).toEqual([hqBoston.id, hqElsewhere.id])
    expect(hqText(unknownHq.companyHq)).toBeUndefined()
  })

  it('ships a Greater Boston built-in preset', () => {
    const boston = PRESETS.find((p) => p.key === 'boston')!
    const pred = compileFilter(boston.filter, { packs: new Map() })!
    expect(all.filter((c) => pred(c)).map((c) => c.id)).toEqual([local.id, hqBoston.id])
  })
})

describe('HQ elsewhere in the app', () => {
  it('is sent to scoring as a separate, weaker signal and exported with its source', () => {
    const c = person('B', {
      companyHq: hq('Cambridge, Massachusetts, United States', { metro: 'Greater Boston', confidence: 'medium' }),
    })
    expect(toScoringRow(c, 'r1').company_hq).toBe('Cambridge, Massachusetts, United States · Greater Boston')
    const row = toExportRow(c, { skillTerms: [], includeNotes: false, includeEmail: false })
    expect(row.companyHq).toBe('Cambridge, Massachusetts, United States · Greater Boston')
    expect(row.companyHqSource).toBe('AI-inferred (medium)')
  })

  it('is dropped when a re-import shows the person changed company', () => {
    const before = person('Contoso Inc', { companyHq: hq('Redmond') })
    expect(mergeContact(before, { ...before, company: 'Contoso' }).companyHq).toBeDefined()
    expect(mergeContact(before, { ...before, company: 'Fabrikam' }).companyHq).toBeUndefined()
  })
})

describe('saving HQs', () => {
  beforeEach(async () => {
    await db.contacts.clear()
  })

  it('never lets an AI answer overwrite one you typed', async () => {
    const typed = person('Contoso', { companyHq: hq('Boston', { origin: 'manual' }) })
    const plain = person('Contoso')
    await db.contacts.bulkPut([typed, plain])
    await saveHq([typed.id, plain.id], hq('Redmond'))
    expect((await db.contacts.get(typed.id))?.companyHq?.value).toBe('Boston')
    expect((await db.contacts.get(plain.id))?.companyHq?.value).toBe('Redmond')
  })

  it('applies a typed HQ to everyone at the company, and clears it again', async () => {
    const a = person('Contoso, Inc.')
    const b = person('contoso')
    const other = person('Fabrikam')
    await db.contacts.bulkPut([a, b, other])
    expect(await setManualHq(a, 'Boston, MA')).toBe(2)
    expect((await db.contacts.get(b.id))?.companyHq).toMatchObject({ value: 'Boston, MA', origin: 'manual' })
    expect((await db.contacts.get(other.id))?.companyHq).toBeUndefined()
    await setManualHq(a, '')
    expect((await db.contacts.get(b.id))?.companyHq).toBeUndefined()
  })

  it('adds the Greater Boston preset to the database', async () => {
    expect(await db.presets.get(builtInPresetId('boston'))).toBeDefined()
  })
})

describe('runHqLookup', () => {
  it('waits and retries when the provider rate-limits, then saves the answers', async () => {
    await db.contacts.clear()
    const a = person('Wayfair')
    await db.contacts.put(a)
    const { runHqLookup } = await import('../src/lib/ai/run-company-hq')
    const provider = await import('../src/lib/ai/provider')
    const { vi } = await import('vitest')
    let calls = 0
    const spy = vi.spyOn(provider, 'hqBatch').mockImplementation(async () => {
      if (++calls === 1) throw new provider.AiError('slow down', 'rate')
      return {
        output: {
          results: [
            {
              ref: 'c1',
              status: 'found',
              city: 'Boston',
              region: 'Massachusetts',
              country: 'United States',
              metro: 'Greater Boston',
              confidence: 'high',
            },
          ],
        },
        usage: { input_tokens: 10, output_tokens: 10 },
        servedBy: 'openai/gpt-oss-120b',
      }
    })
    const waits: number[] = []
    const summary = await runHqLookup({
      apiKey: 'k',
      model: 'openai/gpt-oss-120b',
      effort: 'low',
      plan: planHqLookup([a], [a]),
      signal: new AbortController().signal,
      onProgress: (p) => p.waitingSeconds !== undefined && waits.push(p.waitingSeconds),
      rateWaitsMs: [1],
    })
    spy.mockRestore()
    expect(calls).toBe(3) // rate-limited, retried, then asked again to confirm
    expect(waits).toEqual([0])
    expect(summary).toMatchObject({ found: 1, failed: 0, done: 1 })
    expect((await db.contacts.get(a.id))?.companyHq?.metro).toBe('Greater Boston')
  })
})

describe('double-checking medium answers', () => {
  const answer = (city: string, confidence: 'high' | 'medium') => ({
    results: [
      { ref: 'c1', status: 'found' as const, city, region: null, country: 'United States', metro: null, confidence },
    ],
  })

  async function run(first: ReturnType<typeof answer>, second?: ReturnType<typeof answer>) {
    await db.contacts.clear()
    const a = person('Enactor')
    await db.contacts.put(a)
    const { runHqLookup } = await import('../src/lib/ai/run-company-hq')
    const provider = await import('../src/lib/ai/provider')
    const { vi } = await import('vitest')
    const replies = [first, second]
    let calls = 0
    const spy = vi.spyOn(provider, 'hqBatch').mockImplementation(async () => ({
      output: replies[calls++]!,
      usage: { input_tokens: 1, output_tokens: 1 },
      servedBy: 'openai/gpt-oss-120b',
    }))
    const summary = await runHqLookup({
      apiKey: 'k',
      model: 'openai/gpt-oss-120b',
      effort: 'low',
      plan: planHqLookup([a], [a]),
      signal: new AbortController().signal,
      onProgress: () => {},
    })
    spy.mockRestore()
    return { summary, calls, saved: (await db.contacts.get(a.id))?.companyHq }
  }

  it('asks again about every place it finds, even high-confidence ones', async () => {
    const { calls, saved } = await run(answer('Boston', 'high'), answer('Boston', 'high'))
    expect(calls).toBe(2)
    expect(saved?.value).toBe('Boston, United States')
    const differ = await run(answer('Boston', 'high'), answer('San Diego', 'high'))
    expect(differ.saved?.status).toBe('unknown')
  })

  it('keeps an answer only when asking again agrees', async () => {
    const agree = await run(answer('Boston', 'medium'), answer('Boston', 'high'))
    expect(agree.calls).toBe(2)
    expect(agree.saved).toMatchObject({ status: 'found', value: 'Boston, United States' })

    const differ = await run(answer('Boston', 'medium'), answer('Dallas', 'medium'))
    expect(differ.saved?.status).toBe('unknown')
    expect(differ.summary).toMatchObject({ rejected: 1, found: 0, unknown: 1 })
  })
})

describe('clearAiHq', () => {
  it('removes AI answers but keeps typed ones', async () => {
    const { clearAiHq } = await import('../src/lib/company-hq-store')
    await db.contacts.clear()
    const ai = person('Kyriba', { companyHq: hq('Boston') })
    const unknown = person('Rootcode', { companyHq: { status: 'unknown', origin: 'ai', at: '' } })
    const typed = person('1 Billion Tech', { companyHq: hq('Colombo', { origin: 'manual' }) })
    await db.contacts.bulkPut([ai, unknown, typed])
    await clearAiHq([ai.id, unknown.id, typed.id])
    expect((await db.contacts.get(ai.id))?.companyHq).toBeUndefined()
    expect((await db.contacts.get(unknown.id))?.companyHq).toBeUndefined()
    expect((await db.contacts.get(typed.id))?.companyHq?.value).toBe('Colombo')
  })
})
