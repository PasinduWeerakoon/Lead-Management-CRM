import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/db'
import { classifyTitle } from '../src/lib/classify-title'
import { parseCsvText } from '../src/lib/csv'
import {
  autoMapEnrich,
  canMatch,
  commitEnrichment,
  hasData,
  normalizeWebsite,
  planEnrichment,
  saveManualEnrichment,
} from '../src/lib/enrich'
import { toExportRow } from '../src/lib/export/rows'
import { toScoringRow } from '../src/lib/ai/scoring'
import { compileFilter } from '../src/lib/filters/engine'
import type { Contact } from '../src/lib/schemas'

function person(id: string, fullName: string, company: string, extra: Partial<Contact> = {}): Contact {
  return {
    id,
    firstName: fullName.split(' ')[0],
    lastName: fullName.split(' ')[1] ?? '',
    fullName,
    company,
    position: 'CIO',
    source: 'linkedin_export',
    importedAt: '',
    updatedAt: '',
    status: 'new',
    tags: [],
    ...classifyTitle('CIO'),
    ...extra,
  }
}

const people = [
  person('a', 'Ana Example', 'Contoso', { profileUrl: 'https://www.linkedin.com/in/ana-example' }),
  person('b', 'Ben Sample', 'Fabrikam'),
  person('c', 'Sam Twin', 'Litware'),
  person('d', 'Sam Twin', 'Northwind'),
  person('e', 'Eve Manual', 'Contoso', { location: { value: 'Cambridge, MA', origin: 'manual' } }),
]

const APOLLO = `First Name,Last Name,Company Name,Person Linkedin Url,Website,Industry,# Employees,City
Ana,Example,Contoso,http://www.linkedin.com/in/ana-example,contoso.example,Retail,1000,Boston
Ben,Sample,Fabrikam,,https://www.fabrikam.example/about/,Manufacturing,201-500,Boston
Sam,Twin,,,twin.example,Software,50,Austin
Nobody,Here,Nowhere,,nowhere.example,Software,10,Paris
Eve,Manual,Contoso,,javascript:alert(1),Retail,1000,Boston
`

beforeEach(async () => {
  await db.contacts.clear()
  await db.contacts.bulkPut(people)
})

describe('column mapping', () => {
  it('recognises an Apollo-style export', () => {
    const t = parseCsvText(APOLLO)
    const m = autoMapEnrich(t.headers)
    expect(m).toEqual({
      profileUrl: 3,
      firstName: 0,
      lastName: 1,
      company: 2,
      website: 4,
      industry: 5,
      companySize: 6,
      location: 7,
    })
    expect(canMatch(m) && hasData(m)).toBe(true)
  })
})

describe('normalizeWebsite', () => {
  it.each([
    ['contoso.com', 'https://contoso.com'],
    ['http://www.Contoso.com/', 'https://www.contoso.com'],
    ['https://fabrikam.example/about/', 'https://fabrikam.example/about'],
    ['javascript:alert(1)', undefined],
    ['mailto:a@b.com', undefined],
    ['not a site', undefined],
    ['', undefined],
  ])('%s → %s', (raw, out) => expect(normalizeWebsite(raw)).toBe(out))
})

describe('planEnrichment', () => {
  it('matches by URL, then name+company, and refuses ambiguous names', () => {
    const t = parseCsvText(APOLLO)
    const plan = planEnrichment(t, autoMapEnrich(t.headers), people, 'apollo.csv', '2026-10-16')
    const byId = new Map(plan.updates.map((c) => [c.id, c]))

    expect(byId.get('a')).toMatchObject({
      enrichment: { website: 'https://contoso.example', industry: 'Retail', companySize: '1000', source: 'apollo.csv' },
      location: { value: 'Boston', origin: 'enriched' },
    })
    expect(byId.get('b')?.enrichment?.website).toBe('https://www.fabrikam.example/about')

    // A location you typed is kept; a dangerous "website" is dropped, other data still lands.
    expect(byId.get('e')?.location).toEqual({ value: 'Cambridge, MA', origin: 'manual' })
    expect(byId.get('e')?.enrichment).toMatchObject({ industry: 'Retail' })
    expect(byId.get('e')?.enrichment?.website).toBeUndefined()

    expect(plan.unmatched.map((u) => u.reason)).toEqual([
      '2 people share this name; add a company or LinkedIn URL column',
      'No one in your list matches',
    ])
    expect(plan.matched).toBe(3)
  })

  it('reports unchanged rows on a second import and saves updates', async () => {
    const t = parseCsvText(APOLLO)
    const m = autoMapEnrich(t.headers)
    const first = planEnrichment(t, m, people, 'apollo.csv')
    expect(await commitEnrichment(first)).toBe(3)
    const after = await db.contacts.toArray()
    const again = planEnrichment(t, m, after, 'apollo.csv')
    expect(again.updates).toHaveLength(0)
    expect(again.unchanged).toBe(3)
  })
})

describe('manual edits and downstream use', () => {
  it('validates websites typed by hand and clears empty data', async () => {
    const ana = (await db.contacts.get('a'))!
    expect(await saveManualEnrichment(ana, { website: 'not a site' })).toMatch(/doesn't look like/)
    expect(await saveManualEnrichment(ana, { website: 'contoso.com', industry: ' Retail ' })).toBeUndefined()
    let saved = (await db.contacts.get('a'))!
    expect(saved.enrichment).toMatchObject({ website: 'https://contoso.com', industry: 'Retail', source: 'manual' })
    await saveManualEnrichment(saved, { website: '', industry: '' })
    saved = (await db.contacts.get('a'))!
    expect(saved.enrichment).toBeUndefined()
  })

  it('feeds export, filters and AI scoring', () => {
    const c = person('x', 'Ana Example', 'Contoso', {
      enrichment: {
        website: 'https://contoso.example',
        industry: 'Retail',
        companySize: '1000',
        source: 'f.csv',
        updatedAt: '',
      },
    })
    const row = toExportRow(c, { skillTerms: [], includeNotes: false, includeEmail: false })
    expect(row).toMatchObject({ website: 'https://contoso.example', industry: 'Retail', companySize: '1000' })

    const pred = compileFilter(
      {
        combinator: 'and',
        items: [{ id: '1', kind: 'condition', field: 'industry', op: 'contains', value: 'retail' }],
      },
      { packs: new Map() },
    )!
    expect(pred(c)).toBe(true)

    expect(toScoringRow(c, 'r1')).toMatchObject({ industry: 'Retail', company_size: '1000' })
  })
})

describe('normalizeWebsite hardening', () => {
  it.each(['https://user:pass@evil.example', 'data:text/html,hi', 'ftp://files.example', 'contoso.com:8080x'])(
    'rejects %s',
    (raw) => expect(normalizeWebsite(raw)).toBeUndefined(),
  )
})

describe('company HQ in Company data imports', () => {
  const staff = [
    person('x1', 'Xi One', 'Virtusa Corp'),
    person('x2', 'Xi Two', 'Virtusa'),
    person('y1', 'Yu One', 'Seylan Bank PLC', {
      companyHq: { status: 'found', value: 'Kandy', origin: 'manual', at: '' },
    }),
    person('z1', 'Zed One', 'Contoso', { location: { value: 'Galle', origin: 'manual' } }),
  ]

  it('applies company-only rows to everyone at that company, marked as imported', () => {
    const t = parseCsvText(
      'Company,Company HQ,HQ metro area,Location\nVirtusa,"Southborough, Massachusetts, United States",Greater Boston,Nowhere\nUnknown Co,Colombo,,\n',
    )
    const mapping = autoMapEnrich(t.headers)
    expect(mapping).toMatchObject({ company: 0, companyHq: 1, hqMetro: 2, location: 3 })
    expect(canMatch(mapping) && hasData(mapping)).toBe(true)
    const plan = planEnrichment(t, mapping, staff, 'company-hq.csv', 'now')
    expect(plan.updates.map((c) => c.id).sort()).toEqual(['x1', 'x2'])
    expect(plan.updates[0].companyHq).toEqual({
      status: 'found',
      value: 'Southborough, Massachusetts, United States',
      metro: 'Greater Boston',
      origin: 'import',
      source: 'company-hq.csv',
      at: 'now',
    })
    // Location is about a person, so a company-only row never sets it.
    expect(plan.updates[0].location).toBeUndefined()
    expect(plan.unmatched).toEqual([
      { row: 2, label: 'Unknown Co', reason: 'No one in your list works at this company' },
    ])
  })

  it('never replaces an HQ you typed', () => {
    const t = parseCsvText('Company,Company HQ\nSeylan Bank PLC,Colombo\n')
    const plan = planEnrichment(t, autoMapEnrich(t.headers), staff, 'f.csv', 'now')
    expect(plan.updates).toHaveLength(0)
    expect(plan.unchanged).toBe(1)
  })

  it('keeps imported HQs when Find company HQ runs', async () => {
    const { saveHq } = await import('../src/lib/company-hq-store')
    await db.contacts.clear()
    await db.contacts.put(
      person('i1', 'Imp Orted', 'Virtusa', {
        companyHq: { status: 'found', value: 'Southborough', origin: 'import', at: '' },
      }),
    )
    await saveHq(['i1'], { status: 'found', value: 'Boston', origin: 'ai', at: '' })
    expect((await db.contacts.get('i1'))?.companyHq?.value).toBe('Southborough')
  })
})
