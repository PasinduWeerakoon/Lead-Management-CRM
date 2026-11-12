import { z } from 'zod'
import type { Contact } from '../schemas'
import { AiError } from '../ai/provider'
import { modelById } from '../ai/models'
import { send } from '../ai/openai-compat'
import { fetchGithub } from './github'

/**
 * "Search the web": one OpenAI web search per person, for their public professional profile —
 * company bios, conference talks, interviews, news, publications and public LinkedIn pages returned by the search,
 * and every fact must point at a page the search actually returned, so nothing is made up.
 * Only professional details are kept: no contact details, family, health, religion or politics.
 */

/** Web search runs on the cheapest GPT: it reads and quotes pages, which doesn't need a big model. */
export const WEB_MODEL = 'gpt-6-luna'
/** Must match the server's MAX_SEARCHES and WEB_SEARCH_USD (api/_ai.ts). */
export const MAX_SEARCHES = 6
export const WEB_SEARCH_USD = 0.01

export type PersonWeb = NonNullable<Contact['web']>

export const WEB_SYSTEM = `You research one professional contact on the public web for a B2B sales team. Collect as much as the public web says about this person: salespeople will later ask unpredictable questions, and anything not collected now can't be used.
Search several ways, using all your searches:
1. Full name with the current company, and full name with the job title.
2. Full name with "university", "graduated", "alumni" or "BSc/MSc/MBA" to find degrees and campus.
3. Full name with "GitHub", "speaker", "conference", "interview", "project" or "case study" (and the company's own site: team, leadership, about, news pages).
4. Business news and press releases (e.g. PR Newswire, Business Wire, GlobeNewswire, TechCrunch, local business papers such as Daily FT or EconomyNext), Crunchbase public pages, SEC filings and proxy statements for executives of US public companies.
5. Personal websites, blogs, Medium, dev.to, GitHub, Google Scholar, ORCID, patents (Google Patents), podcasts, YouTube talks and conference speaker pages.
6. Their university's alumni, faculty or news pages, and professional bodies or award lists.
Use every search you have; stop early only when nothing new is turning up.
Rules:
- Public LinkedIn pages are allowed when your search returns them: the person's public profile (linkedin.com/in/…), posts and articles, their company's page and job posts. Search for them too (e.g. "<name> <company> site:linkedin.com"). Never use Indeed or Glassdoor.
- Only report what the pages you found say. Never guess or fill gaps.
- Make sure pages are about THIS person (same name AND same company, role, city or university). If you can't tell them apart from a namesake, answer match "not_found".
- Work-related information only. Never include home addresses, family, health, religion, politics or other private details.
- Every fact needs the exact URL of the page it came from.
- career: every employer the pages say this person works or worked at (current and past), with their role and years when stated, e.g. {"company":"Cambridge Technology Partners","role":"Senior Consultant","years":"1998–2002"}. Include internships and former company names exactly as the page writes them.
- education: every degree, diploma and university, college or campus (e.g. {"school":"University of Moratuwa","degree":"BSc Computer Science"}), with years when given.
- projects: projects they built, worked on or led (systems, migrations, product launches, client engagements, open-source repos, research), with their role, the company and one sentence on what it was.
- certifications: professional certifications (e.g. "AWS Solutions Architect", "PMP", "CISSP").
- keywords: up to 20 short terms (1–3 words) for skills, programming languages, tools, industries and topics this person is associated with.
- facts: up to 15 short sentences about their professional activity: responsibilities, teams or budgets they own, talks, articles, interviews, awards, boards, associations, volunteering in professional bodies.
- work_email / work_phone: ONLY a work email or office phone that this person or their employer has published on a public page (team page, bio, press release, speaker page, company contact page for this person). Never guess an address from a pattern. Never a personal webmail address. null when not published.
- github: the person's GitHub profile URL (https://github.com/username) only when a page clearly links it to this person. Else null.
Answer in JSON only.`

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })

export const WEB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'match',
    'summary',
    'location',
    'career',
    'education',
    'certifications',
    'projects',
    'keywords',
    'facts',
    'work_email',
    'work_phone',
    'github',
  ],
  properties: {
    match: { type: 'string', enum: ['confident', 'likely', 'not_found'] },
    summary: nullable({ type: 'string', description: 'One or two sentences on who they are professionally.' }),
    location: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['value', 'url'],
      properties: { value: { type: 'string', description: 'City, country' }, url: { type: 'string' } },
    }),
    career: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'role', 'years', 'url'],
        properties: {
          company: { type: 'string' },
          role: nullable({ type: 'string' }),
          years: nullable({ type: 'string' }),
          url: { type: 'string' },
        },
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['school', 'degree', 'years', 'url'],
        properties: {
          school: { type: 'string' },
          degree: nullable({ type: 'string' }),
          years: nullable({ type: 'string' }),
          url: { type: 'string' },
        },
      },
    },
    certifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'url'],
        properties: { name: { type: 'string' }, url: { type: 'string' } },
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'company', 'summary', 'url'],
        properties: {
          name: { type: 'string' },
          role: nullable({ type: 'string' }),
          company: nullable({ type: 'string' }),
          summary: nullable({ type: 'string' }),
          url: { type: 'string' },
        },
      },
    },
    work_email: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['value', 'url'],
      properties: { value: { type: 'string' }, url: { type: 'string' } },
    }),
    work_phone: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['value', 'url'],
      properties: { value: { type: 'string' }, url: { type: 'string' } },
    }),
    github: nullable({ type: 'string' }),
    keywords: { type: 'array', items: { type: 'string' } },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'url'],
        properties: { text: { type: 'string' }, url: { type: 'string' } },
      },
    },
  },
} as const

export const WebOutput = z.object({
  match: z.enum(['confident', 'likely', 'not_found']),
  summary: z.string().nullable(),
  location: z.object({ value: z.string(), url: z.string() }).nullable(),
  career: z
    .array(
      z.object({ company: z.string(), role: z.string().nullable(), years: z.string().nullable(), url: z.string() }),
    )
    .default([]),
  education: z
    .array(
      z.object({ school: z.string(), degree: z.string().nullable(), years: z.string().nullable(), url: z.string() }),
    )
    .default([]),
  certifications: z.array(z.object({ name: z.string(), url: z.string() })).default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().nullable(),
        company: z.string().nullable(),
        summary: z.string().nullable(),
        url: z.string(),
      }),
    )
    .default([]),
  work_email: z.object({ value: z.string(), url: z.string() }).nullable().default(null),
  work_phone: z.object({ value: z.string(), url: z.string() }).nullable().default(null),
  github: z.string().nullable().default(null),
  keywords: z.array(z.string()),
  facts: z.array(z.object({ text: z.string(), url: z.string() })),
})
export type WebOutput = z.infer<typeof WebOutput>

export function webUserMessage(c: Contact): string {
  const lines = [
    `Name: ${c.fullName}`,
    c.position && `Title: ${c.position}`,
    c.company && `Company: ${c.company}`,
    c.research?.domain && `Company website: ${c.research.domain}`,
    (c.location?.value || c.companyHq?.value) && `Probably based in: ${c.location?.value ?? c.companyHq?.value}`,
  ]
  return `Find this person's public professional profile.\n${lines.filter(Boolean).join('\n')}`
}

/** Free webmail: personal, not work, addresses. */
const WEBMAIL =
  /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|gmx|mail|yandex|zoho)\./i
export const workEmail = (v: string) => /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v.trim()) && !WEBMAIL.test(v.trim())
/** The username from a GitHub profile URL, or undefined. */
export function githubUser(u: string | null | undefined): string | undefined {
  const m = u?.trim().match(/^https?:\/\/(www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/?$/)
  return m && !['orgs', 'topics', 'features', 'about'].includes(m[2].toLowerCase()) ? m[2] : undefined
}

/**
 * Never used as sources: Indeed and Glassdoor. Public LinkedIn pages that the web search itself returns
 * (job posts, company pages, public profiles) are allowed; the app never logs in to LinkedIn.
 */
const BLOCKED = /(^|\.)(indeed\.[a-z.]+|glassdoor\.[a-z.]+)$/i
const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{7,}\d/

const normUrl = (u: string) => {
  try {
    const url = new URL(u.trim())
    return `${url.host.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return ''
  }
}

export const isBlockedSource = (u: string) => {
  try {
    return BLOCKED.test(new URL(u).hostname)
  } catch {
    return true
  }
}

/** Keeps only facts backed by a page the search returned (never Indeed or Glassdoor) and drops personal details. */
export function validateWeb(
  out: WebOutput,
  sources: string[],
  model: string,
  at = new Date().toISOString(),
): PersonWeb {
  const seen = new Set(sources.filter((u) => !isBlockedSource(u)).map(normUrl))
  const backed = (u: string) => !isBlockedSource(u) && seen.has(normUrl(u))
  const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

  if (out.match === 'not_found')
    return { status: 'not_found', note: 'No public pages found for this person.', model, at }

  const facts = out.facts
    .filter((f) => f.text.trim() && backed(f.url) && !PERSONAL.test(f.text))
    .slice(0, 15)
    .map((f) => ({ text: clean(f.text, 300), url: f.url.slice(0, 500) }))
  const jobSeen = new Set<string>()
  const career = out.career
    .filter((j) => j.company.trim() && backed(j.url))
    .filter((j) => !jobSeen.has(j.company.toLowerCase().trim()) && !!jobSeen.add(j.company.toLowerCase().trim()))
    .slice(0, 15)
    .map((j) => ({
      company: clean(j.company, 120),
      ...(j.role?.trim() ? { role: clean(j.role, 120) } : {}),
      ...(j.years?.trim() ? { years: clean(j.years, 40) } : {}),
      url: j.url.slice(0, 500),
    }))
  const education = out.education
    .filter((e) => e.school.trim() && backed(e.url))
    .slice(0, 6)
    .map((e) => ({
      school: clean(e.school, 160),
      ...(e.degree?.trim() ? { degree: clean(e.degree, 160) } : {}),
      ...(e.years?.trim() ? { years: clean(e.years, 40) } : {}),
      url: e.url.slice(0, 500),
    }))
  const certifications = out.certifications
    .filter((x) => x.name.trim() && backed(x.url) && !PERSONAL.test(x.name))
    .slice(0, 12)
    .map((x) => ({ name: clean(x.name, 120), url: x.url.slice(0, 500) }))
  const projects = out.projects
    .filter((x) => x.name.trim() && backed(x.url) && !PERSONAL.test(x.name))
    .slice(0, 10)
    .map((x) => ({
      name: clean(x.name, 160),
      ...(x.role?.trim() ? { role: clean(x.role, 120) } : {}),
      ...(x.company?.trim() ? { company: clean(x.company, 120) } : {}),
      ...(x.summary?.trim() && !PERSONAL.test(x.summary) ? { summary: clean(x.summary, 300) } : {}),
      url: x.url.slice(0, 500),
    }))
  if (!facts.length && !career.length && !education.length && !certifications.length && !projects.length)
    return { status: 'not_found', note: 'The search found nothing it could back up with a page.', model, at }

  const keySeen = new Set<string>()
  const keywords = out.keywords
    .map((k) => clean(k, 40))
    .filter((k) => k && k.split(' ').length <= 4 && !PERSONAL.test(k))
    // First spelling wins.
    .filter((k) => !keySeen.has(k.toLowerCase()) && !!keySeen.add(k.toLowerCase()))
    .slice(0, 20)
  const email =
    out.work_email && backed(out.work_email.url) && workEmail(out.work_email.value)
      ? { value: out.work_email.value.trim().toLowerCase(), url: out.work_email.url.slice(0, 500) }
      : undefined
  const phone =
    out.work_phone && backed(out.work_phone.url) && /^\+?[\d\s().-]{7,20}$/.test(out.work_phone.value.trim())
      ? { value: out.work_phone.value.trim(), url: out.work_phone.url.slice(0, 500) }
      : undefined
  const github = githubUser(out.github)
  const location = out.location && backed(out.location.url) ? clean(out.location.value, 200) : undefined
  const summary = out.summary && !PERSONAL.test(out.summary) ? clean(out.summary, 400) : undefined

  return {
    status: 'found',
    match: out.match,
    ...(summary ? { summary } : {}),
    ...(location ? { location } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(career.length ? { career } : {}),
    ...(education.length ? { education } : {}),
    ...(certifications.length ? { certifications } : {}),
    ...(projects.length ? { projects } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(github ? { github } : {}),
    facts,
    sources: [
      ...new Set([
        ...facts.map((f) => f.url),
        ...career.map((j) => j.url),
        ...education.map((e) => e.url),
        ...certifications.map((x) => x.url),
        ...projects.map((x) => x.url),
      ]),
    ].slice(0, 30),
    model,
    at,
  }
}

interface ResponsesBody {
  output?: {
    type?: string
    action?: { sources?: { url?: string }[] }
    content?: { type?: string; text?: string; annotations?: { url?: string }[] }[]
  }[]
  usage?: { input_tokens?: number; output_tokens?: number }
  incomplete_details?: { reason?: string }
}

export interface PersonSearchResult {
  web: PersonWeb
  usage: { input_tokens: number; output_tokens: number }
  searches: number
}

export interface WebSearchResult {
  /** The JSON answer, or undefined when it couldn't be read. */
  text?: string
  incomplete?: string
  sources: string[]
  usage: { input_tokens: number; output_tokens: number }
  searches: number
}

/** One OpenAI web search with a JSON-schema answer (company GPT key or your own OpenAI key). */
export async function webSearchCall(opts: {
  apiKey: string
  provider: string
  instructions: string
  input: string
  schemaName: string
  schema: object
  signal?: AbortSignal
}): Promise<WebSearchResult> {
  if (opts.provider !== 'openai')
    throw new AiError('Web search needs GPT. Choose OpenAI (GPT) under AI assistant.', 'model')
  const model = modelById(WEB_MODEL)
  const res = await send(
    'openai',
    opts.apiKey,
    '/responses',
    {
      method: 'POST',
      signal: opts.signal,
      body: JSON.stringify({
        model: model.id,
        instructions: opts.instructions,
        input: opts.input,
        tools: [{ type: 'web_search' }],
        max_tool_calls: MAX_SEARCHES,
        include: ['web_search_call.action.sources'],
        reasoning: { effort: 'low' },
        text: { format: { type: 'json_schema', name: opts.schemaName, strict: true, schema: opts.schema } },
        max_output_tokens: 8000,
      }),
    },
    model.label,
  )
  const data = (await res.json()) as ResponsesBody
  const output = data.output ?? []
  const sources = output.flatMap((o) => [
    ...(o.action?.sources?.map((s) => s.url ?? '') ?? []),
    ...(o.content?.flatMap((c) => c.annotations?.map((a) => a.url ?? '') ?? []) ?? []),
  ])
  const text = output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? '')
    .join('')
  return {
    text: text || undefined,
    incomplete: data.incomplete_details?.reason,
    sources: sources.filter(Boolean),
    usage: { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 },
    searches: output.filter((o) => o.type === 'web_search_call').length,
  }
}

/**
 * The person's public LinkedIn profile, found by web search (site:linkedin.com/in). Usually lists the
 * whole career, education and skills. Used only when it's clearly this person.
 */
export async function searchPersonLinkedIn(opts: {
  apiKey: string
  provider: string
  contact: Contact
  signal?: AbortSignal
}): Promise<PersonSearchResult> {
  const c = opts.contact
  const li = await webSearchCall({
    apiKey: opts.apiKey,
    provider: opts.provider,
    instructions: WEB_SYSTEM,
    input: `${webUserMessage(c)}
Search LinkedIn only: run "${c.fullName} ${c.company ?? ''} site:linkedin.com/in" and "${c.fullName} site:linkedin.com". From the public profile page or its search snippet, collect the headline, current and past roles with years, education, certifications, skills and location. Use it only if it is clearly this person (same name and same company or title).`,
    schemaName: 'person_web',
    schema: WEB_SCHEMA,
    signal: opts.signal,
  })
  const at = new Date().toISOString()
  let web: PersonWeb
  try {
    web = validateWeb(WebOutput.parse(JSON.parse(li.text ?? '')), li.sources, WEB_MODEL, at)
  } catch {
    web = { status: 'error', note: 'The LinkedIn search answer couldn’t be read.', model: WEB_MODEL, at }
  }
  return { web: { ...web, linkedinAt: at }, usage: li.usage, searches: li.searches }
}

/** Two searches about one person, combined: lists are joined without repeats; the first found wins ties. */
export function mergeWeb(a: PersonWeb, b?: PersonWeb): PersonWeb {
  if (!b || b.status !== 'found') return a
  if (a.status !== 'found') return b
  const uniq = <T>(xs: T[] | undefined, ys: T[] | undefined, key: (x: T) => string, max: number) => {
    const seen = new Set<string>()
    const out = [...(xs ?? []), ...(ys ?? [])].filter((x) => {
      const k = key(x).toLowerCase().trim()
      return !seen.has(k) && !!seen.add(k)
    })
    return out.length ? out.slice(0, max) : undefined
  }
  const merged: PersonWeb = {
    ...b,
    ...a,
    match: a.match === 'confident' || b.match === 'confident' ? 'confident' : (a.match ?? b.match),
    summary: a.summary ?? b.summary,
    location: a.location ?? b.location,
    career: uniq(a.career, b.career, (x) => x.company, 15),
    education: uniq(a.education, b.education, (x) => x.school, 6),
    certifications: uniq(a.certifications, b.certifications, (x) => x.name, 12),
    projects: uniq(a.projects, b.projects, (x) => x.name, 10),
    keywords: uniq(a.keywords, b.keywords, (x) => x, 25),
    facts: uniq(a.facts, b.facts, (x) => x.text, 15),
    email: a.email ?? b.email,
    phone: a.phone ?? b.phone,
    github: a.github ?? b.github,
    sources: uniq(a.sources, b.sources, (x) => x, 30),
  }
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as PersonWeb
}

/** Searches the web for one person (company GPT key or your own OpenAI key). */
export async function searchPerson(opts: {
  apiKey: string
  provider: string
  contact: Contact
  signal?: AbortSignal
}): Promise<PersonSearchResult> {
  const res = await webSearchCall({
    apiKey: opts.apiKey,
    provider: opts.provider,
    instructions: WEB_SYSTEM,
    input: webUserMessage(opts.contact),
    schemaName: 'person_web',
    schema: WEB_SCHEMA,
    signal: opts.signal,
  })
  // A separate search just for the person's public LinkedIn profile.
  const li = await searchPersonLinkedIn(opts).catch(() => undefined)
  const usage = {
    input_tokens: res.usage.input_tokens + (li?.usage.input_tokens ?? 0),
    output_tokens: res.usage.output_tokens + (li?.usage.output_tokens ?? 0),
  }
  const searches = res.searches + (li?.searches ?? 0)
  const liWeb = li?.web
  let parsed: WebOutput
  try {
    parsed = WebOutput.parse(JSON.parse(res.text ?? ''))
  } catch {
    if (liWeb?.status === 'found') return { web: liWeb, usage, searches }
    return {
      web: {
        status: 'error',
        note: res.incomplete ? `The search stopped early (${res.incomplete}).` : 'The answer couldn’t be read.',
        model: WEB_MODEL,
        at: new Date().toISOString(),
      },
      usage,
      searches,
    }
  }
  const web = mergeWeb(validateWeb(parsed, res.sources, WEB_MODEL), liWeb)
  // Free extra: the person's public GitHub profile and repos, when a page linked it to them.
  if (web.status === 'found' && web.github) {
    const githubProfile = await fetchGithub(web.github, fetch, opts.signal).catch(() => undefined)
    if (githubProfile) {
      web.githubProfile = githubProfile
      const known = new Set((web.keywords ?? []).map((k) => k.toLowerCase()))
      web.keywords = [
        ...(web.keywords ?? []),
        ...(githubProfile.languages ?? []).filter((l) => !known.has(l.toLowerCase())),
      ].slice(0, 25)
    }
  }
  return { web, usage, searches }
}

/** Rough cost range for searching these many people (searches are the main cost). */
export function estimateWebCost(people: number): { low: number; high: number } {
  const m = modelById(WEB_MODEL)
  const per = (searches: number, tokensIn: number, tokensOut: number) =>
    searches * WEB_SEARCH_USD + (tokensIn * m.inputPerM + tokensOut * m.outputPerM) / 1e6
  return { low: people * per(1, 8_000, 300), high: people * per(MAX_SEARCHES, 25_000, 1_000) }
}
