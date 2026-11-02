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
- Never use linkedin.com (or any LinkedIn page) as a source.
- Only report what the pages you found say. Never guess or fill gaps.
- Make sure pages are about THIS person (same name AND same company or role). If you can't tell them apart from a namesake, answer match "not_found".
- Professional information only: role, responsibilities, career history, expertise, industries, technologies, achievements, talks, where they are based (city/country). Never include emails, phone numbers, home addresses, family, health, religion, politics or other personal details.
- Every fact needs the exact URL of the page it came from.
- keywords: up to 12 short terms (1–3 words) for skills, industries, technologies and topics this person is associated with, e.g. "Digital transformation", "Fintech", "Microsoft Dynamics 365".
Answer in JSON only.`

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })

export const WEB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['match', 'summary', 'location', 'keywords', 'facts'],
  properties: {
    match: { type: 'string', enum: ['confident', 'likely', 'not_found'] },
    summary: nullable({ type: 'string', description: 'One or two sentences on who they are professionally.' }),
    location: nullable({
      type: 'object',
      additionalProperties: false,
      required: ['value', 'url'],
      properties: { value: { type: 'string', description: 'City, country' }, url: { type: 'string' } },
    }),
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

const BLOCKED = /(^|\.)(linkedin\.com|lnkd\.in)$/i
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
  if (!facts.length)
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
    facts,
    sources: [...new Set(facts.map((f) => f.url))].slice(0, 10),
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

/** Searches the web for one person (company GPT key or your own OpenAI key). */
export async function searchPerson(opts: {
  apiKey: string
  provider: string
  contact: Contact
  signal?: AbortSignal
}): Promise<PersonSearchResult> {
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
        instructions: WEB_SYSTEM,
        input: webUserMessage(opts.contact),
        tools: [{ type: 'web_search' }],
        max_tool_calls: MAX_SEARCHES,
        include: ['web_search_call.action.sources'],
        reasoning: { effort: 'low' },
        text: { format: { type: 'json_schema', name: 'person_web', strict: true, schema: WEB_SCHEMA } },
        max_output_tokens: 4000,
      }),
    },
    model.label,
  )
  const data = (await res.json()) as ResponsesBody
  const output = data.output ?? []
  const searches = output.filter((o) => o.type === 'web_search_call').length
  const sources = output.flatMap((o) => [
    ...(o.action?.sources?.map((s) => s.url ?? '') ?? []),
    ...(o.content?.flatMap((c) => c.annotations?.map((a) => a.url ?? '') ?? []) ?? []),
  ])
  const text = output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? '')
    .join('')
  const usage = { input_tokens: data.usage?.input_tokens ?? 0, output_tokens: data.usage?.output_tokens ?? 0 }
  let parsed: WebOutput
  try {
    parsed = WebOutput.parse(JSON.parse(text))
  } catch {
    const reason = data.incomplete_details?.reason
    return {
      web: {
        status: 'error',
        note: reason ? `The search stopped early (${reason}).` : 'The answer couldn’t be read.',
        model: model.id,
        at: new Date().toISOString(),
      },
      usage,
      searches,
    }
  }
  return { web: validateWeb(parsed, sources, model.id), usage, searches }
}

/** Rough cost range for searching these many people (searches are the main cost). */
export function estimateWebCost(people: number): { low: number; high: number } {
  const m = modelById(WEB_MODEL)
  const per = (searches: number, tokensIn: number, tokensOut: number) =>
    searches * WEB_SEARCH_USD + (tokensIn * m.inputPerM + tokensOut * m.outputPerM) / 1e6
  return { low: people * per(1, 8_000, 300), high: people * per(MAX_SEARCHES, 25_000, 1_000) }
}
