import Papa from 'papaparse'
import type { Workbook } from 'exceljs'
import { neutralizeFormula, type ExportKey, type ExportRow } from './rows'

type Column = { key: ExportKey; header: string; width: number }

export function toCsv(rows: ExportRow[], columns: readonly Column[]): string {
  const data = rows.map((r) => columns.map((c) => neutralizeFormula(r[c.key])))
  // BOM so Excel opens UTF-8 names (é, ü, ś…) correctly.
  return '﻿' + Papa.unparse({ fields: columns.map((c) => c.header), data }, { newline: '\r\n' })
}

export interface WorkbookInfo {
  title: string
  filterSummary: string[]
  generatedAt: Date
}

const HEADER_FILL = 'FF4F46E5'
const PRIORITY_FILL: Record<string, string> = { High: 'FFFEE2E2', Medium: 'FFFFEDD5', Low: 'FFDBEAFE' }

/** ExcelJS is large, so it's only loaded when someone actually exports. */
export async function buildWorkbook(
  rows: ExportRow[],
  columns: readonly Column[],
  info: WorkbookInfo,
): Promise<Workbook> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Leads'
  wb.created = info.generatedAt

  const ws = wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] })
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }))

  const header = ws.getRow(1)
  header.height = 22
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: 'middle' }
  })

  for (const r of rows) {
    // Every value is written as a plain string, so nothing a contact typed can become a formula.
    // The quote prefix additionally protects anyone who later saves the sheet as CSV.
    const row = ws.addRow(Object.fromEntries(columns.map((c) => [c.key, neutralizeFormula(r[c.key])])))
    row.alignment = { vertical: 'top', wrapText: true }

    const urlCol = columns.findIndex((c) => c.key === 'linkedinUrl')
    if (urlCol >= 0 && r.linkedinUrl.startsWith('https://www.linkedin.com/')) {
      const cell = row.getCell(urlCol + 1)
      cell.value = { text: r.linkedinUrl, hyperlink: r.linkedinUrl }
      cell.font = { color: { argb: 'FF0A66C2' }, underline: true }
    }
    const prioCol = columns.findIndex((c) => c.key === 'priority')
    if (prioCol >= 0 && PRIORITY_FILL[r.priority]) {
      row.getCell(prioCol + 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: PRIORITY_FILL[r.priority] },
      }
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }

  const about = wb.addWorksheet('About this export')
  about.columns = [{ width: 28 }, { width: 90 }]
  const lines: Array<[string, string]> = [
    ['Export', info.title],
    ['Generated', info.generatedAt.toLocaleString()],
    ['People', String(rows.length)],
    ['Filters', info.filterSummary.length ? info.filterSummary.join('\n') : 'None (everyone)'],
    ['Connection Degree', '1st = from your LinkedIn export. 2nd = added from Sales Navigator.'],
    ['Skill Match', 'Keywords found as whole words in the job title or company. Confirmed text, not a guess.'],
    [
      'Reason for Match',
      'The AI reason when the person has been scored, otherwise a rule-based summary of seniority, function, keyword matches and location.',
    ],
    ['AI Score', '0–100 fit against the brief used in “Score with AI”. 70+ High, 40–69 Medium, under 40 Low.'],
    [
      'Confirmed Evidence',
      'Exact quotes from the person’s title, company or location. The app removes any claim it can’t find in the data.',
    ],
    [
      'Inferred (verify)',
      'The AI’s educated guesses, for example about company needs. Not facts — verify before relying on them.',
    ],
    [
      'Company Website / Industry / Size',
      'From your “Company data” CSV imports or typed in the app. Left empty when unknown — nothing is invented.',
    ],
    ['Lead Priority', 'Your priority from the app; if you haven’t set one, the AI’s suggested priority.'],
  ]
  lines.forEach(([k, v]) => {
    const row = about.addRow([k, v])
    row.getCell(1).font = { bold: true }
    row.alignment = { vertical: 'top', wrapText: true }
  })

  return wb
}

export async function toXlsx(rows: ExportRow[], columns: readonly Column[], info: WorkbookInfo): Promise<ArrayBuffer> {
  const wb = await buildWorkbook(rows, columns, info)
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
