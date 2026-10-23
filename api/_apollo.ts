/**
 * Forwards a few Apollo API calls for the browser. Apollo's API is meant to be called from a server,
 * so the app sends requests here with the user's own key in a header; this function adds nothing,
 * stores nothing and logs nothing — it only checks the request is one of the allowed calls.
 *
 * Shared by the Vercel function (api/apollo.ts) and the Vite dev server, so both behave the same.
 */

const APOLLO = 'https://api.apollo.io/api/v1'
const MAX_BODY = 32_000

/** The only Apollo calls the app makes. Anything else is refused. */
const ROUTES: Array<{ path: RegExp; method: 'GET' | 'POST'; query: string[] }> = [
  {
    path: /^people\/bulk_match$/,
    method: 'POST',
    query: ['reveal_phone_number', 'poll_only', 'reveal_personal_emails'],
  },
  { path: /^organizations\/enrich$/, method: 'GET', query: ['domain'] },
  // request_id is a signed 64-bit integer.
  { path: /^webhook_result\/-?\d{1,20}$/, method: 'GET', query: [] },
]

export interface ApolloForward {
  path: string
  query?: Record<string, string>
  body?: unknown
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export async function handleApollo(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' })
  const key = request.headers.get('x-apollo-key')?.trim()
  if (!key || key.length < 10 || key.length > 200 || /\s/.test(key)) {
    return json(401, { error: 'Missing Apollo API key.' })
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'Request too large.' })
  let req: ApolloForward
  try {
    req = JSON.parse(raw) as ApolloForward
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
  const route = typeof req.path === 'string' ? ROUTES.find((r) => r.path.test(req.path)) : undefined
  if (!route) return json(400, { error: 'That Apollo call is not allowed.' })

  const url = new URL(`${APOLLO}/${req.path}`)
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (!route.query.includes(k) || typeof v !== 'string' || v.length > 200) {
      return json(400, { error: `Query parameter "${k}" is not allowed.` })
    }
    url.searchParams.set(k, v)
  }

  let upstream: Response
  try {
    upstream = await fetchImpl(url, {
      method: route.method,
      headers: {
        'x-api-key': key,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Accept: 'application/json',
      },
      ...(route.method === 'POST' ? { body: JSON.stringify(req.body ?? {}) } : {}),
    })
  } catch {
    return json(502, { error: "Couldn't reach Apollo." })
  }

  // Pass Apollo's answer through unchanged (status and JSON), minus any headers.
  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
