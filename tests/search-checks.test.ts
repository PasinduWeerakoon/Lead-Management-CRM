import { describe, expect, it } from 'vitest'
import { localIssues } from '../src/lib/ai/prompt-check'
import { buildScoringSystemPrompt } from '../src/lib/ai/scoring'
import { criterionCounts } from '../src/features/ai/WhyPanel'
import type { ScoreRun } from '../src/lib/schemas'

describe('prompt check', () => {
  it('blocks prompts with no words, and reads short ones broadly instead of blocking', () => {
    expect(localIssues('???').map((i) => i.severity)).toContain('error')
    expect(localIssues('Virtusa').map((i) => i.severity)).toEqual(['info'])
  })
  it('allows LinkedIn but notes that Indeed and Glassdoor can’t be read', () => {
    expect(localIssues('Look into their current employer LinkedIn page for active jobs on AWS')).toEqual([])
    const issues = localIssues('Check their employer on Indeed for active jobs on AWS')
    expect(issues.some((i) => i.severity === 'info' && /Indeed/.test(i.text))).toBe(true)
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
  })
})

describe('scoring against conditions', () => {
  it('lists each condition in the system prompt', () => {
    const s = buildScoringSystemPrompt({ text: 'x' }, ['Worked at Sysco LABS', 'Company hiring AWS'])
    expect(s).toContain('1. Worked at Sysco LABS')
    expect(s).toContain('"not_met"')
  })

  it('counts how each condition came out', () => {
    const run = {
      criteria: ['A', 'B'],
      people: [
        {
          checks: [
            { criterion: 'A', status: 'met', evidence: '' },
            { criterion: 'B', status: 'unknown', evidence: '' },
          ],
        },
        { checks: [{ criterion: 'A', status: 'not_met', evidence: '' }] },
      ],
    } as unknown as ScoreRun
    expect(criterionCounts(run)).toEqual([
      { criterion: 'A', met: 1, notMet: 1, unknown: 0 },
      { criterion: 'B', met: 0, notMet: 0, unknown: 2 },
    ])
  })
})

describe('conditions decide the shortlist', () => {
  it('keeps people off the shortlist when a condition is unknown or not met', async () => {
    const { validateBatch } = await import('../src/lib/ai/scoring')
    const contact = (id: string) => ({ id, fullName: id }) as never
    const row = { ref: 'r', name: 'x', seniority: 'VP', function: 'Technology' } as never
    const out = {
      results: [
        {
          ref: 'a',
          score: 80,
          reason: '',
          confirmed: [],
          inferred: [],
          checks: [{ criterion: 'A', status: 'unknown' as const, evidence: '' }],
        },
        {
          ref: 'b',
          score: 80,
          reason: '',
          confirmed: [],
          inferred: [],
          checks: [{ criterion: 'A', status: 'not_met' as const, evidence: '' }],
        },
        {
          ref: 'c',
          score: 80,
          reason: '',
          confirmed: [],
          inferred: [],
          checks: [{ criterion: 'A', status: 'met' as const, evidence: '' }],
        },
      ],
    }
    const batch = ['a', 'b', 'c'].map((ref) => ({ ref, contact: contact(ref), row }))
    const r = validateBatch(out, batch, { id: 'q', name: 'q' }, 'm').results
    expect(r.get('a')?.score).toBe(39)
    expect(r.get('b')?.score).toBe(25)
    expect(r.get('c')?.score).toBe(80)
  })
})

describe('company summaries', () => {
  it('prefers a summary about the company over one about the pages', async () => {
    const { pickSummary } = await import('../src/lib/research/company-web')
    expect(
      pickSummary('The supplied pages do not describe its services.', 'Builds software for food distribution.'),
    ).toBe('Builds software for food distribution.')
    expect(pickSummary('Makes payment software.', 'Other text.')).toBe('Makes payment software.')
  })
})

describe('placeholder companies', () => {
  it('never researches self-employed, stealth or freelance', async () => {
    const { PLACEHOLDER_COMPANY } = await import('../src/lib/research/run')
    for (const c of [
      'Self-employed',
      'self employed',
      'Stealth Startup',
      'Freelance',
      'Freelancer',
      'Retired',
      'N/A',
      'Open to work',
    ])
      expect(PLACEHOLDER_COMPANY.test(c)).toBe(true)
    for (const c of ['WSO2', 'Stealth Bank Ltd', 'Freelancer.com Ltd', 'Virtusa'])
      expect(PLACEHOLDER_COMPANY.test(c)).toBe(false)
  })
})

describe('re-collecting never loses data', () => {
  it('keeps found company research when a new attempt finds nothing', async () => {
    const { applyResearch } = await import('../src/lib/research/run')
    const c = {
      id: 'x',
      research: { status: 'found', domain: 'contoso.com', at: '2026-11-01T00:00:00Z' },
    } as never
    const after = applyResearch(c, { status: 'no_site', at: '2026-11-10T00:00:00Z' } as never)
    expect(after.research?.status).toBe('found')
    const better = applyResearch(c, { status: 'found', domain: 'contoso.com', at: '2026-11-10T00:00:00Z' } as never)
    expect(better.research?.at).toBe('2026-11-10T00:00:00Z')
  })
})

describe('re-collecting builds on earlier data', () => {
  it('joins jobs and clients from both runs, newer values winning', async () => {
    const { applyResearch } = await import('../src/lib/research/run')
    const c = {
      id: 'x',
      research: {
        status: 'found',
        industry: { value: 'Old', url: 'u', quote: 'q' },
        hiring: [{ title: 'QA Engineer' }],
        clients: [{ name: 'Bank A', url: 'u' }],
        at: '2026-11-01T00:00:00Z',
      },
    } as never
    const after = applyResearch(c, {
      status: 'found',
      industry: { value: 'New', url: 'u', quote: 'q' },
      hiring: [{ title: 'AWS Engineer', source: 'LinkedIn' }],
      at: '2026-11-10T00:00:00Z',
    } as never)
    expect(after.research?.industry?.value).toBe('New')
    expect(after.research?.hiring?.map((j) => j.title)).toEqual(['AWS Engineer', 'QA Engineer'])
    expect(after.research?.clients?.[0].name).toBe('Bank A')
    expect(after.research?.at).toBe('2026-11-10T00:00:00Z')
  })
})

describe('LinkedIn step', () => {
  it('searches each company once, skips placeholders and anything searched recently', async () => {
    const { planLinkedIn } = await import('../src/lib/research/linkedin-step')
    const now = new Date().toISOString()
    const p = (id: string, company: string | undefined, extra = {}) =>
      ({ id, fullName: id, company, ...extra }) as never
    const plan = planLinkedIn([
      p('a', 'Virtusa'),
      p('b', 'Virtusa'),
      p('c', 'Self-employed'),
      p('d', 'WSO2', {
        research: { status: 'found', linkedinAt: now, at: now },
        web: { status: 'found', linkedinAt: now, at: now },
      }),
    ])
    expect(plan.companies.map((c) => c.company)).toEqual(['Virtusa'])
    expect(plan.companies[0].ids).toEqual(['a', 'b'])
    expect(plan.people.map((x) => (x as { id: string }).id)).toEqual(['a', 'b', 'c'])
  })
})
