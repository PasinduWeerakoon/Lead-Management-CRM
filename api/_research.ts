import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { checkAccess, json } from './_db'

/**
 * Reads a company's own public website and job feeds for "Company research". Browsers can't fetch
 * other sites, so this runs on the server — carefully:
 *  - only public https sites (no IP addresses, no private or internal networks — checked after DNS)
 *  - robots.txt is respected, a handful of pages per company, short timeouts and size limits
 *  - job openings come from the public job-board APIs that careers pages link to
 * Nothing is stored here; the page text and jobs go back to the browser.
 */

const UA = 'LeadsResearchBot/1.0 (+company research for a private lead list; respects robots.txt)'
const PAGE_TIMEOUT_MS = 8000
const MAX_BYTES = 1_500_000
const MAX_TEXT = 8000
const SUBPAGES = ['/about', '/about-us', '/company', '/contact', '/contact-us', '/careers', '/jobs', '/news']
const MAX_SUBPAGES = 4
/** Whole-site budget, so one request always answers within the host's limit (CloudFront waits 60s). */
const SITE_BUDGET_MS = 40_000

export const DOMAIN = /^(?=.{4,200}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

/** Private, loopback, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return true
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

/** A host is fetchable only if it's a real public domain that resolves only to public addresses. */
export async function assertPublicHost(host: string, resolve = lookup): Promise<void> {
  const h = host.toLowerCase()
  if (!DOMAIN.test(h) || isIP(h) || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h))
    throw new Error('Not a public website.')
  const addrs = await resolve(h, { all: true })
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('Not a public website.')
}

interface Fetched {
  url: string
  status: number
  type: string
  body: string
}

/** GET with redirects checked hop by hop, a timeout and a size cap. */
async function safeGet(
  url: string,
  fetchImpl: typeof fetch,
  accept = 'text/html,application/json',
  post?: unknown,
): Promise<Fetched> {
  let current = new URL(url)
  for (let hop = 0; hop < 4; hop++) {
    if (current.protocol !== 'https:') throw new Error('Only https is allowed.')
    await assertPublicHost(current.hostname)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: accept, ...(post ? { 'Content-Type': 'application/json' } : {}) },
        ...(post ? { method: 'POST', body: JSON.stringify(post) } : {}),
      })
    } finally {
      clearTimeout(timer)
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current)
      continue
    }
    const type = res.headers.get('content-type') ?? ''
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) {
          await reader.cancel()
          break
        }
        chunks.push(value)
      }
    }
    const body = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))))
    return { url: current.toString(), status: res.status, type, body }
  }
  throw new Error('Too many redirects.')
}

/** Minimal robots.txt check for our user agent / "*". */
export function robotsAllows(robots: string, path: string): boolean {
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim())
  let applies = false
  let inGroup = false
  const rules: Array<{ allow: boolean; path: string }> = []
  for (const line of lines) {
    const [k, ...rest] = line.split(':')
    const key = k?.trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      if (!inGroup) applies = false
      inGroup = true
      if (value === '*' || /leadsresearchbot/i.test(value)) applies = true
    } else if (key === 'allow' || key === 'disallow') {
      inGroup = false
      if (applies && value) rules.push({ allow: key === 'allow', path: value })
    }
  }
  // Robots rules: "*" matches anything, a trailing "$" anchors the end; the longest matching rule wins.
  const toRegex = (rule: string) =>
    new RegExp(
      '^' +
        rule
          .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\$$|\$$/, '$'),
    )
  const match = rules
    .filter((r) => {
      try {
        return toRegex(r.path).test(path)
      } catch {
        return false
      }
    })
    .sort((a, b) => b.path.length - a.path.length)[0]
  return !match || match.allow
}

/** Visible text of an HTML page: no scripts/styles/tags, collapsed whitespace. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return { title, text: text.slice(0, MAX_TEXT) }
}

export interface AtsBoard {
  ats:
    | 'greenhouse'
    | 'lever'
    | 'ashby'
    | 'workable'
    | 'smartrecruiters'
    | 'recruitee'
    | 'workday'
    | 'bamboohr'
    | 'breezy'
    | 'personio'
    | 'teamtailor'
  /** Board name; for Workday "host|tenant|site". */
  slug: string
}

/** Job boards linked from a page, e.g. boards.greenhouse.io/acme or jobs.lever.co/acme. */
export function findAtsBoards(html: string): AtsBoard[] {
  const found = new Map<string, AtsBoard>()
  const add = (ats: AtsBoard['ats'], slug: string) => {
    const s = slug.toLowerCase()
    if (/^[a-z0-9][a-z0-9_-]{0,80}$/.test(s) && !['embed', 'api', 'v1', 'jobs'].includes(s))
      found.set(`${ats}:${s}`, { ats, slug: s })
  }
  for (const m of html.matchAll(
    /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/g,
  ))
    add('greenhouse', m[1])
  for (const m of html.matchAll(/jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9_-]+)/g)) add('lever', m[1])
  for (const m of html.matchAll(/jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/g)) add('ashby', m[1])
  for (const m of html.matchAll(/apply\.workable\.com\/([A-Za-z0-9_-]+)/g)) add('workable', m[1])
  for (const m of html.matchAll(/(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g))
    add('smartrecruiters', m[1])
  for (const m of html.matchAll(/https?:\/\/([a-z0-9-]+)\.recruitee\.com/g)) add('recruitee', m[1])
  for (const m of html.matchAll(/https?:\/\/([a-z0-9-]+)\.bamboohr\.com/g)) add('bamboohr', m[1])
  for (const m of html.matchAll(/https?:\/\/([a-z0-9-]+)\.breezy\.hr/g)) add('breezy', m[1])
  for (const m of html.matchAll(/https?:\/\/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/g)) add('personio', m[1])
  for (const m of html.matchAll(/https?:\/\/([a-z0-9-]+)\.teamtailor\.com/g)) add('teamtailor', m[1])
  // Workday: https://<tenant>.wd5.myworkdayjobs.com/[en-US/]<site>
  for (const m of html.matchAll(
    /https?:\/\/(([a-z0-9-]+)\.wd\d{1,3}\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g,
  )) {
    const [, host, tenant, site] = m
    if (!['wday', 'en-US'].includes(site))
      found.set(`workday:${host}|${site}`, { ats: 'workday', slug: `${host}|${tenant}|${site}` })
  }
  return [...found.values()].slice(0, 3)
}

export interface Job {
  title: string
  location?: string
  url?: string
  postedAt?: string
  source: string
}

const str = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined

/** Open roles from a job board's public API. */
export async function fetchJobs(board: AtsBoard, fetchImpl: typeof fetch = fetch): Promise<Job[]> {
  if (board.ats === 'workday') return fetchWorkday(board.slug, fetchImpl)
  if (board.ats === 'personio' || board.ats === 'teamtailor') return fetchXmlJobs(board, fetchImpl)
  const urls: Record<Exclude<AtsBoard['ats'], 'workday' | 'personio' | 'teamtailor'>, string> = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs`,
    lever: `https://api.lever.co/v0/postings/${board.slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${board.slug}`,
    workable: `https://apply.workable.com/api/v1/widget/accounts/${board.slug}`,
    smartrecruiters: `https://api.smartrecruiters.com/v1/companies/${board.slug}/postings`,
    recruitee: `https://${board.slug}.recruitee.com/api/offers/`,
    bamboohr: `https://${board.slug}.bamboohr.com/careers/list`,
    breezy: `https://${board.slug}.breezy.hr/json`,
  }
  const res = await safeGet(urls[board.ats as keyof typeof urls], fetchImpl, 'application/json')
  if (res.status !== 200) return []
  let data: Record<string, unknown> | unknown[]
  try {
    data = JSON.parse(res.body)
  } catch {
    return []
  }
  const d = data as Record<string, Array<Record<string, unknown>>>
  const list: Array<Record<string, unknown>> =
    board.ats === 'lever'
      ? Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : []
      : board.ats === 'greenhouse'
        ? (d.jobs ?? [])
        : board.ats === 'ashby'
          ? (d.jobs ?? [])
          : board.ats === 'workable'
            ? (d.jobs ?? [])
            : board.ats === 'smartrecruiters'
              ? (d.content ?? [])
              : board.ats === 'bamboohr'
                ? (d.result ?? [])
                : board.ats === 'breezy'
                  ? Array.isArray(data)
                    ? (data as Array<Record<string, unknown>>)
                    : []
                  : (d.offers ?? [])
  const source = board.ats.charAt(0).toUpperCase() + board.ats.slice(1)
  return list
    .map((j): Job | undefined => {
      const loc = j.location as Record<string, unknown> | string | undefined
      const categories = j.categories as Record<string, unknown> | undefined
      const title = str(j.title ?? j.text ?? j.name ?? j.jobOpeningName)
      if (!title) return undefined
      return {
        title,
        location: str(typeof loc === 'string' ? loc : (loc?.name ?? loc?.city ?? categories?.location ?? j.city), 120),
        url: str(j.absolute_url ?? j.hostedUrl ?? j.jobUrl ?? j.url ?? j.careers_url ?? j.shortlink, 500),
        postedAt: str(
          j.updated_at ?? j.publishedAt ?? j.published_on ?? j.releasedDate ?? j.created_at ?? j.createdAt,
          40,
        ),
        source,
      }
    })
    .filter((j): j is Job => !!j)
    .slice(0, 150)
}

export interface SiteResult {
  ok: boolean
  /** The site's address after redirects. */
  url?: string
  title?: string
  pages: Array<{ url: string; title: string; text: string }>
  jobs: Job[]
  boards: AtsBoard[]
  /** Pages skipped because robots.txt asks bots not to read them. */
  blocked: string[]
  error?: string
}

/** Home page plus a few about/contact/careers pages, and any job boards they link to. */
export async function readSite(domain: string, fetchImpl: typeof fetch = fetch): Promise<SiteResult> {
  const deadline = Date.now() + SITE_BUDGET_MS
  const late = () => Date.now() > deadline
  const result: SiteResult = { ok: false, pages: [], jobs: [], boards: [], blocked: [] }
  let robots = ''
  try {
    const r = await safeGet(`https://${domain}/robots.txt`, fetchImpl, 'text/plain')
    if (r.status === 200 && r.type.includes('text')) robots = r.body
  } catch {
    // no robots.txt: allowed
  }
  if (!robotsAllows(robots, '/'))
    return { ...result, blocked: ['/'], error: 'This site asks bots not to read it (robots.txt).' }

  let home: Fetched
  try {
    home = await safeGet(`https://${domain}/`, fetchImpl)
  } catch (e) {
    // Some sites only answer on www. (e.g. their bare domain has no web server).
    try {
      home = await safeGet(`https://www.${domain}/`, fetchImpl)
    } catch {
      return { ...result, error: e instanceof Error ? e.message : 'Could not open the website.' }
    }
  }
  if (home.status >= 400 || !home.type.includes('html'))
    return { ...result, error: `The website answered ${home.status}.` }
  const base = new URL(home.url)
  const homeText = htmlToText(home.body)
  result.ok = true
  result.url = home.url
  result.title = homeText.title
  result.pages.push({ url: home.url, ...homeText })
  const boards = new Map(findAtsBoards(home.body).map((b) => [`${b.ats}:${b.slug}`, b]))
  const pageJobs: Job[] = jobPostingsFromHtml(home.body, home.url)

  // Same-site links the home page itself points to come first (they exist), then common paths.
  const linked = [...home.body.matchAll(/href=["']([^"'#]+)["']/gi)]
    .map((m) => {
      try {
        return new URL(m[1], base)
      } catch {
        return undefined
      }
    })
    .filter(
      (u): u is URL =>
        !!u && u.hostname === base.hostname && /about|company|contact|career|jobs|news|who-we-are/i.test(u.pathname),
    )
    .map((u) => u.pathname.replace(/\/+$/, '') || '/')
  const paths = [...new Set([...linked, ...SUBPAGES])].filter((p) => p !== '/').slice(0, 12)

  let read = 0
  for (const path of paths) {
    if (read >= MAX_SUBPAGES || late()) break
    if (!robotsAllows(robots, path)) {
      result.blocked.push(path)
      continue
    }
    try {
      const page = await safeGet(new URL(path, base).toString(), fetchImpl)
      if (page.status !== 200 || !page.type.includes('html')) continue
      read++
      result.pages.push({ url: page.url, ...htmlToText(page.body) })
      for (const b of findAtsBoards(page.body)) boards.set(`${b.ats}:${b.slug}`, b)
      pageJobs.push(...jobPostingsFromHtml(page.body, page.url))
    } catch {
      // skip this page
    }
  }

  // No jobs linked from the main site? Many companies use careers.<domain> or jobs.<domain>.
  if (!boards.size && !pageJobs.length && !late()) {
    for (const sub of ['careers', 'jobs']) {
      const host = `${sub}.${domain}`
      try {
        await assertPublicHost(host)
      } catch {
        continue // doesn't exist
      }
      let subRobots = ''
      try {
        const r = await safeGet(`https://${host}/robots.txt`, fetchImpl, 'text/plain')
        if (r.status === 200 && r.type.includes('text')) subRobots = r.body
      } catch {
        // none: allowed
      }
      if (!robotsAllows(subRobots, '/')) {
        result.blocked.push(host)
        continue
      }
      try {
        const page = await safeGet(`https://${host}/`, fetchImpl)
        if (page.status !== 200 || !page.type.includes('html')) continue
        result.pages.push({ url: page.url, ...htmlToText(page.body) })
        for (const b of findAtsBoards(page.body)) boards.set(`${b.ats}:${b.slug}`, b)
        pageJobs.push(...jobPostingsFromHtml(page.body, page.url))
        break
      } catch {
        // unreachable: try the next
      }
    }
  }

  result.boards = [...boards.values()].slice(0, 3)
  for (const b of result.boards) {
    if (late()) break
    try {
      result.jobs.push(...(await fetchJobs(b, fetchImpl)))
    } catch {
      // board unavailable
    }
  }
  // Jobs embedded in the careers pages themselves, without duplicating the job-board ones.
  const seen = new Set(result.jobs.map((j) => j.title.toLowerCase()))
  for (const j of pageJobs) {
    if (seen.has(j.title.toLowerCase())) continue
    seen.add(j.title.toLowerCase())
    result.jobs.push(j)
  }
  return result
}

/** Is this site really the company's? Its name words appear in the page title or opening text. */
export function siteMatchesCompany(company: string, site: Pick<SiteResult, 'title' | 'pages'>): boolean {
  const words = company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|plc|pvt|private|corp|corporation|co|company|group|holdings|the|and|of)\b/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
  if (!words.length) return false
  const hay = `${site.title ?? ''} ${site.pages[0]?.text.slice(0, 3000) ?? ''}`.toLowerCase()
  const hits = words.filter((w) => hay.includes(w)).length
  return hits >= Math.ceil(words.length / 2)
}

/** POST /api/research { domain, company } → the site's pages and jobs, and whether it's really this company. */
export async function handleResearch(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const denied = checkAccess(request)
  if (denied) return denied
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' })
  let body: { domain?: unknown; company?: unknown }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
  const domain =
    typeof body.domain === 'string'
      ? body.domain
          .trim()
          .toLowerCase()
          .replace(/^www\./, '')
      : ''
  const company = typeof body.company === 'string' ? body.company.slice(0, 300) : ''
  if (!DOMAIN.test(domain)) return json(400, { error: 'Invalid domain.' })
  const site = await readSite(domain, fetchImpl)
  return json(200, { ...site, matchesCompany: site.ok && company ? siteMatchesCompany(company, site) : false })
}

/** Workday's public careers search (the same request its own careers page makes). */
async function fetchWorkday(slug: string, fetchImpl: typeof fetch): Promise<Job[]> {
  const [host, tenant, site] = slug.split('|')
  if (!host || !tenant || !site || !/\.myworkdayjobs\.com$/.test(host)) return []
  const res = await safeGet(`https://${host}/wday/cxs/${tenant}/${site}/jobs`, fetchImpl, 'application/json', {
    appliedFacets: {},
    limit: 20,
    offset: 0,
    searchText: '',
  })
  if (res.status !== 200) return []
  try {
    const data = JSON.parse(res.body) as {
      total?: number
      jobPostings?: Array<{ title?: string; externalPath?: string; locationsText?: string; postedOn?: string }>
    }
    return (data.jobPostings ?? [])
      .filter((j) => j.title)
      .map((j) => ({
        title: str(j.title)!,
        location: str(j.locationsText, 120),
        url: j.externalPath ? `https://${host}/${site}${j.externalPath}` : undefined,
        postedAt: str(j.postedOn, 40),
        source: 'Workday',
      }))
  } catch {
    return []
  }
}

const xmlText = (block: string, tag: string) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i'))
  return m ? str(m[1].replace(/<[^>]+>/g, ' ')) : undefined
}

/** Personio (XML feed) and Teamtailor (RSS) job lists. */
async function fetchXmlJobs(board: AtsBoard, fetchImpl: typeof fetch): Promise<Job[]> {
  const url =
    board.ats === 'personio'
      ? `https://${board.slug}.jobs.personio.de/xml`
      : `https://${board.slug}.teamtailor.com/jobs.rss`
  const res = await safeGet(url, fetchImpl, 'application/xml,text/xml')
  if (res.status !== 200) return []
  const tag = board.ats === 'personio' ? 'position' : 'item'
  return [...res.body.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi'))]
    .map(([block]): Job | undefined => {
      const title = xmlText(block, board.ats === 'personio' ? 'name' : 'title')
      if (!title) return undefined
      return {
        title,
        location: xmlText(block, board.ats === 'personio' ? 'office' : 'tt:location') ?? xmlText(block, 'location'),
        url:
          board.ats === 'personio'
            ? (() => {
                const id = xmlText(block, 'id')
                return id ? `https://${board.slug}.jobs.personio.de/job/${id}` : undefined
              })()
            : xmlText(block, 'link'),
        postedAt: xmlText(block, board.ats === 'personio' ? 'createdAt' : 'pubDate'),
        source: board.ats === 'personio' ? 'Personio' : 'Teamtailor',
      }
    })
    .filter((j): j is Job => !!j)
    .slice(0, 150)
}

/**
 * Jobs a careers page describes in schema.org JobPosting data (JSON-LD) — the same structured data
 * Google reads for its job search.
 */
export function jobPostingsFromHtml(html: string, pageUrl: string): Job[] {
  const jobs: Job[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const o = node as Record<string, unknown>
    const type = o['@type']
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
      const title = str(o.title)
      if (title) {
        const loc = (Array.isArray(o.jobLocation) ? o.jobLocation[0] : o.jobLocation) as
          { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: unknown } } | undefined
        const a = loc?.address
        const country =
          typeof a?.addressCountry === 'string' ? a.addressCountry : (a?.addressCountry as { name?: string })?.name
        jobs.push({
          title,
          location: str([a?.addressLocality, a?.addressRegion, country].filter(Boolean).join(', '), 120),
          url: str(o.url, 500) ?? pageUrl,
          postedAt: str(o.datePosted, 40),
          source: 'Careers page',
        })
      }
    }
    if (o['@graph']) visit(o['@graph'])
    if (o.itemListElement) visit(o.itemListElement)
    if (o.item) visit(o.item)
  }
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()))
    } catch {
      // malformed JSON-LD: skip
    }
  }
  return jobs.slice(0, 100)
}
