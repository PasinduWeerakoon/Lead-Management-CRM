import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { classifyTitle } from '../src/lib/classify-title'
import {
  EXPORT_COLUMNS,
  exportColumns,
  matchedTerms,
  neutralizeFormula,
  ruleReason,
  safeFileName,
  toExportRow,
} from '../src/lib/export/rows'
import { toCsv, toXlsx } from '../src/lib/export/writers'
import { BUILT_IN_PACKS } from '../src/lib/filters/presets'
import type { Contact } from '../src/lib/schemas'

const base = (over: Partial<Contact>): Contact => ({
  id: 'x',
  firstName: 'Ana',
  lastName: 'Example',
  fullName: 'Ana Example',
  source: 'linkedin_export',
  importedAt: '2026-01-01',
  updatedAt: '2026-01-01',
  status: 'shortlisted',
  tags: ['warm'],
  ...classifyTitle(over.position),
  ...over,
})

const ana = base({
  position: 'Director, Microsoft Dynamics 365 Practice',
  company: 'Contoso',
  profileUrl: 'https://www.linkedin.com/in/ana-example',
  email: 'ana@example.com',
  connectedOn: '2021-04-02',
  priority: 'High',
  notes: 'Met at a conference',
  location: { value: 'Boston, MA', origin: 'manual' },
})

const evil = base({
  id: 'evil',
  fullName: '=HYPERLINK("http://evil.example","click")',
  position: '+cmd|calc!A1',
  company: '@SUM(1+1)',
  notes: '-2+3',
})

const msTerms = BUILT_IN_PACKS[0].keywords

describe('export rows', () => {
  it('reports skills found in the title, preferring the longest match', () => {
    expect(matchedTerms(ana, msTerms)).toEqual(['Microsoft Dynamics', 'Dynamics 365'])
    expect(matchedTerms(base({ position: 'Chief Executive Officer' }), msTerms)).toEqual([])
  })

  it('builds the brief columns with a factual, rule-based reason', () => {
    const row = toExportRow(ana, { skillTerms: msTerms, includeNotes: true, includeEmail: true })
    expect(row).toMatchObject({
      fullName: 'Ana Example',
      company: 'Contoso',
      location: 'Boston, MA',
      linkedinUrl: 'https://www.linkedin.com/in/ana-example',
      degree: '1st',
      skillMatch: 'Microsoft Dynamics, Dynamics 365',
      website: '',
      priority: 'High',
      status: 'Shortlisted',
      notes: 'Met at a conference',
    })
    expect(row.reason).toBe(
      'Director in technology role (IT Director); title/company mentions Microsoft Dynamics, Dynamics 365; based in Boston, MA; connected since 2021.',
    )
  })

  it('leaves out notes and email unless asked', () => {
    const row = toExportRow(ana, { skillTerms: [], includeNotes: false, includeEmail: false })
    expect(row.notes).toBe('')
    expect(row.email).toBe('')
    const keys = exportColumns({ includeNotes: false, includeEmail: false }).map((c) => c.key)
    expect(keys).not.toContain('notes')
    expect(keys).not.toContain('email')
    expect(keys.slice(0, 10)).toEqual(EXPORT_COLUMNS.slice(0, 10).map((c) => c.key))
  })

  it('degree follows the source', () => {
    const row = (source: Contact['source']) =>
      toExportRow(base({ source }), { skillTerms: [], includeNotes: false, includeEmail: false })
    expect(row('sales_nav').degree).toBe('2nd')
    expect(row('manual').degree).toBe('')
  })

  it('reason is empty when there is nothing factual to say', () => {
    expect(ruleReason(base({ position: undefined }), [])).toBe('')
  })
})

describe('formula safety', () => {
  it('neutralises formula-looking text', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1")
    expect(neutralizeFormula('+44 20')).toBe("'+44 20")
    expect(neutralizeFormula('-x')).toBe("'-x")
    expect(neutralizeFormula('@x')).toBe("'@x")
    expect(neutralizeFormula('\t=x')).toBe("'\t=x")
    expect(neutralizeFormula('Ana')).toBe('Ana')
  })

  it('CSV output has no live formulas', () => {
    const cols = exportColumns({ includeNotes: true, includeEmail: true })
    const csv = toCsv([toExportRow(evil, { skillTerms: [], includeNotes: true, includeEmail: true })], cols)
    expect(csv.startsWith('﻿')).toBe(true)
    const parsed = Papa.parse<string[]>(csv.slice(1)).data
    expect(parsed[0][0]).toBe('Full Name')
    for (const cell of parsed[1]) expect(cell).not.toMatch(/^[=+\-@]/)
  })

  it('xlsx output is plain strings with a real hyperlink and an about sheet', async () => {
    const cols = exportColumns({ includeNotes: true, includeEmail: true })
    const rows = [ana, evil].map((c) => toExportRow(c, { skillTerms: msTerms, includeNotes: true, includeEmail: true }))
    const buf = await toXlsx(rows, cols, {
      title: 'Test',
      filterSummary: ['Seniority is any of C-level'],
      generatedAt: new Date('2026-10-15'),
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.getWorksheet('Leads')!
    expect(ws.getRow(1).getCell(1).value).toBe('Full Name')
    expect(ws.rowCount).toBe(3)

    const link = ws.getRow(2).getCell(5).value as { hyperlink: string }
    expect(link.hyperlink).toBe('https://www.linkedin.com/in/ana-example')

    ws.eachRow((row) =>
      row.eachCell((cell) => {
        expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)
        if (typeof cell.value === 'string') expect(cell.value).not.toMatch(/^[=+\-@]/)
      }),
    )
    expect(ws.getRow(3).getCell(1).value).toBe(`'=HYPERLINK("http://evil.example","click")`)
    expect(wb.getWorksheet('About this export')).toBeDefined()
  })

  it('makes safe file names', () => {
    expect(safeFileName('Boston D365 / leaders!')).toBe('Boston-D365-leaders')
    expect(safeFileName('../../etc')).toBe('etc')
    expect(safeFileName('***')).toBe('leads')
  })
})
