import { requireUser } from './_auth.js'
import { json } from './_db.js'

/**
 * Extra free sources, fetched on the server (they don't allow browser calls, or need a key):
 *  - SEC EDGAR: official facts for US public companies (no key).
 *  - Wikidata: founded, HQ, CEO, employees, website, industry (no key). Kept only when its website
 *    matches the company's, so a namesake is never used.
 *  - Adzuna: US job listings by company, with salaries (ADZUNA_APP_ID / ADZUNA_APP_KEY, free).
 *  - Hunter: a person's work email, kept only when found on public pages or verified (HUNTER_API_KEY).
 * Every value carries the page it came from.
 */

const UA = 'LeadsManager/1.0 (1 Billion Technology; internal research tool)'
const TIMEOUT = 12_000

type Fetch = typeof fetch

async function getJson<T>(url: string, f: Fetch, headers: Record<string, string> = {}): Promise<T | undefined> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await f(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
      signal: ctrl.signal,
    })
    return res.ok ? ((await res.json()) as T) : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(t)
  }
}

/** "Sysco LABS Sri Lanka (Pvt) Ltd." and "sysco labs" compare equal; legal suffixes are ignored. */
export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(
      /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|pvt|private|group|holdings|the)\b\.?/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const host = (u?: string) => {
  try {
    return u ? new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase() : ''
  } catch {
    return ''
  }
}

// --- SEC EDGAR -----------------------------------------------------------------------------------

interface Tickers {
  [k: string]: { cik_str: number; ticker: string; title: string }
}
let tickerCache: { at: number; list: Array<{ cik: number; ticker: string; title: string; norm: string }> } | undefined

export interface EdgarFacts {
  name: string
  ticker?: string
  exchange?: string
  industry?: string
  address?: string
  phone?: string
  website?: string
  formerNames?: string[]
  url: string
}

export async function edgarLookup(company: string, f: Fetch = fetch): Promise<EdgarFacts | undefined> {
  if (!tickerCache || Date.now() - tickerCache.at > 86_400_000) {
    const data = await getJson<Tickers>('https://www.sec.gov/files/company_tickers.json', f)
    if (!data) return undefined
    tickerCache = {
      at: Date.now(),
      list: Object.values(data).map((d) => ({
        cik: d.cik_str,
        ticker: d.ticker,
        title: d.title,
        norm: normName(d.title),
      })),
    }
  }
  const want = normName(company)
  if (want.length < 3) return undefined
  const hit = tickerCache.list.find((d) => d.norm === want)
  if (!hit) return undefined
  const cik = String(hit.cik).padStart(10, '0')
  interface Sub {
    name?: string
    sicDescription?: string
    website?: string
    phone?: string
    exchanges?: string[]
    formerNames?: Array<{ name: string }>
    addresses?: { business?: { street1?: string; city?: string; stateOrCountry?: string; zipCode?: string } }
  }
  const sub = await getJson<Sub>(`https://data.sec.gov/submissions/CIK${cik}.json`, f)
  const a = sub?.addresses?.business
  return {
    name: sub?.name ?? hit.title,
    ticker: hit.ticker,
    ...(sub?.exchanges?.[0] ? { exchange: sub.exchanges[0] } : {}),
    ...(sub?.sicDescription ? { industry: sub.sicDescription } : {}),
    ...(a?.city ? { address: [a.street1, a.city, a.stateOrCountry, a.zipCode].filter(Boolean).join(', ') } : {}),
    ...(sub?.phone ? { phone: sub.phone } : {}),
    ...(sub?.website ? { website: sub.website } : {}),
    ...(sub?.formerNames?.length ? { formerNames: sub.formerNames.map((n) => n.name).slice(0, 5) } : {}),
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
  }
}

// --- Wikidata ------------------------------------------------------------------------------------

export interface WikiFacts {
  id: string
  label: string
  description?: string
  founded?: string
  hq?: string
  ceo?: string
  employees?: string
  industry?: string[]
  website?: string
  url: string
}

interface Claim {
  rank?: 'preferred' | 'normal' | 'deprecated'
  mainsnak?: { datavalue?: { value?: unknown } }
  qualifiers?: Record<string, Array<{ datavalue?: { value?: { time?: string } } }>>
}
interface Entity {
  labels?: { en?: { value: string } }
  descriptions?: { en?: { value: string } }
  claims?: Record<string, Claim[]>
}

const val = (e: Entity, p: string) => e.claims?.[p]?.map((c) => c.mainsnak?.datavalue?.value).filter(Boolean) ?? []

/**
 * The current value of a property: a "preferred" statement, else one with no end date (P582), else the
 * one with the latest point in time (P585). Wikidata keeps past CEOs and old headcounts too.
 */
function current(e: Entity, p: string): unknown {
  const claims = (e.claims?.[p] ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue)
  const pick =
    claims.find((c) => c.rank === 'preferred') ??
    [...claims]
      .sort((a, b) =>
        (b.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? '').localeCompare(
          a.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? '',
        ),
      )
      .find((c) => !c.qualifiers?.P582)
  return pick?.mainsnak?.datavalue?.value
}

export async function wikidataLookup(company: string, domain: string | undefined, f: Fetch = fetch) {
  if (!domain) return undefined
  const search = await getJson<{ search?: Array<{ id: string }> }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(company)}`,
    f,
  )
  const ids = search?.search?.map((s) => s.id) ?? []
  if (!ids.length) return undefined
  const data = await getJson<{ entities?: Record<string, Entity> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|descriptions|claims&languages=en&ids=${ids.join('|')}`,
    f,
  )
  // Only an item whose official website is the company's own domain counts.
  const entry = Object.entries(data?.entities ?? {}).find(([, e]) =>
    val(e, 'P856').some((w) => typeof w === 'string' && host(w) === host(domain)),
  )
  if (!entry) return undefined
  const [id, e] = entry
  const itemIds = (p: string) =>
    val(e, p)
      .map((v) => (v as { id?: string }).id)
      .filter((x): x is string => !!x)
  const refs = [...itemIds('P159'), ...itemIds('P169'), ...itemIds('P452')].slice(0, 20)
  const labels = refs.length
    ? await getJson<{ entities?: Record<string, Entity> }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${refs.join('|')}`,
        f,
      )
    : undefined
  const label = (q: string) => labels?.entities?.[q]?.labels?.en?.value
  const time = val(e, 'P571')[0] as { time?: string } | undefined
  const empNow = Number((current(e, 'P1128') as { amount?: string } | undefined)?.amount)
  const ceoId = (current(e, 'P169') as { id?: string } | undefined)?.id
  const hqId = (current(e, 'P159') as { id?: string } | undefined)?.id
  return {
    id,
    label: e.labels?.en?.value ?? company,
    ...(e.descriptions?.en?.value ? { description: e.descriptions.en.value } : {}),
    ...(time?.time ? { founded: time.time.slice(1, 5) } : {}),
    ...(hqId && label(hqId) ? { hq: label(hqId) } : {}),
    ...(ceoId && label(ceoId) ? { ceo: label(ceoId) } : {}),
    ...(empNow > 0 ? { employees: empNow.toLocaleString('en-US') } : {}),
    ...(itemIds('P452').length
      ? {
          industry: itemIds('P452')
            .map(label)
            .filter((x): x is string => !!x && !/classification/i.test(x))
            .slice(0, 5),
        }
      : {}),
    website: String(val(e, 'P856')[0]),
    url: `https://www.wikidata.org/wiki/${id}`,
  } satisfies WikiFacts
}

// --- Adzuna --------------------------------------------------------------------------------------

export interface AdzunaJob {
  title: string
  url: string
  location?: string
  postedAt?: string
  salary?: string
  type?: string
  summary?: string
}

export const adzunaConfigured = () => !!(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim())

export async function adzunaJobs(company: string, country = 'us', f: Fetch = fetch): Promise<AdzunaJob[]> {
  if (!adzunaConfigured()) return []
  interface Res {
    results?: Array<{
      title?: string
      redirect_url?: string
      created?: string
      description?: string
      contract_time?: string
      salary_min?: number
      salary_max?: number
      location?: { display_name?: string }
      company?: { display_name?: string }
    }>
  }
  const q = new URLSearchParams({
    app_id: process.env.ADZUNA_APP_ID!.trim(),
    app_key: process.env.ADZUNA_APP_KEY!.trim(),
    company,
    results_per_page: '50',
    'content-type': 'application/json',
  })
  const data = await getJson<Res>(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${q}`, f)
  const want = normName(company)
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
  return (data?.results ?? [])
    .filter((r) => r.title && r.redirect_url && normName(r.company?.display_name ?? '').includes(want))
    .slice(0, 40)
    .map((r) => ({
      title: r.title!.replace(/<[^>]+>/g, '').slice(0, 200),
      url: r.redirect_url!.slice(0, 500),
      ...(r.location?.display_name ? { location: r.location.display_name.slice(0, 120) } : {}),
      ...(r.created ? { postedAt: r.created.slice(0, 10) } : {}),
      ...(r.salary_min && r.salary_max
        ? { salary: r.salary_min === r.salary_max ? usd(r.salary_min) : `${usd(r.salary_min)}–${usd(r.salary_max)}` }
        : {}),
      ...(r.contract_time ? { type: r.contract_time.replace('_', '-') } : {}),
      ...(r.description
        ? {
            summary: r.description
              .replace(/<[^>]+>/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 300),
          }
        : {}),
    }))
}

// --- Hunter --------------------------------------------------------------------------------------

export const hunterConfigured = () => !!process.env.HUNTER_API_KEY?.trim()

export interface HunterEmail {
  email: string
  /** Pages Hunter found the address on, or "verified" when it passed Hunter's check. */
  basis: string
  url: string
}

export async function hunterEmail(first: string, last: string, domain: string, f: Fetch = fetch) {
  if (!hunterConfigured() || !first || !last || !domain) return undefined
  interface Res {
    data?: {
      email?: string | null
      score?: number
      sources?: Array<{ uri?: string }>
      verification?: { status?: string }
    }
  }
  const q = new URLSearchParams({
    domain,
    first_name: first,
    last_name: last,
    api_key: process.env.HUNTER_API_KEY!.trim(),
  })
  const data = await getJson<Res>(`https://api.hunter.io/v2/email-finder?${q}`, f)
  const d = data?.data
  if (!d?.email) return undefined
  const sources = (d.sources ?? []).map((s) => s.uri).filter((u): u is string => !!u)
  const verified = d.verification?.status === 'valid'
  // A pattern guess with no page and no verification isn't kept: the privacy page says emails are never guessed.
  if (!sources.length && !verified) return undefined
  return {
    email: d.email.toLowerCase(),
    basis: sources.length
      ? `Hunter: found on ${sources.length} public ${sources.length === 1 ? 'page' : 'pages'}`
      : 'Hunter: verified',
    url: sources[0] ?? `https://hunter.io/verify/${encodeURIComponent(d.email)}`,
  } satisfies HunterEmail
}

// --- route ---------------------------------------------------------------------------------------

/**
 * GET /api/sources?op=status                         → which keyed sources are set up
 * GET /api/sources?op=company&name=…&domain=…&country=us → { edgar, wikidata, jobs }
 * GET /api/sources?op=email&first=…&last=…&domain=…    → { email } or {}
 */
export async function handleSources(request: Request, f: Fetch = fetch): Promise<Response> {
  const denied = requireUser(request)
  if (denied) return denied
  const u = new URL(request.url)
  const op = u.searchParams.get('op')
  const str = (k: string, max = 200) => (u.searchParams.get(k) ?? '').trim().slice(0, max)
  if (op === 'status') return json(200, { adzuna: adzunaConfigured(), hunter: hunterConfigured() })
  if (op === 'company') {
    const name = str('name')
    if (name.length < 2) return json(400, { error: 'Missing company name.' })
    const domain = str('domain') || undefined
    const country = /^[a-z]{2}$/.test(str('country')) ? str('country') : 'us'
    const [edgar, wikidata, jobs] = await Promise.all([
      edgarLookup(name, f).catch(() => undefined),
      wikidataLookup(name, domain, f).catch(() => undefined),
      // jobs=0 skips Adzuna (Coresignal mode gets jobs from Coresignal and careers pages).
      str('jobs') === '0' ? [] : adzunaJobs(name, country, f).catch(() => []),
    ])
    return json(200, { edgar: edgar ?? null, wikidata: wikidata ?? null, jobs })
  }
  if (op === 'email') {
    const r = await hunterEmail(str('first', 80), str('last', 80), str('domain'), f).catch(() => undefined)
    return json(200, r ? { email: r } : {})
  }
  return json(400, { error: 'Unknown op.' })
}
