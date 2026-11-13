import { AiError } from '../ai/provider'
import type { Contact } from '../schemas'
import type { CompanyResearch } from './extract'
import type { PersonWeb } from './person'

/**
 * Switch for where web data comes from.
 *  - true:  Coresignal only (licensed people, company and job data). The app reads no websites,
 *           runs no web or LinkedIn searches, and calls no other data source.
 *  - false: the earlier sources: company site crawl, AI web and LinkedIn search, SEC EDGAR,
 *           Wikidata, Adzuna, Hunter and GitHub. That code is kept as it was, only switched off.
 * To go back, set this to false (or revert the commit that added Coresignal).
 */
export const CORESIGNAL_ONLY = true

type Facts = Omit<CompanyResearch, 'status' | 'at'>

async function call<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T & { credits?: number }> {
  let res: Response
  try {
    res = await fetch(`/api/coresignal?${new URLSearchParams(params)}`, { signal })
  } catch {
    if (signal?.aborted) throw new AiError('Stopped.', 'cancelled')
    throw new AiError('Coresignal could not be reached. Check your connection.', 'network')
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; credits?: number }
  if (res.status === 402 || res.status === 503) throw new AiError(body.error ?? 'Coresignal is not available.', 'limit')
  if (!res.ok) throw new AiError(body.error ?? 'Coresignal lookup failed.', 'other')
  return body
}

/** One person's profile, matched exactly by the LinkedIn URL from the connections export. */
export async function fetchCoresignalPerson(
  c: Contact,
  signal?: AbortSignal,
): Promise<{ web: PersonWeb; credits: number }> {
  const at = new Date().toISOString()
  if (!c.profileUrl || !/linkedin\.com\/in\//i.test(c.profileUrl))
    return {
      web: { status: 'not_found', note: 'No LinkedIn profile URL to look up.', at },
      credits: 0,
    }
  const r = await call<{ web: Omit<PersonWeb, 'at'> | null }>({ op: 'person', url: c.profileUrl }, signal)
  return {
    web: r.web ? { ...r.web, at } : { status: 'not_found', note: 'No profile record was found for this LinkedIn URL.', at },
    credits: r.credits ?? 0,
  }
}

/** One company's record (by website when known, else by name), with its open jobs. */
export async function fetchCoresignalCompany(
  name: string,
  domain: string | undefined,
  signal?: AbortSignal,
): Promise<{ research?: Facts; credits: number }> {
  const r = await call<{ research: Facts | null }>({ op: 'company', name, ...(domain ? { domain } : {}) }, signal)
  return { research: r.research ?? undefined, credits: r.credits ?? 0 }
}
