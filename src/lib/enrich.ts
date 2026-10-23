import { z } from 'zod'
import { db } from './db'
import type { ParsedTable } from './csv'
import { normalizeCompany, normalizeProfileUrl } from './normalize'
import type { Contact } from './schemas'

/**
 * "Add company data": match rows from any CSV (Apollo, ZoomInfo, Sales Navigator, your own sheet)
 * to people you already have, and fill in website, industry, company size, company HQ and location.
 * Rows with only a company (no person) apply company details to everyone who works there.
 * No API keys or servers — and nothing is guessed: unmatched rows are reported, not forced.
 */

export const ENRICH_FIELDS = [
  {
    key: 'profileUrl',
    label: 'LinkedIn URL',
    role: 'match',
    synonyms: ['linkedin url', 'linkedin', 'linkedin profile', 'person linkedin url', 'profile url', 'url'],
  },
  {
    key: 'fullName',
    label: 'Full name',
    role: 'match',
    synonyms: ['full name', 'name', 'contact name', 'person name'],
  },
  { key: 'firstName', label: 'First name', role: 'match', synonyms: ['first name', 'firstname', 'given name'] },
  { key: 'lastName', label: 'Last name', role: 'match', synonyms: ['last name', 'lastname', 'surname'] },
  {
    key: 'company',
    label: 'Company',
    role: 'match',
    synonyms: ['company', 'company name', 'organization', 'organisation', 'account name', 'employer'],
  },
  {
    key: 'website',
    label: 'Company website',
    role: 'data',
    synonyms: ['website', 'company website', 'domain', 'company domain', 'company url', 'web', 'website url'],
  },
  {
    key: 'industry',
    label: 'Industry',
    role: 'data',
    synonyms: ['industry', 'company industry', 'sector', 'vertical'],
  },
  {
    key: 'companySize',
    label: 'Company size',
    role: 'data',
    synonyms: [
      'company size',
      'employees',
      'employee count',
      '# employees',
      'number of employees',
      'headcount',
      'size',
    ],
  },
  {
    key: 'companyHq',
    label: 'Company HQ',
    role: 'data',
    synonyms: [
      'company hq',
      'hq',
      'headquarters',
      'company headquarters',
      'hq location',
      'headquarters location',
      'company location',
    ],
  },
  {
    key: 'hqMetro',
    label: 'HQ metro area',
    role: 'data',
    synonyms: ['hq metro', 'hq metro area', 'metro area', 'headquarters metro'],
  },
  {
    key: 'location',
    label: 'Location',
    role: 'data',
    synonyms: ['location', 'person location', 'city', 'metro', 'region', 'geography'],
  },
] as const

export type EnrichField = (typeof ENRICH_FIELDS)[number]['key']
export type EnrichMapping = Partial<Record<EnrichField, number>>

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')

export function autoMapEnrich(headers: string[]): EnrichMapping {
  const normalized = headers.map(norm)
  const used = new Set<number>()
  const mapping: EnrichMapping = {}
  for (const f of ENRICH_FIELDS) {
    for (const syn of f.synonyms) {
      const idx = normalized.findIndex((h, i) => h === syn && !used.has(i))
      if (idx >= 0) {
        mapping[f.key] = idx
        used.add(idx)
        break
      }
    }
  }
  return mapping
}

/** Person columns, or a company column (company-only rows update everyone at that company). */
export const canMatch = (m: EnrichMapping) =>
  m.profileUrl !== undefined || m.fullName !== undefined || m.firstName !== undefined || m.company !== undefined

export const hasData = (m: EnrichMapping) =>
  m.website !== undefined ||
  m.industry !== undefined ||
  m.companySize !== undefined ||
  m.companyHq !== undefined ||
  m.location !== undefined

const clean = (s: string | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Keeps only real web addresses, as https://domain/path. Rejects javascript:, mailto: and junk. */
export function normalizeWebsite(raw: string | undefined): string | undefined {
  const s = clean(raw, 200)
  if (!s) return undefined
  // Any other scheme (javascript:, mailto:, data:…) is rejected outright, not "fixed" into https.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return undefined
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return undefined
    const path = url.pathname.replace(/\/+$/, '')
    return `https://${url.hostname.toLowerCase()}${path}`
  } catch {
    return undefined
  }
}

const key = (name: string, company?: string) => `${name.toLowerCase()}|${(company ?? '').toLowerCase()}`

export interface EnrichPlan {
  updates: Contact[]
  matched: number
  unchanged: number
  /** Data rows that matched nobody, or matched more than one person by name alone. */
  unmatched: Array<{ row: number; label: string; reason: string }>
}

export function planEnrichment(
  table: ParsedTable,
  mapping: EnrichMapping,
  contacts: Contact[],
  source: string,
  now = new Date().toISOString(),
): EnrichPlan {
  const byUrl = new Map<string, Contact>()
  const byNameCompany = new Map<string, Contact>()
  const byName = new Map<string, Contact[]>()
  const byCompany = new Map<string, Contact[]>()
  for (const c of contacts) {
    const co = c.company ? normalizeCompany(c.company) : ''
    if (co) byCompany.set(co, [...(byCompany.get(co) ?? []), c])
    if (c.profileUrl) byUrl.set(c.profileUrl.toLowerCase(), c)
    byNameCompany.set(key(c.fullName, c.company), c)
    byName.set(c.fullName.toLowerCase(), [...(byName.get(c.fullName.toLowerCase()) ?? []), c])
  }

  const get = (row: string[], k: EnrichField, max = 200) => {
    const i = mapping[k]
    return i === undefined ? '' : clean(row[i], max)
  }

  const next = new Map<string, Contact>()
  const unmatched: EnrichPlan['unmatched'] = []
  let unchanged = 0

  table.rows.forEach((row, i) => {
    const url = normalizeProfileUrl(get(row, 'profileUrl', 500))
    const name = get(row, 'fullName', 400) || `${get(row, 'firstName')} ${get(row, 'lastName')}`.trim()
    const company = get(row, 'company', 300)
    const label = name || url || `Row ${i + 1}`

    let target = url ? byUrl.get(url.toLowerCase()) : undefined
    if (!target && name && company) target = byNameCompany.get(key(name, company))
    if (!target && name) {
      const same = byName.get(name.toLowerCase()) ?? []
      if (same.length === 1) target = same[0]
      else if (same.length > 1) {
        unmatched.push({
          row: i + 1,
          label,
          reason: `${same.length} people share this name; add a company or LinkedIn URL column`,
        })
        return
      }
    }
    // A row with a company but no person: company details for everyone who works there.
    const companyWide = !target && !url && !name && company
    const targets = target ? [target] : companyWide ? (byCompany.get(normalizeCompany(company)) ?? []) : []
    if (!targets.length) {
      unmatched.push({
        row: i + 1,
        label: companyWide ? company : label,
        reason: companyWide ? 'No one in your list works at this company' : 'No one in your list matches',
      })
      return
    }
    for (const t of targets) apply(t, row, !companyWide)
  })

  function apply(target: Contact, row: string[], personRow: boolean) {
    const base = next.get(target.id) ?? target
    const website = normalizeWebsite(get(row, 'website'))
    const industry = get(row, 'industry', 120) || undefined
    const companySize = get(row, 'companySize', 60) || undefined
    const hqValue = get(row, 'companyHq')
    const hqMetro = get(row, 'hqMetro', 100)
    // Location is about a person, so company-only rows never set it.
    const location = personRow ? get(row, 'location') : ''
    const enrichment =
      website || industry || companySize
        ? {
            ...base.enrichment,
            ...(website ? { website } : {}),
            ...(industry ? { industry } : {}),
            ...(companySize ? { companySize } : {}),
            source: source.slice(0, 120),
            updatedAt: now,
          }
        : base.enrichment
    const updated: Contact = {
      ...base,
      enrichment,
      // A location or HQ you typed yourself always wins over imported data.
      ...(location && base.location?.origin !== 'manual'
        ? { location: { value: location, origin: 'enriched' as const } }
        : {}),
      ...(hqValue && base.companyHq?.origin !== 'manual'
        ? {
            companyHq: {
              status: 'found' as const,
              value: hqValue,
              ...(hqMetro ? { metro: hqMetro } : {}),
              origin: 'import' as const,
              source: source.slice(0, 120),
              at: now,
            },
          }
        : {}),
    }
    const same =
      JSON.stringify({ ...target.enrichment, source: '', updatedAt: '' }) ===
        JSON.stringify({ ...updated.enrichment, source: '', updatedAt: '' }) &&
      target.location?.value === updated.location?.value &&
      target.companyHq?.value === updated.companyHq?.value &&
      target.companyHq?.metro === updated.companyHq?.metro &&
      target.companyHq?.origin === updated.companyHq?.origin
    if (same) {
      if (!next.has(target.id)) unchanged++
    } else next.set(target.id, updated)
  }

  return { updates: [...next.values()], matched: next.size + unchanged, unchanged, unmatched }
}

export async function commitEnrichment(plan: EnrichPlan): Promise<number> {
  await db.contacts.bulkPut(plan.updates)
  return plan.updates.length
}

/** Edit company data by hand from the lead drawer. Empty values clear the field. */
export const ManualEnrichment = z.object({
  website: z.string().max(200).optional(),
  industry: z.string().max(120).optional(),
  companySize: z.string().max(60).optional(),
})

export async function saveManualEnrichment(
  contact: Contact,
  patch: z.infer<typeof ManualEnrichment>,
): Promise<string | undefined> {
  const website =
    patch.website !== undefined ? (patch.website.trim() ? normalizeWebsite(patch.website) : '') : undefined
  if (website === undefined && patch.website?.trim()) return "That doesn't look like a website address."
  const merged = { ...contact.enrichment }
  if (website !== undefined) merged.website = website || undefined
  if (patch.industry !== undefined) merged.industry = clean(patch.industry, 120) || undefined
  if (patch.companySize !== undefined) merged.companySize = clean(patch.companySize, 60) || undefined
  const empty = !merged.website && !merged.industry && !merged.companySize
  await db.contacts.update(contact.id, {
    enrichment: empty
      ? undefined
      : { ...merged, source: merged.source ?? 'manual', updatedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  })
  return undefined
}
