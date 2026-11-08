import { z } from 'zod'
import type { Contact } from '../schemas'
import { AiError } from '../ai/provider'
import { modelById } from '../ai/models'
import { send } from '../ai/openai-compat'

/**
 * "Search the web": one OpenAI web search per person, for their public professional profile —
 * company bios, conference talks, interviews, news, publications. LinkedIn is never used as a source,
 * and every fact must point at a page the search actually returned, so nothing is made up.
 * Only professional details are kept: no contact details, family, health, religion or politics.
 */

/** Web search runs on the cheapest GPT: it reads and quotes pages, which doesn't need a big model. */
export const WEB_MODEL = 'gpt-6-luna'
/** Must match the server's MAX_SEARCHES and WEB_SEARCH_USD (api/_ai.ts). */
export const MAX_SEARCHES = 2
export const WEB_SEARCH_USD = 0.01

export type PersonWeb = NonNullable<Contact['web']>

export const WEB_SYSTEM = `You research one professional contact on the public web for a B2B sales team.
Search for the person by name together with their company and title. Use company websites, team or leadership pages, conference and event pages, interviews, news, podcasts, publications and similar public professional pages.
Rules:
- Never use linkedin.com (or any LinkedIn page), Indeed or Glassdoor as a source.
- Only report what the pages you found say. Never guess or fill gaps.
- Make sure pages are about THIS person (same name AND same company or role). If you can't tell them apart from a namesake, answer match "not_found".
- Professional information only: role, responsibilities, career history, expertise, industries, technologies, achievements, talks, where they are based (city/country). Never include emails, phone numbers, home addresses, family, health, religion, politics or other personal details.
- Every fact needs the exact URL of the page it came from.
- career: every employer the pages say this person works or worked at (current and past), with their role and years when stated, e.g. {"company":"Cambridge Technology Partners","role":"Senior Consultant","years":"1998–2002"}. Include former company names exactly as the page writes them. Each needs the URL of the page that says it.
- keywords: up to 12 short terms (1–3 words) for skills, industries, technologies and topics this person is associated with, e.g. "Digital transformation", "Fintech", "Microsoft Dynamics 365".
Answer in JSON only.`

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })

export const WEB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['match', 'summary', 'location', 'career', 'keywords', 'facts'],
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

/** Never used as sources: LinkedIn, Indeed and Glassdoor don't allow their pages to be collected. */
const BLOCKED = /(^|\.)(linkedin\.com|lnkd\.in|indeed\.[a-z.]+|glassdoor\.[a-z.]+)$/i
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

/** Keeps only facts backed by a page the search returned (never LinkedIn) and drops personal details. */
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
    .slice(0, 8)
    .map((f) => ({ text: clean(f.text, 300), url: f.url.slice(0, 500) }))
  const jobSeen = new Set<string>()
  const career = out.career
    .filter((j) => j.company.trim() && backed(j.url))
    .filter((j) => !jobSeen.has(j.company.toLowerCase().trim()) && !!jobSeen.add(j.company.toLowerCase().trim()))
    .slice(0, 10)
    .map((j) => ({
      company: clean(j.company, 120),
      ...(j.role?.trim() ? { role: clean(j.role, 120) } : {}),
      ...(j.years?.trim() ? { years: clean(j.years, 40) } : {}),
      url: j.url.slice(0, 500),
    }))
  if (!facts.length && !career.length)
    return { status: 'not_found', note: 'The search found nothing it could back up with a page.', model, at }

  const keySeen = new Set<string>()
  const keywords = out.keywords
    .map((k) => clean(k, 40))
    .filter((k) => k && k.split(' ').length <= 4 && !PERSONAL.test(k))
    // First spelling wins.
    .filter((k) => !keySeen.has(k.toLowerCase()) && !!keySeen.add(k.toLowerCase()))
    .slice(0, 12)
  const location = out.location && backed(out.location.url) ? clean(out.location.value, 200) : undefined
  const summary = out.summary && !PERSONAL.test(out.summary) ? clean(out.summary, 400) : undefined

  return {
    status: 'found',
    match: out.match,
    ...(summary ? { summary } : {}),
    ...(location ? { location } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(career.length ? { career } : {}),
    facts,
    sources: [...new Set([...facts.map((f) => f.url), ...career.map((j) => j.url)])].slice(0, 10),
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
        max_output_tokens: 4000,
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
  const { usage, searches } = res
  let parsed: WebOutput
  try {
    parsed = WebOutput.parse(JSON.parse(res.text ?? ''))
  } catch {
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
  return { web: validateWeb(parsed, res.sources, WEB_MODEL), usage, searches }
}

/** Rough cost range for searching these many people (searches are the main cost). */
export function estimateWebCost(people: number): { low: number; high: number } {
  const m = modelById(WEB_MODEL)
  const per = (searches: number, tokensIn: number, tokensOut: number) =>
    searches * WEB_SEARCH_USD + (tokensIn * m.inputPerM + tokensOut * m.outputPerM) / 1e6
  return { low: people * per(1, 8_000, 300), high: people * per(MAX_SEARCHES, 25_000, 1_000) }
}
