import { describe, expect, it } from 'vitest'
import { keywordIndex, keywordMatcher } from '../src/lib/keywords'
import { BUILT_IN_PACKS } from '../src/lib/filters/presets'
import type { Contact } from '../src/lib/schemas'

const c = (id: string, position?: string, company?: string) => ({ id, position, company }) as Contact
const ms = BUILT_IN_PACKS[0].keywords

describe('keywordMatcher', () => {
  it('finds whole-word keywords in title and company, as written in the pack', () => {
    const match = keywordMatcher(ms)
    expect(match(c('1', 'Head of power bi and Azure', 'Contoso'))).toEqual(['Power BI', 'Azure'])
    expect(match(c('2', 'Director', 'Dynamics Partners Ltd'))).toEqual(['Dynamics'])
    expect(match(c('3', 'Software Engineer', 'Litware'))).toEqual([])
    expect(match(c('4'))).toEqual([])
  })

  it('does not match inside other words', () => {
    expect(keywordMatcher(['BI', 'CRM'])(c('1', 'Bill Manager', 'CRMx Labs'))).toEqual([])
  })

  it('indexes only people with matches', () => {
    const idx = keywordIndex([c('a', 'D365 lead'), c('b', 'Nurse')], ms)
    expect([...idx.keys()]).toEqual(['a'])
    expect(idx.get('a')).toEqual(['D365'])
  })

  it('stays fast on a large network', () => {
    const people = Array.from({ length: 5000 }, (_, i) =>
      c(String(i), i % 3 ? 'Senior Software Engineer' : 'Dynamics 365 Consultant', 'Contoso'),
    )
    const t = performance.now()
    keywordIndex(
      people,
      BUILT_IN_PACKS.flatMap((p) => p.keywords),
    )
    expect(performance.now() - t).toBeLessThan(500)
  })
})
