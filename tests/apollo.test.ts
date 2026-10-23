import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleApollo } from '../api/_apollo'
import { classifyTitle } from '../src/lib/classify-title'
import { db } from '../src/lib/db'
import { appDb } from '../src/lib/app-db'
import { applyApollo, toApolloCache, toPhoneNumbers } from '../src/lib/apollo/apply'
import { apolloFailure, matchDetails, type ApolloPersonRaw } from '../src/lib/apollo/client'
import { apolloCreditsThisMonth, resumePhones, runApolloMatch, runApolloPhones } from '../src/lib/apollo/run'
import { compileFilter } from '../src/lib/filters/engine'
import type { FilterGroup } from '../src/lib/filters/schema'
import type { Contact } from '../src/lib/schemas'

const KEY = 'apollo_test_key_1234567890'

let seq = 0
function person(extra: Partial<Contact> = {}): Contact {
  const n = ++seq
  return {
    id: `a${n}`,
    firstName: 'Ana',
    lastName: `Person${n}`,
    fullName: `Ana Person${n}`,
    company: 'Kyriba',
    position: 'CIO',
    profileUrl: `https://www.linkedin.com/in/ana-${n}`,
    source: 'linkedin_export',
    importedAt: '',
    updatedAt: '',
    status: 'new',
    tags: [],
    ...classifyTitle('CIO'),
    ...extra,
  }
}

const RAW: ApolloPersonRaw = {
  id: 'p1',
  match_confidence: 'high',
  email: 'Ana@Kyriba.com',
  email_status: 'verified',
  city: 'Boston',
  state: 'Massachusetts',
  country: 'United States',
  organization: {
    name: 'Kyriba',
    primary_domain: 'kyriba.com',
    city: 'San Diego',
    state: 'California',
    country: 'United States',
    industry: 'financial services',
    estimated_num_employees: 900,
    technology_names: ['Salesforce', 'Microsoft Dynamics 365', 'Azure'],
  },
}

describe('the /api/apollo forwarding function', () => {
  const req = (body: unknown, init: RequestInit = {}) =>
    new Request('http://x/api/apollo', {
      method: 'POST',
      headers: { 'x-apollo-key': KEY },
      body: JSON.stringify(body),
      ...init,
    })

  it('forwards only the allowed calls, with the key as Apollo expects', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), init }
      return new Response('{"matches":[]}', { status: 200 })
    }) as unknown as typeof fetch
    const res = await handleApollo(
      req({
        path: 'people/bulk_match',
        query: { reveal_phone_number: 'true', poll_only: 'true' },
        body: { details: [] },
      }),
      fetchImpl,
    )
    expect(res.status).toBe(200)
    expect(seen?.url).toBe('https://api.apollo.io/api/v1/people/bulk_match?reveal_phone_number=true&poll_only=true')
    expect((seen?.init.headers as Record<string, string>)['x-api-key']).toBe(KEY)
    expect(seen?.init.body).toBe('{"details":[]}')
  })

  it('refuses anything else', async () => {
    const never = (async () => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch
    expect((await handleApollo(new Request('http://x', { method: 'GET' }), never)).status).toBe(405)
    expect((await handleApollo(req({ path: 'people/bulk_match' }, { headers: {} }), never)).status).toBe(401)
    expect((await handleApollo(req({ path: 'contacts' }), never)).status).toBe(400)
    expect((await handleApollo(req({ path: '../../evil' }), never)).status).toBe(400)
    expect((await handleApollo(req({ path: 'webhook_result/abc' }), never)).status).toBe(400)
    expect(
      (await handleApollo(req({ path: 'people/bulk_match', query: { webhook_url: 'https://evil' } }), never)).status,
    ).toBe(400)
  })

  it('passes Apollo errors through', async () => {
    const fetchImpl = (async () =>
      new Response('{"error":"Invalid access credentials."}', { status: 401 })) as unknown as typeof fetch
    const res = await handleApollo(req({ path: 'webhook_result/-123' }), fetchImpl)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid access credentials.' })
  })
})

describe('mapping Apollo answers', () => {
  it('keeps the fields the columns use', () => {
    expect(toApolloCache(RAW, 'now')).toEqual({
      matched: true,
      id: 'p1',
      confidence: 'high',
      email: 'ana@kyriba.com',
      emailStatus: 'verified',
      city: 'Boston',
      state: 'Massachusetts',
      country: 'United States',
      org: {
        name: 'Kyriba',
        domain: 'kyriba.com',
        city: 'San Diego',
        state: 'California',
        country: 'United States',
        industry: 'financial services',
        size: '900',
        technologies: ['Salesforce', 'Microsoft Dynamics 365', 'Azure'],
      },
      at: 'now',
    })
    expect(toApolloCache(null, 'now')).toEqual({ matched: false, at: 'now' })
  })

  it('fills location, HQ, website, industry and size — never replacing what you typed or imported', () => {
    const cache = toApolloCache(RAW, 'now')
    const fresh = applyApollo(
      person({ companyHq: { status: 'found', value: 'Boston', origin: 'ai', at: '' } }),
      cache,
      'now',
    )
    expect(fresh.location).toEqual({ value: 'Boston, Massachusetts, United States', origin: 'enriched' })
    expect(fresh.companyHq).toMatchObject({
      value: 'San Diego, California, United States',
      origin: 'provider',
      source: 'Apollo',
    })
    expect(fresh.enrichment).toMatchObject({
      website: 'https://kyriba.com',
      industry: 'financial services',
      companySize: '900',
    })

    const typed = applyApollo(
      person({
        location: { value: 'Colombo', origin: 'manual' },
        companyHq: { status: 'found', value: 'Waltham', origin: 'import', at: '' },
        enrichment: { website: 'https://kyriba.io', source: 'mine.csv', updatedAt: '' },
      }),
      cache,
      'now',
    )
    expect(typed.location?.value).toBe('Colombo')
    expect(typed.companyHq?.value).toBe('Waltham')
    expect(typed.enrichment?.website).toBe('https://kyriba.io')
  })

  it('sends Apollo the LinkedIn URL, name, company and known domain', () => {
    expect(
      matchDetails(person({ enrichment: { website: 'https://www.kyriba.com/x', source: '', updatedAt: '' } })),
    ).toMatchObject({
      linkedin_url: expect.stringContaining('linkedin.com/in/'),
      first_name: 'Ana',
      organization_name: 'Kyriba',
      domain: 'kyriba.com',
    })
  })

  it('orders phones mobile first, drops duplicates and invalid ones', () => {
    expect(
      toPhoneNumbers([
        { sanitized_number: '+15550001', type_cd: 'work_hq' },
        { sanitized_number: '+15550002', type_cd: 'mobile' },
        { sanitized_number: '+15550002', type_cd: 'mobile' },
        { sanitized_number: '+15550003', type_cd: 'other', status_cd: 'invalid_number' },
      ]),
    ).toEqual([
      { number: '+15550002', type: 'mobile' },
      { number: '+15550001', type: 'work_hq' },
    ])
  })

  it('explains Apollo errors plainly', () => {
    expect(apolloFailure(401, {}).kind).toBe('auth')
    expect(apolloFailure(422, { error: 'You have insufficient credits' }).kind).toBe('credits')
    expect(apolloFailure(403, { error: 'api access' }).kind).toBe('plan')
    expect(apolloFailure(429, {}).kind).toBe('rate')
  })
})

describe('running Apollo columns', () => {
  const realFetch = globalThis.fetch
  let calls: Array<{ path: string; query?: Record<string, string>; body?: { details: unknown[] } }> = []

  function mockApollo(respond: (req: (typeof calls)[number]) => { status: number; body: unknown }) {
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body))
      calls.push(req)
      const r = respond(req)
      return new Response(JSON.stringify(r.body), { status: r.status })
    }) as typeof fetch
  }

  beforeEach(async () => {
    calls = []
    await db.contacts.clear()
    await appDb.settings.delete('apolloUsage')
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const run = { key: KEY, signal: new AbortController().signal, onProgress: () => {}, waitsMs: [1], pollLimitMs: 2000 }

  it('looks people up 10 at a time and saves each batch, counting credits', async () => {
    const people = Array.from({ length: 12 }, () => person())
    await db.contacts.bulkPut(people)
    mockApollo((req) => ({
      status: 200,
      body: {
        matches: req.body!.details.map((_, i) => (i === 0 ? null : RAW)),
        credits_consumed: req.body!.details.length - 1,
      },
    }))
    const summary = await runApolloMatch({ ...run, people })
    expect(calls.map((c) => c.body!.details.length)).toEqual([10, 2])
    expect(summary).toMatchObject({ matched: 10, notMatched: 2, failed: 0, credits: 10 })
    expect(await apolloCreditsThisMonth()).toBe(10)
    expect((await db.contacts.get(people[0].id))?.apollo).toMatchObject({ matched: false })
    expect((await db.contacts.get(people[1].id))?.apollo?.email).toBe('ana@kyriba.com')
  })

  it('stops at once when the key is rejected', async () => {
    const people = Array.from({ length: 15 }, () => person())
    await db.contacts.bulkPut(people)
    mockApollo(() => ({ status: 401, body: { error: 'Invalid access credentials.' } }))
    const summary = await runApolloMatch({ ...run, people })
    expect(calls).toHaveLength(1)
    expect(summary.stopped).toMatch(/didn't accept that API key/)
  })

  it('waits and retries when rate-limited', async () => {
    const people = [person()]
    await db.contacts.bulkPut(people)
    let n = 0
    mockApollo(() =>
      ++n === 1 ? { status: 429, body: {} } : { status: 200, body: { matches: [RAW], credits_consumed: 1 } },
    )
    const summary = await runApolloMatch({ ...run, people })
    expect(n).toBe(2)
    expect(summary.matched).toBe(1)
  })

  it('requests phones, then polls until Apollo delivers them', async () => {
    const people = [person(), person()]
    await db.contacts.bulkPut(people)
    let polls = 0
    mockApollo((req) => {
      if (req.path === 'people/bulk_match') {
        expect(req.query).toEqual({ reveal_phone_number: 'true', poll_only: 'true' })
        return { status: 200, body: { matches: [RAW, null], credits_consumed: 1, request_id: -42 } }
      }
      expect(req.path).toBe('webhook_result/-42')
      return ++polls === 1
        ? { status: 404, body: { error_code: 'result_pending', retry_after_seconds: 0 } }
        : {
            status: 200,
            body: {
              webhook_result: {
                people: [{ id: 'p1', phone_numbers: [{ sanitized_number: '+15550002', type_cd: 'mobile' }] }],
              },
            },
          }
    })
    const summary = await runApolloPhones({ ...run, people, pollLimitMs: 60_000 })
    expect(polls).toBe(2)
    expect(summary).toMatchObject({ phonesFound: 1, phonesPending: 0 })
    expect((await db.contacts.get(people[0].id))?.phone).toMatchObject({
      status: 'found',
      numbers: [{ number: '+15550002', type: 'mobile' }],
    })
    expect((await db.contacts.get(people[1].id))?.phone?.status).toBe('not_found')
  }, 15_000)

  it('can check pending phones again later', async () => {
    const waiting = person({
      apollo: { matched: true, id: 'p1', at: '' },
      phone: { status: 'pending', requestId: '77', at: '' },
    })
    await db.contacts.put(waiting)
    mockApollo(() => ({ status: 200, body: { webhook_result: { people: [{ id: 'p1', phone_numbers: [] }] } } }))
    const summary = await resumePhones({ ...run, people: [waiting] })
    expect(summary.phonesPending).toBe(0)
    expect((await db.contacts.get(waiting.id))?.phone?.status).toBe('not_found')
  })
})

describe('filtering on enriched data', () => {
  const withData = applyApollo(person(), toApolloCache(RAW, 'now'), 'now')
  const withPhone: Contact = { ...withData, phone: { status: 'found', numbers: [{ number: '+15550002' }], at: '' } }
  const plain = person()
  const run = (f: FilterGroup) => {
    const pred = compileFilter(f, { packs: new Map() })!
    return [withPhone, plain].filter((c) => pred(c)).map((c) => c.id)
  }
  const cond = (field: string, op: string, value?: unknown): FilterGroup =>
    ({ combinator: 'and', items: [{ id: 'x', kind: 'condition', field, op, value }] }) as FilterGroup

  it('finds companies by technology, and people with a work email or phone', () => {
    expect(run(cond('technologies', 'has_any_word', ['Dynamics 365']))).toEqual([withPhone.id])
    expect(run(cond('workEmail', 'is_not_empty'))).toEqual([withPhone.id])
    expect(run(cond('phone', 'is_empty'))).toEqual([plain.id])
  })
})
