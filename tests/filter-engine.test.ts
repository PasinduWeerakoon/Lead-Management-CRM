import { describe, expect, it } from 'vitest'
import { classifyTitle } from '../src/lib/classify-title'
import { compileFilter, highlightRegex, isComplete, keywordRegex, type FilterContext } from '../src/lib/filters/engine'
import { describeCondition } from '../src/lib/filters/describe'
import { BUILT_IN_PACKS, BUILT_IN_PACK_IDS, PRESETS, instantiate } from '../src/lib/filters/presets'
import { FilterGroupSchema, type Condition, type FilterGroup } from '../src/lib/filters/schema'
import type { Contact } from '../src/lib/schemas'

let seq = 0
function person(fullName: string, position: string, company: string, extra: Partial<Contact> = {}): Contact {
  return {
    id: String(++seq),
    firstName: fullName.split(' ')[0],
    lastName: fullName.split(' ').slice(1).join(' '),
    fullName,
    position,
    company,
    source: 'linkedin_export',
    importedAt: '2026-01-01',
    updatedAt: '2026-01-01',
    status: 'new',
    tags: [],
    ...classifyTitle(position),
    ...extra,
  }
}

const people = [
  person('Ana CIO', 'Chief Information Officer', 'Contoso', { connectedOn: '2026-03-01' }),
  person('Ben Dyn', 'Director, Microsoft Dynamics 365 Practice', 'Fabrikam', { connectedOn: '2019-05-01' }),
  person('Cy Dev', 'Senior Software Engineer', 'Litware', { status: 'shortlisted', tags: ['Warm'] }),
  person('Di Mkt', 'Marketing Manager', 'Power Apps Partners Ltd'),
  person('Ed VP', 'VP of Information Technology', 'Northwind', { connectedOn: '2025-12-20' }),
  person('Flo Data', 'Head of Data & Analytics', 'Woodgrove Bank', {
    location: { value: 'Boston, MA', origin: 'manual' },
  }),
]

const ctx: FilterContext = {
  packs: new Map(BUILT_IN_PACKS.map((p) => [p.id, { ...p, updatedAt: '' }])),
  today: new Date('2026-10-15T00:00:00Z'),
}

const c = (field: Condition['field'], op: Condition['op'], value?: Condition['value']): Condition => ({
  id: `${field}-${op}`,
  kind: 'condition',
  field,
  op,
  value,
})

function names(filter: FilterGroup) {
  const pred = compileFilter(filter, ctx)
  return people.filter((p) => !pred || pred(p)).map((p) => p.fullName)
}

const and = (...items: FilterGroup['items']): FilterGroup => ({ combinator: 'and', items })
const or = (...items: FilterGroup['items']): FilterGroup => ({ combinator: 'or', items })

describe('keywordRegex', () => {
  it('matches whole words only, ignoring case', () => {
    const re = keywordRegex(['CTO', 'Power BI'])!
    expect(re.test('cto & founder')).toBe(true)
    expect(re.test('Director')).toBe(false)
    expect(re.test('Power  BI lead')).toBe(true)
    expect(re.test('PowerBIx')).toBe(false)
  })

  it('handles symbols and regex characters safely', () => {
    expect(keywordRegex(['Dynamics 365 F&O'])!.test('Dynamics 365 F&O lead')).toBe(true)
    expect(keywordRegex(['C++'])!.test('C++ developer')).toBe(true)
    expect(keywordRegex(['a.b'])!.test('axb')).toBe(false)
  })

  it('returns undefined for no terms', () => {
    expect(keywordRegex(['', '  '])).toBeUndefined()
  })
})

describe('compileFilter', () => {
  it('returns no predicate for an empty filter', () => {
    expect(compileFilter(and(), ctx)).toBeUndefined()
  })

  it('filters enums with any of / none of', () => {
    expect(names(and(c('seniority', 'any_of', ['C-level', 'VP'])))).toEqual(['Ana CIO', 'Ed VP'])
    expect(names(and(c('seniority', 'none_of', ['C-level', 'VP', 'IC'])))).toEqual(['Ben Dyn', 'Di Mkt', 'Flo Data'])
  })

  it('filters text fields', () => {
    expect(names(and(c('company', 'contains', 'north')))).toEqual(['Ed VP'])
    expect(names(and(c('company', 'is', 'contoso')))).toEqual(['Ana CIO'])
    expect(names(and(c('location', 'is_not_empty')))).toEqual(['Flo Data'])
    expect(names(and(c('location', 'is_empty')))).toHaveLength(5)
  })

  it('matches keywords across title and company', () => {
    expect(names(and(c('keywords', 'has_any_word', ['Dynamics', 'Power Apps'])))).toEqual(['Ben Dyn', 'Di Mkt'])
    expect(names(and(c('keywords', 'has_no_word', ['Engineer', 'Manager'])))).toEqual([
      'Ana CIO',
      'Ben Dyn',
      'Ed VP',
      'Flo Data',
    ])
  })

  it('matches keyword packs', () => {
    expect(names(and(c('keywordPack', 'matches_pack', BUILT_IN_PACK_IDS.microsoft)))).toEqual(['Ben Dyn', 'Di Mkt'])
    expect(names(and(c('keywordPack', 'matches_pack', BUILT_IN_PACK_IDS.cloudData)))).toEqual(['Flo Data'])
  })

  it('filters dates', () => {
    expect(names(and(c('connectedOn', 'within_last', 12)))).toEqual(['Ana CIO', 'Ed VP'])
    expect(names(and(c('connectedOn', 'before', '2020-01-01')))).toEqual(['Ben Dyn'])
    expect(names(and(c('connectedOn', 'after', '2026-01-01')))).toEqual(['Ana CIO'])
    expect(names(and(c('connectedOn', 'is_empty')))).toEqual(['Cy Dev', 'Di Mkt', 'Flo Data'])
  })

  it('filters list fields case-insensitively', () => {
    expect(names(and(c('titleTags', 'any_of', ['cio'])))).toEqual(['Ana CIO'])
    expect(names(and(c('tags', 'any_of', ['warm'])))).toEqual(['Cy Dev'])
    expect(names(and(c('tags', 'is_empty')))).toHaveLength(5)
  })

  it('combines with AND, OR and one nested group', () => {
    expect(names(or(c('seniority', 'any_of', ['VP']), c('status', 'any_of', ['shortlisted'])))).toEqual([
      'Cy Dev',
      'Ed VP',
    ])
    const nested = and(c('seniority', 'any_of', ['C-level', 'VP', 'Director', 'Head']), {
      id: 'g',
      kind: 'group',
      combinator: 'or',
      conditions: [c('function', 'any_of', ['Digital']), c('keywords', 'has_any_word', ['Data', 'Dynamics'])],
    })
    expect(names(nested)).toEqual(['Ben Dyn', 'Flo Data'])
  })

  it('ignores unfinished conditions instead of hiding everyone', () => {
    expect(isComplete(c('company', 'contains', ''), ctx)).toBe(false)
    expect(isComplete(c('keywordPack', 'matches_pack', 'missing-pack'), ctx)).toBe(false)
    expect(names(and(c('company', 'contains', ''), c('seniority', 'any_of', [])))).toHaveLength(6)
  })
})

describe('presets', () => {
  it('are valid filters and instantiate with fresh ids', () => {
    for (const p of PRESETS) {
      expect(FilterGroupSchema.safeParse(p.filter).success).toBe(true)
      const a = instantiate(p.filter)
      const b = instantiate(p.filter)
      expect(a.items[0].id).not.toBe(b.items[0].id)
    }
  })

})

describe('describe and highlight', () => {
  it('labels chips in plain words', () => {
    expect(describeCondition(c('seniority', 'any_of', ['C-level', 'IC']), ctx.packs)).toEqual({
      field: 'Seniority',
      op: 'is any of',
      value: 'C-level, Individual',
    })
    expect(describeCondition(c('connectedOn', 'within_last', 24), ctx.packs).value).toBe('2 years')
    expect(describeCondition(c('keywordPack', 'matches_pack', BUILT_IN_PACK_IDS.erpCrm), ctx.packs).value).toBe(
      'ERP & CRM',
    )
  })

  it('highlights positive keyword and substring matches only', () => {
    const re = highlightRegex(
      and(
        c('keywords', 'has_any_word', ['Dynamics']),
        c('keywords', 'has_no_word', ['Intern']),
        c('company', 'contains', 'north'),
      ),
      ctx,
    )!
    expect('Microsoft Dynamics 365'.match(new RegExp(re.source, 'giu'))).toEqual(['Dynamics'])
    expect('Northwind'.match(new RegExp(re.source, 'giu'))).toEqual(['North'])
    expect(re.test('Intern')).toBe(false)
    expect(highlightRegex(and(c('seniority', 'any_of', ['VP'])), ctx)).toBeUndefined()
  })
})

describe('AI priority filter', () => {
  const scored = (score: number, priority: 'High' | 'Medium' | 'Low') =>
    person(`S${score}`, 'CEO', 'X', {
      ai: {
        briefId: 'b',
        briefName: 'b',
        score,
        priority,
        reason: '',
        confirmed: [],
        inferred: [],
        model: 'm',
        at: '',
      },
    })
  it('leaves out people the AI scored 0', () => {
    const list = [scored(0, 'Low'), scored(1, 'Low'), scored(55, 'Medium')]
    const pred = compileFilter(and(c('aiPriority', 'any_of', ['Low', 'Medium'])), ctx)!
    expect(list.filter(pred).map((p) => p.ai!.score)).toEqual([1, 55])
  })
})
