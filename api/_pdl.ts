/**
 * People Data Labs: a trial alternative to Coresignal (PDL_API_KEY, switched on with DATA_PROVIDER=pdl).
 * Results are mapped to the same `web` and `research` shapes as Coresignal, so the app needs no other change.
 *  - person:  enrich by LinkedIn profile URL (1 credit when a record matches, nothing on a miss).
 *  - company: enrich by LinkedIn page, website or name (1 credit when a record matches). PDL has no job posts.
 */

const BASE = 'https://api.peopledatalabs.com/v5'
const TIMEOUT = 30_000

type Fetch = typeof fetch
type Obj = Record<string, unknown>

export const pdlConfigured = () => !!process.env.PDL_API_KEY?.trim()
export const pdlSelected = () => process.env.DATA_PROVIDER?.trim().toLowerCase() === 'pdl' && pdlConfigured()

export class PdlError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}
/** PDL stores names in lower case: "university of chicago" → "University Of Chicago". */
const title = (v: unknown, max: number) => str(v, max)?.replace(/(^|[\s(/&-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : [])
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})
/** PDL gives "linkedin.com/in/x"; links in the app are full URLs. */
const link = (v: unknown) => {
  const s = str(v, 500)
  return s ? (/^https?:\/\//i.test(s) ? s : `https://${s}`) : undefined
}
const year = (v: unknown) => str(v, 20)?.slice(0, 4)
const years = (from: unknown, to: unknown, current?: boolean) => {
  const a = year(from) ?? ''
  const b = year(to) ?? (current ? 'present' : '')
  return a || b ? `${a || '?'}–${b || 'present'}` : undefined
}
const compact = <T extends Obj>(o: T) =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)),
  ) as T
const shorthand = (url: string | undefined) => url?.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1]?.toLowerCase()

export class Pdl {
  credits = 0
  remaining?: number
  constructor(private f: Fetch) {}

  /** Waits and tries again when PDL says it is busy (several lookups run at once). */
  async get(path: string, params: Record<string, string>): Promise<Obj | undefined> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(path, params)
      } catch (err) {
        if (!(err instanceof PdlError) || err.status !== 429 || attempt >= 3) throw err
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
  }

  private async once(path: string, params: Record<string, string>): Promise<Obj | undefined> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT)
    try {
      const res = await this.f(`${BASE}/${path}?${new URLSearchParams(params)}`, {
        headers: { 'X-Api-Key': process.env.PDL_API_KEY!.trim(), accept: 'application/json' },
        signal: ctrl.signal,
      })
      const left = Number(res.headers.get('x-totallimit-remaining'))
      if (Number.isFinite(left) && res.headers.has('x-totallimit-remaining')) this.remaining = left
      if (res.status === 404) return undefined
      if (res.status === 402) throw new PdlError('People Data Labs credits have run out.', 402)
      if (res.status === 401 || res.status === 403) throw new PdlError('The People Data Labs key was refused.', 401)
      if (res.status === 429) throw new PdlError('People Data Labs is busy. Try again in a minute.', 429)
      this.credits += Number(res.headers.get('x-call-credits-spent') ?? 0) || 0
      if (!res.ok) return undefined
      const body = obj(await res.json())
      return body.data ? obj(body.data) : body
    } catch (err) {
      if (err instanceof PdlError) throw err
      return undefined
    } finally {
      clearTimeout(t)
    }
  }
}

// --- person --------------------------------------------------------------------------------------

export function mapPdlPerson(p: Obj, profileUrl: string) {
  const url = link(p.linkedin_url) ?? profileUrl
  const exp = arr(p.experience)
  const career = exp.slice(0, 15).map((x) => {
    const co = obj(x.company)
    return compact({
      company: title(co.name, 120) ?? 'Unknown company',
      role: title(obj(x.title).name, 120),
      years: years(x.start_date, x.end_date, !x.end_date),
      url: link(co.linkedin_url) ?? link(co.website) ?? url,
    })
  })
  const education = arr(p.education)
    .slice(0, 6)
    .map((x) => {
      const school = obj(x.school)
      const degree = [...(Array.isArray(x.degrees) ? x.degrees : []), ...(Array.isArray(x.majors) ? x.majors : [])]
        .map((d) => title(d, 80))
        .filter(Boolean)
        .join(', ')
      return compact({
        school: title(school.name, 160) ?? 'Unknown school',
        degree: degree || undefined,
        years: years(x.start_date, x.end_date),
        url: link(school.linkedin_url) ?? link(school.website) ?? url,
      })
    })
  const certifications = arr(p.certifications)
    .slice(0, 12)
    .map((x) => ({ name: str(x.name, 120) ?? 'Certification', url }))
  const skills = [
    ...new Set((Array.isArray(p.skills) ? p.skills : []).map((s) => title(s, 60)).filter((s): s is string => !!s)),
  ].slice(0, 25)
  const github = str(p.github_username, 39) ?? str(p.github_url, 300)?.match(/github\.com\/([A-Za-z0-9-]{1,39})/)?.[1]
  // Free plans only say whether an email exists (true/false), so only a real address is kept.
  const email = typeof p.work_email === 'string' && p.work_email.includes('@') ? p.work_email : undefined
  const summary =
    [str(p.headline, 200), str(p.summary, 300)].filter(Boolean).join('. ').slice(0, 400) ||
    [title(p.job_title, 120), title(p.job_company_name, 120)].filter(Boolean).join(' at ') ||
    undefined
  return {
    web: compact({
      status: career.length || education.length || summary ? ('found' as const) : ('not_found' as const),
      match: 'confident' as const,
      summary,
      location: title(p.location_name, 200),
      keywords: skills,
      career,
      education,
      certifications,
      github,
      email: email ? { value: email, url, basis: 'People Data Labs: work email' } : undefined,
      sources: [url],
      note: 'From People Data Labs (licensed data), matched by LinkedIn profile URL.',
      model: 'peopledatalabs',
    }),
    companyLinkedin: shorthand(link(p.job_company_linkedin_url)),
  }
}

export async function pdlPerson(pdl: Pdl, profileUrl: string) {
  const p = await pdl.get('person/enrich', { profile: profileUrl, min_likelihood: '6' })
  return p ? mapPdlPerson(p, profileUrl) : undefined
}

// --- company -------------------------------------------------------------------------------------

export function mapPdlCompany(c: Obj) {
  const site = link(c.website)
  const url = link(c.linkedin_url) ?? site ?? 'https://www.peopledatalabs.com'
  const cite = (value: string | undefined) =>
    value ? { value: value.slice(0, 200), url, quote: 'People Data Labs company record' } : undefined
  const loc = obj(c.location)
  const employees =
    typeof c.employee_count === 'number' ? `${c.employee_count.toLocaleString('en-US')} employees` : undefined
  return compact({
    domain: str(c.website, 200)?.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
    siteUrl: site,
    verified: true,
    hq: cite(title(loc.name, 200) ?? title(loc.country, 200)),
    industry: cite(title(c.industry, 200)),
    size: cite([str(c.size, 80), employees].filter(Boolean).join(', ') || undefined),
    hiring: [],
    summary: str(c.summary, 600) ?? str(c.headline, 300),
    services: (Array.isArray(c.tags) ? c.tags : [])
      .slice(0, 20)
      .map((t) => ({ name: str(t, 120) ?? '', url: site ?? url }))
      .filter((o) => o.name),
    founded: c.founded ? { value: String(c.founded).slice(0, 40), url } : undefined,
    registry: str(c.ticker, 20) ? { name: title(c.name, 200) ?? '', ticker: str(c.ticker, 20), url } : undefined,
    sources: [url, ...(site ? [site] : [])],
    note: 'From People Data Labs (licensed data). PDL has no job posts.',
    model: 'peopledatalabs',
  })
}

export async function pdlCompany(pdl: Pdl, opts: { linkedin?: string; name: string; domain?: string }) {
  const params: Record<string, string> = opts.linkedin
    ? { profile: `linkedin.com/company/${opts.linkedin}` }
    : opts.domain
      ? { website: opts.domain }
      : { name: opts.name }
  // A name-only match scores 3 of 10 even for Google, so PDL's own default threshold is used.
  const c = await pdl.get('company/enrich', params)
  return c ? mapPdlCompany(c) : undefined
}
