import { timingSafeEqual } from 'node:crypto'
import { handleApollo } from '../api/_apollo'
import { routeApi } from '../api/_routes'

/**
 * AWS Lambda entry for all /api/* routes (Function URL, payload format 2.0). It turns the Lambda
 * event into a standard Request, runs the same handlers as Vercel and the dev server, and turns the
 * Response back into what Lambda expects. Nothing else changes between hosts.
 *
 * Only CloudFront may call it: CloudFront adds a secret `x-origin-verify` header (ORIGIN_VERIFY_SECRET),
 * so the Function URL itself is useless to anyone who finds it.
 */

export interface FunctionUrlEvent {
  rawPath: string
  rawQueryString?: string
  headers?: Record<string, string | undefined>
  body?: string
  isBase64Encoded?: boolean
  requestContext: { http: { method: string } }
}

export interface FunctionUrlResult {
  statusCode: number
  headers: Record<string, string>
  body: string
}

const reply = (statusCode: number, error: string): FunctionUrlResult => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify({ error }),
})

function fromCloudFront(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.ORIGIN_VERIFY_SECRET
  if (!expected) return true // not configured (e.g. local tests)
  const given = Buffer.from(headers['x-origin-verify'] ?? '')
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  const headers = event.headers ?? {}
  if (!fromCloudFront(headers)) return reply(403, 'Forbidden.')

  const method = event.requestContext.http.method.toUpperCase()
  const path = event.rawPath
  const url = `https://app.local${path}${event.rawQueryString ? `?${event.rawQueryString}` : ''}`
  const body =
    event.body && method !== 'GET' && method !== 'HEAD'
      ? event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body
      : undefined
  const forward = new Headers()
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && k !== 'x-origin-verify') forward.set(k, v)
  const request = new Request(url, { method, headers: forward, body })

  let response: Response | undefined
  try {
    response = path === '/api/apollo' ? await handleApollo(request) : await routeApi(path, request)
  } catch {
    return reply(500, 'The server hit an unexpected error.')
  }
  if (!response) return reply(404, 'Not found.')

  const out: Record<string, string> = {}
  response.headers.forEach((v, k) => (out[k] = v))
  return { statusCode: response.status, headers: out, body: await response.text() }
}
