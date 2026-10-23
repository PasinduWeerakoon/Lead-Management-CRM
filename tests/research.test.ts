import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertPublicHost,
  fetchJobs,
  findAtsBoards,
  jobPostingsFromHtml,
  htmlToText,
  isPrivateAddress,
  robotsAllows,
  siteMatchesCompany,
} from '../api/_research'
import { classifyTitle } from '../src/lib/classify-title'
import { db } from '../src/lib/db'
import { cleanDomain, validateExtract } from '../src/lib/research/extract'
import { applyResearch, planResearch, runResearch } from '../src/lib/research/run'
import { toScoringRow } from '../src/lib/ai/scoring'
import type { Contact } from '../src/lib/schemas'

let seq = 0
const person = (company: string, extra: Partial<Contact> = {}): Contact => ({
  id: `r${++seq}`,
  firstName: 'A',
  lastName: String(seq),
  fullName: `A ${seq}`,
  company,
  position: 'CIO',
  source: 'linkedin_export',
  importedAt: '',
  updatedAt: '',
  status: 'new',
  tags: [],
  ...classifyTitle('CIO'),
  ...extra,
})

describe('reading websites safely', () => {
  it('refuses private, internal and IP addresses', async () => {
    for (const ip of [
      '10.0.0.1',
      '127.0.0.1',
      '192.168.1.5',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateAddress(ip)).toBe(true)
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
    const resolveTo = (address: string) => (async () => [{ address, family: 4 }]) as never
    await expect(assertPublicHost('evil.example.com', resolveTo('127.0.0.1'))).rejects.toThrow()
    await expect(assertPublicHost('localhost', resolveTo('93.184.216.34'))).rejects.toThrow()
    await expect(assertPublicHost('1.2.3.4', resolveTo('1.2.3.4'))).rejects.toThrow()
    await expect(assertPublicHost('contoso.com', resolveTo('93.184.216.34'))).resolves.toBeUndefined()
  })

  it('follows robots.txt, including wildcards', () => {
    const robots =
      'User-agent: *\nDisallow: /*?\nDisallow: /admin/\nAllow: /core/*.css$\nDisallow: /core/\n\nUser-agent: OtherBot\nDisallow: /'
    expect(robotsAllows(robots, '/')).toBe(true)
    expect(robotsAllows(robots, '/about')).toBe(true)
    expect(robotsAllows(robots, '/search?q=x')).toBe(false)
    expect(robotsAllows(robots, '/admin/x')).toBe(false)
    expect(robotsAllows(robots, '/core/site.css')).toBe(true)
    expect(robotsAllows(robots, '/core/site.js')).toBe(false)
    expect(robotsAllows('User-agent: *\nDisallow: /', '/about')).toBe(false)
  })

  it('turns pages into plain text, finds job boards, and checks the site belongs to the company', () => {
    const html = `<html><head><title>Contoso Bank | Home</title><style>.x{}</style></head><body><script>evil()</script>
      <h1>Contoso Bank</h1><p>Headquartered in Colombo &amp; Kandy.</p>
      <a href="https://boards.greenhouse.io/contosobank">Careers</a> <a href="https://jobs.lever.co/contoso-labs/123">Labs</a></body></html>`
    const { title, text } = htmlToText(html)
    expect(title).toBe('Contoso Bank | Home')
    expect(text).toContain('Headquartered in Colombo & Kandy.')
    expect(text).not.toContain('evil')
    expect(findAtsBoards(html)).toEqual([
      { ats: 'greenhouse', slug: 'contosobank' },
      { ats: 'lever', slug: 'contoso-labs' },
    ])
    expect(siteMatchesCompany('Contoso Bank PLC', { title, pages: [{ url: 'u', title, text }] })).toBe(true)
    expect(siteMatchesCompany('Fabrikam Holdings', { title, pages: [{ url: 'u', title, text }] })).toBe(false)
  })

  it('reads open roles from job-board APIs', async () => {
    const fake = (body: unknown) =>
      (async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch
    // The host check needs DNS; these public APIs resolve normally.
    const gh = await fetchJobs(
      { ats: 'greenhouse', slug: 'figma' },
      fake({
        jobs: [
          {
            title: 'Dynamics 365 Developer',
            absolute_url: 'https://x/1',
            location: { name: 'Remote' },
            updated_at: '2026-10-01',
          },
        ],
      }),
    )
    expect(gh).toEqual([
      {
        title: 'Dynamics 365 Developer',
        url: 'https://x/1',
        location: 'Remote',
        postedAt: '2026-10-01',
        source: 'Greenhouse',
      },
    ])
    const lever = await fetchJobs(
      { ats: 'lever', slug: 'figma' },
      fake([{ text: 'ERP Manager', hostedUrl: 'https://y/2', categories: { location: 'Boston' } }]),
    )
    expect(lever[0]).toMatchObject({ title: 'ERP Manager', location: 'Boston', source: 'Lever' })
  }, 20_000)
})

describe('keeping only facts the pages back up', () => {
  const pages = [
    { url: 'https://contoso.lk/', title: 'Contoso', text: 'Contoso runs on Microsoft Dynamics 365 and Power BI.' },
    { url: 'https://contoso.lk/contact', title: 'Contact', text: 'Head office: 12 Galle Road, Colombo 03, Sri Lanka.' },
  ]
  const jobs = [{ title: 'Dynamics 365 Functional Consultant', url: 'https://jobs/1', source: 'Lever' }]

  it('drops facts whose quote isn’t on the cited page, and roles that weren’t listed', () => {
    const { facts, dropped } = validateExtract(
      {
        hq: { value: 'Colombo, Sri Lanka', url: 'https://contoso.lk/contact', quote: '12 Galle Road, Colombo 03' },
        industry: { value: 'Banking', url: 'https://contoso.lk/', quote: 'leading bank in Asia' },
        size: null,
        technologies: [
          { name: 'Microsoft Dynamics 365', url: 'https://contoso.lk/', quote: 'Microsoft Dynamics 365' },
          { name: 'SAP', url: 'https://contoso.lk/', quote: 'SAP S/4HANA' },
          { name: 'Power BI', url: 'https://other.com/', quote: 'Power BI' },
        ],
        hiring: ['Dynamics 365 Functional Consultant', 'Chief Wizard'],
        summary: 'A company on Dynamics 365.',
      },
      pages,
      jobs,
    )
    expect(facts.hq?.value).toBe('Colombo, Sri Lanka')
    expect(facts.industry).toBeUndefined()
    expect(facts.technologies?.map((t) => t.name)).toEqual(['Microsoft Dynamics 365'])
    expect(facts.hiring).toEqual([
      { title: 'Dynamics 365 Functional Consultant', url: 'https://jobs/1', source: 'Lever' },
    ])
    expect(dropped).toBe(4)
  })

  it('cleans suggested domains', () => {
    expect(cleanDomain('https://www.Contoso.lk/about')).toBe('contoso.lk')
    expect(cleanDomain('not a domain')).toBeUndefined()
    expect(cleanDomain('localhost')).toBeUndefined()
  })
})

describe('saving research', () => {
  const research = {
    status: 'found' as const,
    domain: 'contoso.lk',
    siteUrl: 'https://contoso.lk/',
    verified: true,
    hq: { value: 'Colombo, Sri Lanka', url: 'https://contoso.lk/contact', quote: 'Colombo 03' },
    industry: { value: 'Banking', url: 'https://contoso.lk/', quote: 'bank' },
    technologies: [{ name: 'Microsoft Dynamics 365', url: 'https://contoso.lk/', quote: 'Dynamics 365' }],
    hiring: [{ title: 'Dynamics 365 Functional Consultant' }],
    jobsTotal: 12,
    summary: 'A bank modernising on Dynamics 365.',
    at: 'now',
  }

  it('fills empty fields only, and replaces only an AI-guessed HQ', () => {
    const empty = applyResearch(
      person('Contoso', { companyHq: { status: 'found', value: 'Kandy', origin: 'ai', at: '' } }),
      research,
    )
    expect(empty.enrichment).toMatchObject({ website: 'https://contoso.lk', industry: 'Banking' })
    expect(empty.companyHq).toMatchObject({
      value: 'Colombo, Sri Lanka',
      origin: 'web',
      source: 'https://contoso.lk/contact',
    })

    const typed = applyResearch(
      person('Contoso', {
        companyHq: { status: 'found', value: 'Galle', origin: 'manual', at: '' },
        enrichment: { website: 'https://contoso.com', source: 'mine', updatedAt: '' },
      }),
      research,
    )
    expect(typed.companyHq?.value).toBe('Galle')
    expect(typed.enrichment?.website).toBe('https://contoso.com')
  })

  it('gives AI scoring the findings as verified company facts', () => {
    const row = toScoringRow(applyResearch(person('Contoso'), research), 'r1')
    expect(row).toMatchObject({
      company_website: 'contoso.lk',
      company_technologies: 'Microsoft Dynamics 365',
      company_hiring: 'Dynamics 365 Functional Consultant (12 open roles in total)',
    })
  })

  it('researches each company once, for everyone who works there', () => {
    const a = person('Contoso Inc')
    const b = person('contoso')
    const c = person('Fabrikam', { research: { status: 'no_site', at: '' } })
    const plan = planResearch([a, b, c])
    expect(plan.companies).toHaveLength(1)
    expect(plan.companies[0].people.map((p) => p.id)).toEqual([a.id, b.id])
    expect(planResearch([a, b, c], true).companies).toHaveLength(2)
  })
})

describe('a research run', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  beforeEach(async () => {
    await db.contacts.clear()
  })

  it('finds and checks the website, reads it, keeps cited facts and saves them for colleagues', async () => {
    const a = person('Contoso Bank')
    const b = person('Contoso Bank PLC')
    const unknown = person('Tiny Startup')
    await db.contacts.bulkPut([a, b, unknown])
    const site = {
      ok: true,
      url: 'https://contoso.lk/',
      title: 'Contoso Bank',
      matchesCompany: true,
      blocked: [],
      jobs: [{ title: 'ERP Manager', source: 'Lever' }],
      pages: [
        {
          url: 'https://contoso.lk/',
          title: 'Contoso Bank',
          text: 'Contoso Bank. Head office in Colombo, Sri Lanka. We use Microsoft Dynamics 365.',
        },
      ],
    }
    const chat = (content: unknown) =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 },
        }),
        { status: 200 },
      )
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (url === '/api/research') {
        const { domain } = JSON.parse(String(init.body))
        return new Response(
          JSON.stringify(
            domain === 'contoso.lk' ? site : { ok: false, pages: [], jobs: [], blocked: [], matchesCompany: false },
          ),
          { status: 200 },
        )
      }
      const body = JSON.parse(String(init.body))
      if (body.response_format.json_schema.name === 'company_domains')
        return chat({
          results: [
            { ref: 'c0', domains: ['contoso.lk'] },
            { ref: 'c1', domains: [] },
          ],
        })
      return chat({
        hq: { value: 'Colombo, Sri Lanka', url: 'https://contoso.lk/', quote: 'Head office in Colombo' },
        industry: null,
        size: null,
        technologies: [{ name: 'Microsoft Dynamics 365', url: 'https://contoso.lk/', quote: 'Microsoft Dynamics 365' }],
        hiring: ['ERP Manager'],
        summary: 'A bank using Dynamics 365.',
      })
    }) as typeof fetch

    const { companies } = planResearch([a, b, unknown])
    const summary = await runResearch({
      apiKey: 'gsk_test_key_0123456789abcdef',
      model: 'openai/gpt-oss-120b',
      effort: 'low',
      companies,
      signal: new AbortController().signal,
      onProgress: () => {},
      waitsMs: [1],
    })
    expect(summary).toMatchObject({ found: 1, noSite: 1, failed: 0 })
    for (const id of [a.id, b.id]) {
      const saved = await db.contacts.get(id)
      expect(saved?.research).toMatchObject({ status: 'found', domain: 'contoso.lk', verified: true, jobsTotal: 1 })
      expect(saved?.research?.hiring).toEqual([{ title: 'ERP Manager', source: 'Lever' }])
      expect(saved?.companyHq).toMatchObject({ value: 'Colombo, Sri Lanka', origin: 'web' })
      expect(saved?.enrichment?.website).toBe('https://contoso.lk')
    }
    expect((await db.contacts.get(unknown.id))?.research?.status).toBe('no_site')
  })
})

describe('research retries', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  it('waits and retries when the AI connection drops, instead of stopping', async () => {
    await db.contacts.clear()
    const a = person('Contoso Bank', { enrichment: { website: 'https://contoso.lk', source: 'x', updatedAt: '' } })
    await db.contacts.put(a)
    let aiCalls = 0
    globalThis.fetch = (async (url: string) => {
      if (url === '/api/research')
        return new Response(
          JSON.stringify({
            ok: true,
            url: 'https://contoso.lk/',
            title: 'Contoso',
            matchesCompany: true,
            blocked: [],
            jobs: [],
            pages: [{ url: 'https://contoso.lk/', title: 'Contoso', text: 'Contoso Bank' }],
          }),
          { status: 200 },
        )
      if (++aiCalls === 1) throw new TypeError('Failed to fetch')
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  hq: null,
                  industry: null,
                  size: null,
                  technologies: [],
                  hiring: [],
                  summary: 'A bank.',
                }),
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const summary = await runResearch({
      apiKey: 'gsk_test_key_0123456789abcdef',
      model: 'openai/gpt-oss-120b',
      effort: 'low',
      companies: planResearch([a]).companies,
      signal: new AbortController().signal,
      onProgress: () => {},
      waitsMs: [1],
    })
    expect(aiCalls).toBe(2)
    expect(summary).toMatchObject({ found: 1, failed: 0 })
  })
})

describe('research shows up in the regular columns', () => {
  it('counts website technologies in the Technologies column, filter and export', async () => {
    const { companyTechnologies } = await import('../src/lib/apollo/apply')
    const { compileFilter } = await import('../src/lib/filters/engine')
    const { toExportRow } = await import('../src/lib/export/rows')
    const c = person('Contoso', {
      apollo: { matched: true, org: { technologies: ['Azure', 'Salesforce'] }, at: '' },
      research: {
        status: 'found',
        technologies: [
          { name: 'azure', url: 'u', quote: 'q' },
          { name: 'Microsoft Dynamics 365', url: 'u', quote: 'q' },
        ],
        at: '',
      },
    })
    expect(companyTechnologies(c)).toEqual(['Azure', 'Salesforce', 'Microsoft Dynamics 365'])
    const pred = compileFilter(
      {
        combinator: 'and',
        items: [{ id: 'x', kind: 'condition', field: 'technologies', op: 'has_any_word', value: ['Dynamics 365'] }],
      },
      { packs: new Map() },
    )!
    expect(pred(c)).toBe(true)
    expect(toExportRow(c, { skillTerms: [], includeNotes: false, includeEmail: false }).technologies).toBe(
      'Azure, Salesforce, Microsoft Dynamics 365',
    )
  })
})

describe('more places jobs are found', () => {
  it('reads schema.org JobPosting data embedded in careers pages', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","title":"ERP Business Analyst","datePosted":"2026-10-05","url":"https://contoso.lk/jobs/1","jobLocation":{"@type":"Place","address":{"addressLocality":"Colombo","addressCountry":"LK"}}}]}</script>
      <script type="application/ld+json">not json</script>`
    expect(jobPostingsFromHtml(html, 'https://contoso.lk/careers')).toEqual([
      {
        title: 'ERP Business Analyst',
        location: 'Colombo, LK',
        url: 'https://contoso.lk/jobs/1',
        postedAt: '2026-10-05',
        source: 'Careers page',
      },
    ])
  })

  it('spots Workday, BambooHR, Breezy, Personio and Teamtailor boards', () => {
    const html = `<a href="https://contoso.wd5.myworkdayjobs.com/en-US/External">Jobs</a>
      <a href="https://contoso.bamboohr.com/careers">x</a> <a href="https://fabrikam.breezy.hr/">y</a>`
    expect(findAtsBoards(html)).toEqual([
      { ats: 'bamboohr', slug: 'contoso' },
      { ats: 'breezy', slug: 'fabrikam' },
      { ats: 'workday', slug: 'contoso.wd5.myworkdayjobs.com|contoso|External' },
    ])
    expect(
      findAtsBoards('<a href="https://acme.jobs.personio.de">a</a> <a href="https://acme.teamtailor.com/jobs">b</a>'),
    ).toEqual([
      { ats: 'personio', slug: 'acme' },
      { ats: 'teamtailor', slug: 'acme' },
    ])
  })

  it('gives AI scoring each opening with its date and source', () => {
    const row = toScoringRow(
      applyResearch(person('Contoso'), {
        status: 'found',
        hiring: [{ title: 'Dynamics 365 Functional Consultant', postedAt: '2026-10-05T10:00:00Z', source: 'Workday' }],
        at: '',
      }),
      'r1',
    )
    expect(row.company_hiring).toBe('Dynamics 365 Functional Consultant (posted 2026-10-05, Workday)')
  })
})
