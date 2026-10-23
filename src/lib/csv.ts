import Papa from 'papaparse'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_ROWS = 50_000

export interface ParsedTable {
  headers: string[]
  rows: string[][]
}

export const TARGET_FIELDS = [
  { key: 'firstName', label: 'First name', synonyms: ['first name', 'firstname', 'given name'] },
  { key: 'lastName', label: 'Last name', synonyms: ['last name', 'lastname', 'surname', 'family name'] },
  { key: 'fullName', label: 'Full name', synonyms: ['full name', 'name', 'contact name'] },
  {
    key: 'profileUrl',
    label: 'LinkedIn URL',
    synonyms: ['url', 'profile url', 'linkedin url', 'linkedin', 'linkedin profile', 'profile'],
  },
  { key: 'email', label: 'Email', synonyms: ['email address', 'email', 'e-mail'] },
  {
    key: 'company',
    label: 'Company',
    synonyms: ['company', 'organization', 'organisation', 'employer', 'current company', 'account name'],
  },
  {
    key: 'position',
    label: 'Job title',
    synonyms: ['position', 'title', 'job title', 'headline', 'current title', 'role'],
  },
  {
    key: 'connectedOn',
    label: 'Connected on',
    synonyms: ['connected on', 'connected', 'date connected', 'connection date'],
  },
] as const

export type TargetField = (typeof TARGET_FIELDS)[number]['key']
/** Target field → index of the source column, or undefined when not in the file. */
export type ColumnMapping = Partial<Record<TargetField, number>>

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')

function headerScore(row: string[]): number {
  const cells = new Set(row.map(norm))
  return TARGET_FIELDS.filter((f) => f.synonyms.some((s) => cells.has(s))).length
}

/**
 * LinkedIn's Connections.csv starts with a few "Notes:" lines before the real
 * header, so we look for the first row that reads like a header.
 */
export function parseCsvText(text: string): ParsedTable {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' })
  const all = result.data.filter((r) => Array.isArray(r) && r.some((c) => c && c.trim()))
  if (all.length === 0) return { headers: [], rows: [] }

  let headerIdx = 0
  let best = 0
  for (let i = 0; i < Math.min(all.length, 25); i++) {
    const score = headerScore(all[i])
    if (score > best) {
      best = score
      headerIdx = i
    }
    if (score >= 3) break
  }

  const headers = all[headerIdx].map((h) => h.trim())
  const rows = all.slice(headerIdx + 1, headerIdx + 1 + MAX_ROWS).map((r) => r.map((c) => c ?? ''))
  return { headers, rows }
}

export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const normalized = headers.map(norm)
  const used = new Set<number>()
  for (const field of TARGET_FIELDS) {
    // Exact synonym matches first, in synonym priority order.
    for (const syn of field.synonyms) {
      const idx = normalized.findIndex((h, i) => h === syn && !used.has(i))
      if (idx >= 0) {
        mapping[field.key] = idx
        used.add(idx)
        break
      }
    }
  }
  // "Full name" is only useful when first/last are missing.
  if (mapping.firstName !== undefined && mapping.fullName !== undefined) delete mapping.fullName
  return mapping
}

export function hasNameMapping(m: ColumnMapping): boolean {
  return m.firstName !== undefined || m.fullName !== undefined
}
