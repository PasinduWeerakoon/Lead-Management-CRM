import { describe, expect, it } from 'vitest'
import { classifyTitle } from '../src/lib/classify-title'

describe('classifyTitle', () => {
  it.each([
    ['Chief Information Officer', 'C-level', 'Technology', 'CIO'],
    ['CTO', 'C-level', 'Technology', 'CTO'],
    ['CEO & Co-Founder', 'C-level', 'Executive', 'CEO'],
    ['Founder & CTO', 'C-level', 'Technology', 'CTO'],
    ['Chief Operating Officer', 'C-level', 'Operations', 'COO'],
    ['Chief Digital Officer', 'C-level', 'Digital', 'CDO'],
    ['Chief Transformation Officer', 'C-level', 'Digital', 'Chief Transformation Officer'],
    ['VP of Information Technology', 'VP', 'Technology', 'VP'],
    ['Vice President, Digital Transformation', 'VP', 'Digital', 'VP'],
    ['IT Director', 'Director', 'Technology', 'IT Director'],
    ['Director of Enterprise Applications', 'Director', 'Technology', 'IT Director'],
    ['Head of Business Systems', 'Head', 'Technology', 'Head of IT'],
    ['Managing Director', 'C-level', 'Executive', 'Managing Director'],
    ['Marketing Manager', 'Manager', 'Marketing', undefined],
    ['Senior Software Engineer', 'IC', 'Technology', undefined],
  ])('%s → %s / %s', (title, seniority, fn, tag) => {
    const r = classifyTitle(title)
    expect(r.seniority).toBe(seniority)
    expect(r.function).toBe(fn)
    if (tag) expect(r.titleTags).toContain(tag)
  })

  it('does not treat "Vice President" as C-level just because it contains "President"', () => {
    expect(classifyTitle('Vice President of Sales').seniority).toBe('VP')
  })

  it('does not read the word "it" as IT', () => {
    expect(classifyTitle('Making it happen at Contoso').function).toBe('Other')
  })

  it('does not match CTO inside Director', () => {
    expect(classifyTitle('Director').titleTags).not.toContain('CTO')
  })

  it('handles empty titles', () => {
    expect(classifyTitle(undefined)).toEqual({ seniority: 'Unknown', function: 'Other', titleTags: [] })
  })
})

describe('accuracy fixes from the October 2026 sample', () => {
  it.each([
    ['Full Stack Engineer', 'Technology'],
    ['Quality Assurance Engineer', 'Technology'],
    ['Application Analyst', 'Technology'],
    ['Storage Administrator', 'Technology'],
    ['Technical Recruitment Consultant', 'People'],
    ['Transfer Pricing Officer', 'Finance'],
    ['Senior Wealth Planning Manager', 'Finance'],
    ['Manager Public Relations and Communication', 'Marketing'],
    ['Chief Information Officer', 'Technology'],
    ['Head - Talent Development & Placement', 'People'],
  ])('%s → %s', (title, fn) => {
    expect(classifyTitle(title).function).toBe(fn)
  })
})
