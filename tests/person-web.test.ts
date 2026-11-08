import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateWeb, webUserMessage, type WebOutput } from '../src/lib/research/person'
import { mergeResearch, validateCompanyWeb, type CompanyWebOutput } from '../src/lib/research/company-web'
import { toScoringRow } from '../src/lib/ai/scoring'
import { keywordMatcher } from '../src/lib/keywords'
import { handleAi, WEB_SEARCH_USD } from '../api/_ai'
import { memorySpend, setSpendStore, spendDay, type SpendStore } from '../api/_spend'
import type { Contact } from '../src/lib/schemas'

const person: Contact = {
  id: 'p1',
  firstName: 'Alex',
  lastName: 'Perera',
  fullName: 'Alex Perera',
  company: 'Example Holdings',
  position: 'Chief Executive Officer',
  source: 'linkedin_export',
  importedAt: '2026-10-01',
  updatedAt: '2026-10-01',
  seniority: 'C-level',
  function: 'Executive',
  titleTags: [],
  status: 'new',
  tags: [],
}

const out = (o: Partial<WebOutput> = {}): WebOutput => ({
  match: 'confident',
  summary: 'CEO of Example Holdings, leading its digital transformation.',
  location: { value: 'Colombo, Sri Lanka', url: 'https://example.com/team' },
  career: [
    {
      company: 'Cambridge Technology Partners',
      role: 'Consultant',
      years: '1999–2003',
      url: 'https://example.com/team',
    },
    { company: 'Invented Co', role: null, years: null, url: 'https://made-up.example.net/' },
  ],
  keywords: ['Digital transformation', 'Fintech', 'digital transformation'],
  facts: [
    { text: 'Leads Example Holdings as CEO since 2019.', url: 'https://example.com/team' },
    { text: 'Spoke at a fintech summit in 2025.', url: 'https://news.example.org/summit/' },
  ],
  ...o,
})

const sources = ['https://www.example.com/team', 'https://news.example.org/summit', 'https://lk.linkedin.com/in/x']

describe('web research checks', () => {
  it('keeps facts from pages the search returned and dedupes keywords', () => {
    const w = validateWeb(out(), sources, 'gpt-6-luna', 'now')
    expect(w.status).toBe('found')
    expect(w.facts).toHaveLength(2)
    expect(w.location).toBe('Colombo, Sri Lanka')
    expect(w.keywords).toEqual(['Digital transformation', 'Fintech'])
  })

  it('drops LinkedIn, made-up pages and personal details', () => {
    const w = validateWeb(
      out({
        location: { value: 'Kandy', url: 'https://made-up.example.net/' },
        facts: [
          { text: 'Profile.', url: 'https://lk.linkedin.com/in/x' },
          { text: 'Invented.', url: 'https://made-up.example.net/' },
          { text: 'Email alex@example.com', url: 'https://example.com/team' },
          { text: 'Leads Example Holdings.', url: 'https://example.com/team' },
        ],
      }),
      sources,
      'gpt-6-luna',
    )
    expect(w.facts?.map((f) => f.text)).toEqual(['Leads Example Holdings.'])
    expect(w.location).toBeUndefined()
  })

  it('reports not found when nothing can be backed up', () => {
    expect(validateWeb(out({ match: 'not_found' }), sources, 'm').status).toBe('not_found')
    expect(validateWeb(out(), [], 'm').status).toBe('not_found')
  })

  it('never sends email, notes or the LinkedIn URL in the search', () => {
    const msg = webUserMessage({
      ...person,
      email: 'a@b.com',
      notes: 'secret',
      profileUrl: 'https://linkedin.com/in/a',
    })
    expect(msg).toContain('Alex Perera')
    expect(msg).not.toMatch(/a@b\.com|secret|linkedin/)
  })

  it('feeds findings into scoring and keywords', () => {
    const web = validateWeb(out(), sources, 'gpt-6-luna')
    const row = toScoringRow({ ...person, web }, 'r1')
    expect(row.person_keywords).toBe('Digital transformation, Fintech')
    expect(row.person_web_facts).toContain('fintech summit')
    expect(keywordMatcher(['Fintech'])({ ...person, web })).toEqual(['Fintech'])
  })
})

describe('/api/ai?op=search', () => {
  let store: SpendStore
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-company-key-0000000000'
    store = memorySpend()
    setSpendStore(store)
  })
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    setSpendStore(undefined)
  })

  const req = (body: unknown) =>
    new Request('https://app.test/api/ai?op=search', { method: 'POST', body: JSON.stringify(body) })

  it('forces web search, limits searches and counts their fee', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            output: [{ type: 'web_search_call' }, { type: 'web_search_call' }, { type: 'message' }],
            usage: { input_tokens: 10_000, output_tokens: 1_000 },
          }),
        ),
    )
    const res = await handleAi(
      req({
        model: 'gpt-6-luna',
        input: 'x',
        text: { format: {} },
        tools: [{ type: 'code_interpreter' }],
        max_tool_calls: 50,
      }),
      f,
    )
    expect(res.status).toBe(200)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const sent = JSON.parse(String(init.body)) as { tools: unknown; max_tool_calls: number }
    expect(sent.tools).toEqual([{ type: 'web_search' }])
    expect(sent.max_tool_calls).toBe(2)
    // 10k in × $0.1/M + 1k out × $0.5/M + 2 searches
    expect(await store.get(spendDay())).toBeCloseTo(0.001 + 0.0005 + 2 * WEB_SEARCH_USD, 6)
  })

  it('rejects a search without input', async () => {
    expect((await handleAi(req({ model: 'gpt-6-luna' }), vi.fn())).status).toBe(400)
  })
})

describe('past employers', () => {
  it('keeps employers backed by a returned page and feeds scoring', () => {
    const web = validateWeb(out(), sources, 'gpt-6-luna')
    expect(web.career?.map((j) => j.company)).toEqual(['Cambridge Technology Partners'])
    expect(toScoringRow({ ...person, web }, 'r1').person_career).toBe(
      'Cambridge Technology Partners, Consultant, 1999–2003',
    )
    expect(keywordMatcher(['Cambridge Technology Partners'])({ ...person, web })).toEqual([
      'Cambridge Technology Partners',
    ])
  })
})

describe('company web search', () => {
  const company = (o: Partial<CompanyWebOutput> = {}): CompanyWebOutput => ({
    found: true,
    website: 'https://www.example.lk/',
    hq: { value: 'Colombo, Sri Lanka', url: 'https://example.lk/contact' },
    industry: { value: 'Software services', url: 'https://example.lk/' },
    size: null,
    technologies: [{ name: 'AWS', url: 'https://example.lk/' }],
    hiring: [
      { title: 'Senior Full Stack Engineer', url: 'https://jobs.example.org/123', location: 'Colombo', postedAt: null },
      { title: 'QA Engineer', url: 'https://www.linkedin.com/jobs/view/1', location: null, postedAt: null },
      { title: 'DevOps Engineer', url: 'https://made-up.example.net/job', location: null, postedAt: null },
    ],
    summary: 'Builds software for banks.',
    ...o,
  })
  const found = [
    'https://example.lk/contact',
    'https://example.lk',
    'https://jobs.example.org/123',
    'https://www.linkedin.com/jobs/view/1',
  ]

  it('keeps only backed facts and never LinkedIn jobs', () => {
    const r = validateCompanyWeb(company(), found)!
    expect(r.domain).toBe('example.lk')
    expect(r.hq?.value).toBe('Colombo, Sri Lanka')
    expect(r.hiring?.map((j) => j.title)).toEqual(['Senior Full Stack Engineer'])
    expect(r.technologies?.map((t) => t.name)).toEqual(['AWS'])
  })

  it('returns nothing when the company is not found', () => {
    expect(validateCompanyWeb(company({ found: false }), found)).toBeUndefined()
  })

  it('lets site facts win and adds new roles from the web', () => {
    const web = validateCompanyWeb(company(), found)!
    const merged = mergeResearch(
      {
        domain: 'example.lk',
        hq: { value: 'Kandy', url: 'https://example.lk/a', quote: 'Kandy' },
        hiring: [{ title: 'QA Lead' }],
      },
      web,
    )
    expect(merged.hq?.value).toBe('Kandy')
    expect(merged.industry?.value).toBe('Software services')
    expect(merged.hiring?.map((j) => j.title)).toEqual(['QA Lead', 'Senior Full Stack Engineer'])
  })
})
