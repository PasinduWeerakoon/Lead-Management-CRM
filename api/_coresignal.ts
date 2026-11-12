import { requireUser } from './_auth.js'
import { json } from './_db.js'

/**
 * Coresignal: licensed people, company and job data, fetched on the server (CORESIGNAL_API_KEY).
 *  - person:  one profile by its LinkedIn URL (20 credits), mapped to the app's `web` shape.
 *  - company: one company by LinkedIn page, website or name (search is free, the record is 20 credits),
 *             mapped to the app's `research` shape, with details for a few relevant open jobs (1 credit each).
 * Coresignal licenses this data, so the app no longer reads LinkedIn or other sites itself.
 */

const BASE = 'https://api.coresignal.com/cdapi/v2'
const TIMEOUT = 30_000
/** Details are fetched for this many open jobs per company; the rest are listed by title only. */
const JOB_DETAILS = 8
const TECH_JOB =
  /engineer|developer|software|data|cloud|devops|architect|security|it |infrastructure|erp|crm|sap|salesforce|qa|test|product|ai|machine learning|analytics/i

type Fetch = typeof fetch
type Obj = Record<string, unknown>

export const coresignalConfigured = () => !!process.env.CORESIGNAL_API_KEY?.trim()

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;?/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return s ? s.slice(0, max) : undefined
}
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : [])
const years = (from: unknown, to: unknown, current?: unknown) => {
  const a = from ? String(from) : ''
  const b = to ? String(to) : current ? 'present' : ''
  return a || b ? `${a || '?'}–${b || 'present'}`.slice(0, 40) : undefined
}
const compact = <T extends Obj>(o: T) =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)),
  ) as T

/** "https://www.linkedin.com/in/ana-example/" → "ana-example". */
export function linkedinShorthand(url: string | undefined, kind: 'in' | 'company'): string | undefined {
  const m = url?.match(new RegExp(`linkedin\\.com/${kind}/([^/?#]+)`, 'i'))
  return m ? decodeURIComponent(m[1]).toLowerCase() : undefined
}

class Coresignal {
  credits = 0
  remaining?: number
  constructor(private f: Fetch) {}

  async call(path: string, body?: unknown): Promise<unknown> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT)
    try {
      const res = await this.f(`${BASE}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          apikey: process.env.CORESIGNAL_API_KEY!.trim(),
          accept: 'application/json',
          'content-type': 'application/json',
          // Coresignal's firewall rejects requests without a normal client header.
          'User-Agent': 'Mozilla/5.0 (compatible; LeadsManager/1.0)',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
      this.credits += Number(res.headers.get('x-credits-charged') ?? 0) || 0
      // A refused call (rate limit) reports 0 remaining, so only a successful one updates the balance.
      const left = Number(res.headers.get('x-credits-remaining'))
      if (res.ok && Number.isFinite(left)) this.remaining = left
      if (res.status === 404) return undefined
      if (res.status === 402) throw new CoresignalError('Coresignal credits have run out.', 402)
      if (res.status === 401) throw new CoresignalError('The Coresignal key was refused.', 401)
      if (res.status === 429) throw new CoresignalError('Coresignal is busy. Try again in a minute.', 429)
      if (!res.ok) return undefined
      return await res.json()
    } catch (err) {
      if (err instanceof CoresignalError) throw err
      return undefined
    } finally {
      clearTimeout(t)
    }
  }
}

class CoresignalError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

// --- person --------------------------------------------------------------------------------------

export function mapPerson(e: Obj, profileUrl: string) {
  const url = str(e.linkedin_url, 500) ?? profileUrl
  const exp = arr(e.experience)
  const career = exp.slice(0, 15).map((x) =>
    compact({
      company: str(x.company_name, 120) ?? 'Unknown company',
      role: str(x.position_title, 120),
      years: years(x.date_from_year ?? x.date_from, x.date_to_year ?? x.date_to, x.active_experience),
      url: str(x.company_linkedin_url, 500) ?? url,
    }),
  )
  const education = arr(e.education)
    .slice(0, 6)
    .map((x) =>
      compact({
        school: str(x.institution_name, 160) ?? 'Unknown school',
        degree: str(x.degree, 160),
        years: years(x.date_from_year ?? x.date_from, x.date_to_year ?? x.date_to),
        url: str(x.institution_url, 500) ?? url,
      }),
    )
  const certifications = arr(e.certifications)
    .slice(0, 12)
    .map((x) => ({
      name: str(x.title ?? x.name, 120) ?? 'Certification',
      url: str(x.credential_url ?? x.url, 500) ?? url,
    }))
  const projects = arr(e.projects)
    .slice(0, 10)
    .map((x) =>
      compact({
        name: str(x.name ?? x.title, 160) ?? 'Project',
        summary: str(x.description, 300),
        url: str(x.url, 500) ?? url,
      }),
    )
  const skills = [
    ...new Set(
      [
        ...(Array.isArray(e.inferred_skills) ? e.inferred_skills : []),
        ...(Array.isArray(e.historical_skills) ? e.historical_skills : []),
      ]
        .map((s) => str(s, 60))
        .filter((s): s is string => !!s),
    ),
  ].slice(0, 25)
  const github = str(e.github_url, 300)?.match(/github\.com\/([A-Za-z0-9-]{1,39})/)?.[1]
  const email = str(e.primary_professional_email, 200)
  const summary = [str(e.headline, 200), str(e.summary, 300)].filter(Boolean).join('. ').slice(0, 400) || undefined
  const active = exp.find((x) => x.active_experience) ?? exp[0]
  return {
    web: compact({
      status: career.length || education.length || summary ? ('found' as const) : ('not_found' as const),
      match: 'confident' as const,
      summary,
      location: str(e.location_full, 200),
      keywords: skills,
      career,
      education,
      certifications,
      projects,
      github,
      email: email ? { value: email, url, basis: 'Coresignal: professional email' } : undefined,
      sources: [url],
      note: 'From Coresignal (licensed data), matched by LinkedIn profile URL.',
      model: 'coresignal',
    }),
    /** The current employer's LinkedIn page, so the company can be looked up exactly. */
    companyLinkedin: linkedinShorthand(str(active?.company_linkedin_url, 500), 'company'),
  }
}

async function person(cs: Coresignal, profileUrl: string) {
  const short = linkedinShorthand(profileUrl, 'in')
  if (!short) return undefined
  const e = (await cs.call(`employee_multi_source/collect/${encodeURIComponent(short)}`)) as Obj | undefined
  return e ? mapPerson(e, profileUrl) : undefined
}

// --- company -------------------------------------------------------------------------------------

const LEADER = /\b(chief|ceo|cto|cio|cfo|coo|cmo|ciso|president|founder|vp|vice president|head of|director|partner)\b/i

export function mapCompany(c: Obj, jobs: Obj[]) {
  const site = str(c.website, 300)
  const url = str(c.linkedin_url, 500) ?? site ?? 'https://coresignal.com'
  const cite = (value: string | undefined) =>
    value ? { value: value.slice(0, 200), url, quote: 'Coresignal company record' } : undefined
  const employees =
    typeof c.employees_count === 'number' ? `${c.employees_count.toLocaleString('en-US')} employees` : undefined
  // Jobs read in full come first; the company record's other open roles follow by title only.
  const full = jobs.map((j) => {
    const salary = arr(j.salary)[0]
    return compact({
      title: str(j.title, 200) ?? 'Open role',
      url: str(j.external_url ?? j.url, 500),
      location: str(j.location, 120),
      postedAt: str(j.date_posted, 40)?.slice(0, 10),
      source: 'Coresignal',
      summary: str(j.description, 400),
      team: str(j.department, 80),
      type: Array.isArray(j.employment_type) ? str(j.employment_type.join(', '), 40) : str(j.employment_type, 40),
      level: str(j.seniority ?? j.management_level, 40),
      salary:
        salary && (salary.min_value || salary.max_value)
          ? `${salary.currency ?? ''} ${salary.min_value ?? '?'}–${salary.max_value ?? '?'}`.trim().slice(0, 60)
          : undefined,
    })
  })
  full.sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
  const seen = new Set(full.map((j) => j.title.toLowerCase()))
  const titles = arr(c.active_job_postings)
    .sort(
      (a, b) => Number(TECH_JOB.test(String(b.job_posting_title))) - Number(TECH_JOB.test(String(a.job_posting_title))),
    )
    .map((p) => ({
      title: str(p.job_posting_title, 200) ?? 'Open role',
      url: p.job_posting_id ? `https://www.linkedin.com/jobs/view/${String(p.job_posting_id)}` : undefined,
      source: 'Coresignal',
    }))
    .filter((j) => !seen.has(j.title.toLowerCase()) && (seen.add(j.title.toLowerCase()), true))
  const hiring = [...full, ...titles].slice(0, 40).map((j) => compact(j))
  const ticker = arr(c.stock_ticker)[0]
  return compact({
    domain: str(c.website_domain, 200),
    siteUrl: site,
    verified: true,
    hq: cite(str(c.hq_full_address, 200) ?? str(c.hq_country, 200)),
    industry: cite(str(c.industry, 200)),
    size: cite([str(c.size_range, 80), employees].filter(Boolean).join(', ') || undefined),
    technologies: arr(c.technologies_used)
      .slice(0, 15)
      .map((t) => ({ name: str(t.technology, 80) ?? '', url, quote: 'Coresignal technographics' }))
      .filter((t) => t.name),
    hiring,
    jobsTotal: typeof c.active_job_postings_count === 'number' ? c.active_job_postings_count : hiring.length,
    summary: str(c.description, 600),
    services: (Array.isArray(c.offerings) ? c.offerings : [])
      .slice(0, 20)
      .map((o) => ({ name: str(o, 120) ?? '', url: site ?? url }))
      .filter((o) => o.name),
    offices: arr(c.company_locations_full)
      .slice(0, 15)
      .map((l) => ({ name: str(l.location_address ?? l.city, 120) ?? '', url }))
      .filter((o) => o.name),
    founded: c.founded_year ? { value: String(c.founded_year).slice(0, 40), url } : undefined,
    registry: ticker?.ticker
      ? compact({
          name: str(c.company_name, 200) ?? '',
          ticker: str(ticker.ticker, 20),
          exchange: str(ticker.exchange, 40),
          url,
        })
      : undefined,
    leaders: arr(c.key_executives)
      .filter((x) => LEADER.test(String(x.member_position_title ?? '')))
      .slice(0, 12)
      .map((x) => ({ name: str(x.member_full_name, 120) ?? '', title: str(x.member_position_title, 120) ?? '', url }))
      .filter((x) => x.name),
    news: arr(c.news_articles)
      .slice(0, 10)
      .map((n) =>
        compact({
          text: str(n.headline, 300) ?? '',
          date: str(n.published_date, 40),
          url: str(n.article_url, 500) ?? url,
        }),
      )
      .filter((n) => n.text),
    sources: [url, ...(site ? [site] : [])],
    note: 'From Coresignal (licensed data).',
    model: 'coresignal',
  })
}

async function findCompanyId(cs: Coresignal, name: string, domain?: string): Promise<string | undefined> {
  const must = domain
    ? [{ term: { website_domain: domain.replace(/^www\./, '').toLowerCase() } }]
    : [{ match_phrase: { company_name: name } }]
  const ids = (await cs.call('company_multi_source/search/es_dsl', { query: { bool: { must } } })) as unknown
  return Array.isArray(ids) && ids.length ? String(ids[0]) : undefined
}

async function company(cs: Coresignal, opts: { linkedin?: string; name: string; domain?: string }) {
  let c = opts.linkedin
    ? ((await cs.call(`company_multi_source/collect/${encodeURIComponent(opts.linkedin)}`)) as Obj | undefined)
    : undefined
  if (!c) {
    // A website match is exact; a name match is tried only when there's no website.
    const id =
      (opts.domain && (await findCompanyId(cs, opts.name, opts.domain))) || (await findCompanyId(cs, opts.name))
    if (id) c = (await cs.call(`company_multi_source/collect/${id}`)) as Obj | undefined
  }
  if (!c) return undefined
  // The newest open jobs, found by Coresignal's own job search (free), then read in full (1 credit each).
  const domain = str(c.website_domain, 200)
  const ids = (await cs.call('job_multi_source/search/es_dsl', {
    query: {
      bool: {
        must: domain ? [{ term: { company_domain: domain } }] : [{ match_phrase: { company_name: opts.name } }],
        filter: [{ term: { status: 1 } }],
      },
    },
  })) as unknown
  const wanted = (Array.isArray(ids) ? ids : []).slice(0, JOB_DETAILS)
  // One at a time (Coresignal allows 5 requests a second). A job that can't be read is skipped.
  const jobs: Obj[] = []
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  for (const id of wanted) {
    const get = () => cs.call(`job_multi_source/collect/${String(id)}`)
    await wait(250)
    const j = await get().catch(async () => (await wait(1500), get().catch(() => undefined)))
    if (j && typeof j === 'object') jobs.push(j as Obj)
  }
  return mapCompany(c, jobs)
}

// --- route ---------------------------------------------------------------------------------------

/**
 * GET /api/coresignal?op=status                                → { configured }
 * GET /api/coresignal?op=person&url=<LinkedIn profile URL>      → { web, companyLinkedin, credits }
 * GET /api/coresignal?op=company&name=…&domain=…&linkedin=…     → { research, credits }
 */
export async function handleCoresignal(request: Request, f: Fetch = fetch): Promise<Response> {
  const denied = requireUser(request)
  if (denied) return denied
  const u = new URL(request.url)
  const op = u.searchParams.get('op')
  const q = (k: string, max = 300) => (u.searchParams.get(k) ?? '').trim().slice(0, max)
  if (op === 'status') return json(200, { configured: coresignalConfigured() })
  if (!coresignalConfigured())
    return json(503, { error: 'Coresignal is not set up. Add CORESIGNAL_API_KEY on the server.' })
  const cs = new Coresignal(f)
  try {
    if (op === 'person') {
      const url = q('url', 500)
      if (!linkedinShorthand(url, 'in')) return json(400, { error: 'A LinkedIn profile URL is needed.' })
      const r = await person(cs, url)
      return json(200, { ...(r ?? { web: null }), credits: cs.credits, remaining: cs.remaining })
    }
    if (op === 'company') {
      const name = q('name', 200)
      if (name.length < 2) return json(400, { error: 'Missing company name.' })
      const linkedin = /^[a-z0-9._%-]{1,120}$/i.test(q('linkedin')) ? q('linkedin') : undefined
      const research = await company(cs, { name, domain: q('domain', 200) || undefined, linkedin })
      return json(200, { research: research ?? null, credits: cs.credits, remaining: cs.remaining })
    }
  } catch (err) {
    if (err instanceof CoresignalError) return json(err.status === 402 ? 402 : 502, { error: err.message })
    return json(502, { error: 'Coresignal could not be reached.' })
  }
  return json(400, { error: 'Unknown op.' })
}
