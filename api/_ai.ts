import { AI_MODELS } from '../src/lib/ai/models.js'
import { checkAccess, json } from './_db.js'
import { dailyCapUsd, spendDay, spendStore } from './_spend.js'

/**
 * /api/ai — the company OpenAI key, kept on the server (OPENAI_API_KEY) and never sent to the
 * browser. The browser sends the same chat request it would send to OpenAI; this adds the key,
 * forwards it, and counts the cost against a daily limit (AI_DAILY_CAP_USD, default $10).
 *
 *   POST /api/ai?op=chat    → OpenAI /chat/completions
 *   POST /api/ai?op=search  → OpenAI /responses with web search (person research)
 *   GET  /api/ai?op=models  → OpenAI /models (used to check the setup)
 *
 * Only built-in OpenAI models with known prices are allowed, so every call can be costed, and a call
 * is refused up front if its largest possible cost would go past today's limit.
 */

const OPENAI = 'https://api.openai.com/v1'
const MAX_BODY = 1_500_000
const MAX_OUTPUT = 16_000
/** Web search: at most this many searches per request, each billed as a tool call. */
export const MAX_SEARCHES = 2
/** OpenAI's web search tool fee per call (list price, Oct 2026); search results are billed as input tokens on top. */
export const WEB_SEARCH_USD = 0.01
/** Search results added to the prompt, per search (worst case, for the up-front limit check). */
const SEARCH_TOKENS = 15_000
const MAX_SEARCH_OUTPUT = 4_000

export const companyAiConfigured = () => !!process.env.OPENAI_API_KEY?.trim()

const MODELS = new Map(AI_MODELS.filter((m) => m.provider === 'openai').map((m) => [m.id, m]))

export const usd = (n: number) => `$${n.toFixed(2)}`

export function capReached(spent: number, cap: number) {
  return json(429, {
    error: `Today's company AI limit is used up (${usd(spent)} of ${usd(cap)}). It resets at midnight Sri Lanka time, or add your own key under AI assistant to keep going.`,
    code: 'daily_cap',
    spentUsd: spent,
    capUsd: cap,
  })
}

/** Today's spend and limit, for the status endpoint. */
export async function companyAiStatus() {
  const store = spendStore()
  return { provider: 'openai', capUsd: dailyCapUsd(), spentUsd: await store.get(spendDay()), shared: store.shared }
}

export async function handleAi(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const denied = checkAccess(request)
  if (denied) return denied
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return json(503, { error: 'The company AI key isn’t set up on the server.', code: 'no_company_key' })
  const op = new URL(request.url).searchParams.get('op')
  const auth = { Authorization: `Bearer ${key}` }

  if (op === 'models') {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' })
    // Only the models this endpoint will run, so the app never offers one it would refuse.
    return json(200, { data: [...MODELS.keys()].map((id) => ({ id })) })
  }
  if ((op !== 'chat' && op !== 'search') || request.method !== 'POST') return json(404, { error: 'Not found.' })

  const raw = await request.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'The request is too large.' })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
  const model = MODELS.get(String(body.model))
  if (!model) return json(400, { error: 'That model can’t be used with the company key. Pick a GPT model.' })
  const search = op === 'search'
  if (search ? typeof body.input !== 'string' || !body.text : !Array.isArray(body.messages))
    return json(400, { error: search ? 'Missing input.' : 'Missing messages.' })

  // Only the fields the app uses are forwarded; web search is always limited to MAX_SEARCHES.
  const maxOut = search
    ? Math.min(Number(body.max_output_tokens) || MAX_SEARCH_OUTPUT, MAX_SEARCH_OUTPUT)
    : Math.min(Number(body.max_completion_tokens) || MAX_OUTPUT, MAX_OUTPUT, model.maxOutput)
  const forward = search
    ? {
        model: model.id,
        ...(typeof body.instructions === 'string' ? { instructions: body.instructions } : {}),
        input: body.input,
        text: body.text,
        tools: [{ type: 'web_search' }],
        max_tool_calls: MAX_SEARCHES,
        include: ['web_search_call.action.sources'],
        ...(body.reasoning ? { reasoning: body.reasoning } : {}),
        max_output_tokens: maxOut,
      }
    : {
        model: model.id,
        messages: body.messages,
        ...(body.response_format ? { response_format: body.response_format } : {}),
        ...(body.reasoning_effort ? { reasoning_effort: body.reasoning_effort } : {}),
        max_completion_tokens: maxOut,
      }

  const store = spendStore()
  const day = spendDay()
  const cap = dailyCapUsd()
  const spent = await store.get(day)
  // Worst case: ~3 characters per input token, every output token used.
  const searchIn = search ? MAX_SEARCHES * SEARCH_TOKENS : 0
  const worst =
    ((raw.length / 3 + searchIn) * model.inputPerM + maxOut * model.outputPerM) / 1_000_000 +
    (search ? MAX_SEARCHES * WEB_SEARCH_USD : 0)
  if (spent + worst > cap) return capReached(spent, cap)

  let res: Response
  try {
    res = await fetchImpl(`${OPENAI}${search ? '/responses' : '/chat/completions'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(forward),
      signal: request.signal,
    })
  } catch {
    return json(502, { error: { message: 'Couldn’t reach OpenAI from the server.' } })
  }
  const text = await res.text()
  let spentNow = spent
  if (res.ok) {
    try {
      const data = JSON.parse(text) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number }
        output?: { type?: string }[]
      }
      const u = data.usage
      const tokensIn = u?.prompt_tokens ?? u?.input_tokens ?? 0
      const tokensOut = u?.completion_tokens ?? u?.output_tokens ?? 0
      const searches = data.output?.filter((o) => o.type === 'web_search_call').length ?? 0
      const cost = (tokensIn * model.inputPerM + tokensOut * model.outputPerM) / 1e6 + searches * WEB_SEARCH_USD
      if (cost > 0) spentNow = await store.add(day, cost)
    } catch {
      // Unreadable answer: the app reports it; nothing to count.
    }
  }
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'x-ai-spent-today': spentNow.toFixed(4),
      'x-ai-cap': String(cap),
    },
  })
}
