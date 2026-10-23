import { describe, expect, it } from 'vitest'
import { autoMapColumns, hasNameMapping, parseCsvText } from '../src/lib/csv'
import {
  mergeContact,
  normalizeEmail,
  normalizeProfileUrl,
  parseConnectedOn,
  rowToContact,
  stableId,
} from '../src/lib/normalize'

const LINKEDIN_EXPORT = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://www.linkedin.com/in/jane-doe-123/,,Contoso,Chief Information Officer,15 Oct 2024
Mark,"Kim, Jr.",https://www.linkedin.com/in/mark-kim,mark@example.com,Fabrikam,IT Director,01 Feb 2020
`

describe('parseCsvText', () => {
  it('skips the LinkedIn "Notes:" preamble and finds the header row', () => {
    const t = parseCsvText(LINKEDIN_EXPORT)
    expect(t.headers).toEqual([
      'First Name',
      'Last Name',
      'URL',
      'Email Address',
      'Company',
      'Position',
      'Connected On',
    ])
    expect(t.rows).toHaveLength(2)
    expect(t.rows[1][1]).toBe('Kim, Jr.')
  })

  it('handles a BOM and a plain header', () => {
    const t = parseCsvText('\uFEFFName,Title,Company\nAna Example,CTO,Litware\n')
    expect(t.headers[0]).toBe('Name')
    expect(t.rows).toEqual([['Ana Example', 'CTO', 'Litware']])
  })
})

describe('autoMapColumns', () => {
  it('maps every LinkedIn column', () => {
    const m = autoMapColumns(parseCsvText(LINKEDIN_EXPORT).headers)
    expect(m).toEqual({ firstName: 0, lastName: 1, profileUrl: 2, email: 3, company: 4, position: 5, connectedOn: 6 })
    expect(hasNameMapping(m)).toBe(true)
  })

  it('falls back to a full-name column', () => {
    const m = autoMapColumns(['Name', 'Job Title', 'Organization'])
    expect(m).toEqual({ fullName: 0, position: 1, company: 2 })
  })
})

describe('field normalisers', () => {
  it.each([
    ['15 Oct 2024', '2024-10-15'],
    ['1 Jan 2016', '2016-01-01'],
    ['2023-03-09', '2023-03-09'],
    ['Oct 5, 2021', '2021-10-05'],
    ['31 Feb 2024', undefined],
    ['yesterday', undefined],
  ])('parseConnectedOn(%s) = %s', (raw, iso) => {
    expect(parseConnectedOn(raw)).toBe(iso)
  })

  it('keeps only real LinkedIn profile URLs', () => {
    expect(normalizeProfileUrl('https://www.linkedin.com/in/jane-doe-123/?trk=x')).toBe(
      'https://www.linkedin.com/in/jane-doe-123',
    )
    expect(normalizeProfileUrl('linkedin.com/in/abc')).toBe('https://www.linkedin.com/in/abc')
    expect(normalizeProfileUrl('https://evil.com/in/abc')).toBeUndefined()
    expect(normalizeProfileUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizeProfileUrl('https://linkedin.com.evil.com/in/x')).toBeUndefined()
  })

  it('validates emails', () => {
    expect(normalizeEmail(' Mark@Example.com ')).toBe('mark@example.com')
    expect(normalizeEmail('not an email')).toBeUndefined()
  })

  it('produces stable ids', () => {
    expect(stableId('abc')).toBe(stableId('abc'))
    expect(stableId('abc')).not.toBe(stableId('abd'))
    expect(stableId('abc')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('rowToContact / mergeContact', () => {
  const t = parseCsvText(LINKEDIN_EXPORT)
  const mapping = autoMapColumns(t.headers)
  const now = '2026-10-15T00:00:00.000Z'

  it('builds a classified contact', () => {
    const res = rowToContact(t.rows[0], mapping, 'linkedin_export', now)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.contact).toMatchObject({
      fullName: 'Jane Doe',
      company: 'Contoso',
      seniority: 'C-level',
      function: 'Technology',
      connectedOn: '2024-10-15',
      status: 'new',
    })
  })

  it('skips rows with no name', () => {
    const res = rowToContact(['', '', '', '', 'Contoso', 'CTO', ''], mapping, 'linkedin_export', now)
    expect(res).toEqual({ ok: false, reason: 'No name' })
  })

  it('keeps user-owned fields on re-import', () => {
    const first = rowToContact(t.rows[0], mapping, 'linkedin_export', now)
    if (!first.ok) throw new Error('expected ok')
    const edited = { ...first.contact, status: 'shortlisted' as const, notes: 'Met at a conference', tags: ['warm'] }
    const promoted = [...t.rows[0]]
    promoted[5] = 'Chief Executive Officer'
    const second = rowToContact(promoted, mapping, 'linkedin_export', now)
    if (!second.ok) throw new Error('expected ok')

    const merged = mergeContact(edited, second.contact)
    expect(merged.position).toBe('Chief Executive Officer')
    expect(merged.function).toBe('Executive')
    expect(merged.status).toBe('shortlisted')
    expect(merged.notes).toBe('Met at a conference')
    expect(merged.tags).toEqual(['warm'])
  })
})
