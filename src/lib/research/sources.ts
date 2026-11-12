import type { CompanyResearch } from './extract'

/**
 * Free extra sources fetched through this app's server: SEC EDGAR (US public companies), Wikidata
 * and Adzuna jobs for companies, Hunter for a person's work email. Each value keeps its source page.
 */

type Facts = Omit<CompanyResearch, 'status' | 'at'>

interface CompanyExtras {
  edgar: {
    name: string
    ticker?: string
    exchange?: string
    industry?: string
    address?: string
    phone?: string
    website?: string
    formerNames?: string[]
    url: string
  } | null
  wikidata: {
    label: string
    description?: string
    founded?: string
    hq?: string
    ceo?: string
    employees?: string
    industry?: string[]
    website?: string
    url: string
  } | null
  jobs: Array<{
    title: string
    url: string
    location?: string
    postedAt?: string
    salary?: string
    type?: string
    summary?: string
  }>
}

export async function fetchCompanyExtras(
  name: string,
  domain: string | undefined,
  signal?: AbortSignal,
  opts: { jobs?: boolean } = {},
): Promise<CompanyExtras | undefined> {
  const q = new URLSearchParams({
    op: 'company',
    name,
    ...(domain ? { domain } : {}),
    ...(opts.jobs === false ? { jobs: '0' } : {}),
  })
  const res = await fetch(`/api/sources?${q}`, { signal }).catch(() => undefined)
  return res?.ok ? ((await res.json()) as CompanyExtras) : undefined
}

/** Adds registry, Wikidata and job-board facts to what the site and web search found. Found facts win. */
export function mergeExtras(found: Facts | undefined, x: CompanyExtras | undefined): Facts | undefined {
  if (!x || (!x.edgar && !x.wikidata && !x.jobs.length)) return found
  const base: Facts = found ?? {}
  const w = x.wikidata
  const e = x.edgar
  const titles = new Set((base.hiring ?? []).map((j) => j.title.toLowerCase()))
  const jobs = x.jobs.filter((j) => !titles.has(j.title.toLowerCase())).map((j) => ({ ...j, source: 'Adzuna' }))
  const leaders = base.leaders ?? []
  const hasCeo = leaders.some((l) => /\bceo\b|chief executive/i.test(l.title))
  return {
    ...base,
    ...(e
      ? {
          registry: {
            name: e.name,
            ...(e.ticker ? { ticker: e.ticker } : {}),
            ...(e.exchange ? { exchange: e.exchange } : {}),
            ...(e.industry ? { industry: e.industry } : {}),
            ...(e.address ? { address: e.address } : {}),
            ...(e.phone ? { phone: e.phone } : {}),
            ...(e.formerNames?.length ? { formerNames: e.formerNames } : {}),
            url: e.url,
          },
        }
      : {}),
    ...(!base.domain && (e?.website || w?.website)
      ? { domain: hostOf(e?.website ?? w?.website ?? ''), siteUrl: e?.website ?? w?.website }
      : {}),
    industry:
      base.industry ??
      (e?.industry
        ? { value: e.industry, url: e.url, quote: 'SEC EDGAR' }
        : w?.industry?.length
          ? { value: w.industry.join(', '), url: w.url, quote: 'Wikidata' }
          : undefined),
    hq:
      base.hq ??
      (w?.hq
        ? { value: w.hq, url: w.url, quote: 'Wikidata' }
        : e?.address
          ? { value: e.address, url: e.url, quote: 'SEC EDGAR' }
          : undefined),
    size:
      base.size ?? (w?.employees ? { value: `${w.employees} employees`, url: w.url, quote: 'Wikidata' } : undefined),
    founded: base.founded ?? (w?.founded ? { value: w.founded, url: w.url } : undefined),
    ...(w?.ceo && !hasCeo ? { leaders: [{ name: w.ceo, title: 'CEO', url: w.url }, ...leaders].slice(0, 12) } : {}),
    ...(jobs.length ? { hiring: [...(base.hiring ?? []), ...jobs].slice(0, 40) } : {}),
    sources: [...new Set([...(base.sources ?? []), ...(e ? [e.url] : []), ...(w ? [w.url] : [])])].slice(0, 30),
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/** A work email from Hunter: only addresses Hunter found on public pages or verified. */
export async function fetchWorkEmail(
  first: string,
  last: string,
  domain: string,
  signal?: AbortSignal,
): Promise<{ email: string; basis: string; url: string } | undefined> {
  const q = new URLSearchParams({ op: 'email', first, last, domain })
  const res = await fetch(`/api/sources?${q}`, { signal }).catch(() => undefined)
  if (!res?.ok) return undefined
  return ((await res.json()) as { email?: { email: string; basis: string; url: string } }).email
}
