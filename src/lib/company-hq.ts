import { normalizeCompany } from './normalize'
import type { Contact } from './schemas'

/**
 * Company HQ is a fact about a company, not a person, so it's looked up once per company and
 * copied to everyone who works there.
 */

export type CompanyHq = NonNullable<Contact['companyHq']>

/** Website host without "www.", e.g. "contoso.com". */
export function domainOf(website?: string): string | undefined {
  if (!website) return undefined
  try {
    return new URL(website).hostname.replace(/^www\./, '').toLowerCase() || undefined
  } catch {
    return undefined
  }
}

/** Groups people by company; the website's domain wins over the name when both are known. */
export function companyKey(c: Pick<Contact, 'company' | 'enrichment'>): string | undefined {
  const domain = domainOf(c.enrichment?.website)
  if (domain) return `d:${domain}`
  const name = c.company ? normalizeCompany(c.company) : ''
  return name ? `n:${name}` : undefined
}

/** Every key a person's company is known by (domain and name), so colleagues match either way. */
export function companyKeys(c: Pick<Contact, 'company' | 'enrichment'>): string[] {
  const domain = domainOf(c.enrichment?.website)
  const name = c.company ? normalizeCompany(c.company) : ''
  return [...(domain ? [`d:${domain}`] : []), ...(name ? [`n:${name}`] : [])]
}

/** Text that location filters search: the HQ plus its metro area. */
export function hqText(hq?: CompanyHq): string | undefined {
  if (!hq || hq.status !== 'found') return undefined
  return [hq.value, hq.metro].filter(Boolean).join(' · ') || undefined
}

export interface CompanyGroup {
  key: string
  company: string
  domain?: string
  people: Contact[]
}

export interface HqPlan {
  /** Companies the AI needs to look up. */
  lookup: CompanyGroup[]
  /** People who get an HQ already known for their company, for free. */
  copy: Array<{ ids: string[]; hq: CompanyHq }>
  /** People with no company name, who can't be looked up. */
  noCompany: number
}

/**
 * Works out what a lookup needs to do for `people`. `known` is everyone in the list, so an HQ found
 * for one person at a company is reused for colleagues instead of asking the AI again.
 * With `redo`, every AI answer is looked up again; HQs you typed are always kept.
 */
export function planHqLookup(people: Contact[], known: Contact[], redo = false): HqPlan {
  const knownHq = new Map<string, CompanyHq>()
  for (const c of known) {
    if (!c.companyHq || (redo && c.companyHq.origin === 'ai')) continue
    for (const key of companyKeys(c)) {
      const prev = knownHq.get(key)
      // A typed HQ beats an AI one; a found HQ beats "unknown".
      if (!prev || rank(c.companyHq) > rank(prev)) knownHq.set(key, c.companyHq)
    }
  }

  const groups = new Map<string, CompanyGroup>()
  const copies = new Map<string, { ids: string[]; hq: CompanyHq }>()
  let noCompany = 0
  for (const c of people) {
    if (c.companyHq && c.companyHq.origin !== 'ai') continue
    if (c.companyHq && !(redo && c.companyHq.origin === 'ai')) continue
    const key = companyKey(c)
    if (!key) {
      noCompany++
      continue
    }
    const hq = companyKeys(c)
      .map((k) => knownHq.get(k))
      .find(Boolean)
    if (hq) {
      const entry = copies.get(key) ?? { ids: [], hq }
      entry.ids.push(c.id)
      copies.set(key, entry)
      continue
    }
    const g = groups.get(key) ?? { key, company: c.company ?? '', domain: domainOf(c.enrichment?.website), people: [] }
    if (!g.company && c.company) g.company = c.company
    g.people.push(c)
    groups.set(key, g)
  }
  return { lookup: [...groups.values()], copy: [...copies.values()], noCompany }
}

const ORIGIN_RANK: Record<CompanyHq['origin'], number> = { manual: 5, import: 4, web: 3, provider: 3, ai: 2 }
/** A typed HQ beats an imported one, which beats the company's website or a data provider, which beats the AI's guess. */
export const rank = (hq: CompanyHq) => (hq.status === 'found' ? ORIGIN_RANK[hq.origin] : 1)
