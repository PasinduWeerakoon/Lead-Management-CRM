import type { Contact } from '../schemas'

/**
 * Apollo calls, sent through this app's own /api/apollo function (Apollo's API is server-side only).
 * The user's key travels in a header for each request and is never stored by the function.
 */

export class ApolloError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'credits' | 'plan' | 'rate' | 'busy' | 'network' | 'cancelled' | 'other',
  ) {
    super(message)
  }
}

/** The parts of Apollo's person record the app uses. */
export interface ApolloPersonRaw {
  id?: string
  match_confidence?: string
  email?: string | null
  email_status?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  organization?: {
    name?: string | null
    primary_domain?: string | null
    city?: string | null
    state?: string | null
    country?: string | null
    industry?: string | null
    estimated_num_employees?: number | null
    technology_names?: string[] | null
  } | null
}

export interface ApolloPhoneRaw {
  raw_number?: string
  sanitized_number?: string
  type_cd?: string
  type?: string
  status_cd?: string
}

async function call<T>(
  key: string,
  path: string,
  init: { query?: Record<string, string>; body?: unknown },
  signal?: AbortSignal,
): Promise<{ status: number; data: T }> {
  let res: Response
  try {
    res = await fetch('/api/apollo', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-apollo-key': key },
      body: JSON.stringify({ path, query: init.query, body: init.body }),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new ApolloError('Stopped.', 'cancelled')
    throw new ApolloError("Couldn't reach Apollo. Check your internet connection.", 'network')
  }
  let data: unknown = undefined
  try {
    data = await res.json()
  } catch {
    // empty or non-JSON body
  }
  return { status: res.status, data: data as T }
}

const messageOf = (data: unknown) => {
  const d = data as { error?: string; message?: string; error_message?: string } | undefined
  return String(d?.error_message ?? d?.error ?? d?.message ?? '').slice(0, 200)
}

/** Turns an Apollo error status into a plain message. Never includes the key. */
export function apolloFailure(status: number, data: unknown): ApolloError {
  const msg = messageOf(data)
  if (status === 401) return new ApolloError("Apollo didn't accept that API key. Check it in Settings.", 'auth')
  if (/credit/i.test(msg) || status === 402)
    return new ApolloError(
      'Your Apollo account is out of credits for this. Top up in Apollo, then run again.',
      'credits',
    )
  if (status === 403)
    return new ApolloError(
      `Your Apollo plan or key doesn't allow this${msg ? ` (${msg})` : ''}. Check the key's API access in Apollo.`,
      'plan',
    )
  if (status === 429) return new ApolloError('Apollo is rate-limiting this key. Waiting, then retrying…', 'rate')
  if (status >= 500) return new ApolloError('Apollo is busy right now. Try again shortly.', 'busy')
  return new ApolloError(`Apollo rejected the request${msg ? `: ${msg}` : ` (${status})`}.`, 'other')
}

export interface MatchDetails {
  linkedin_url?: string
  first_name?: string
  last_name?: string
  name?: string
  organization_name?: string
  domain?: string
}

/** What Apollo is told about a person: the LinkedIn URL first, plus name and employer to confirm. */
export function matchDetails(c: Contact): MatchDetails {
  const domain = c.enrichment?.website?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]
  return {
    ...(c.profileUrl ? { linkedin_url: c.profileUrl } : {}),
    ...(c.firstName ? { first_name: c.firstName } : {}),
    ...(c.lastName ? { last_name: c.lastName } : {}),
    ...(!c.firstName && !c.lastName ? { name: c.fullName } : {}),
    ...(c.company ? { organization_name: c.company } : {}),
    ...(domain ? { domain } : {}),
  }
}

export interface BulkMatchResult {
  /** Same order as the people sent; null when Apollo found no one. */
  matches: Array<ApolloPersonRaw | null>
  credits: number
  /** Set when phones were requested: pass to pollPhones. */
  requestId?: string
}

/** Up to 10 people per call. With `phones`, mobile numbers are requested and arrive later (poll). */
export async function bulkMatch(
  key: string,
  details: MatchDetails[],
  opts: { phones?: boolean; signal?: AbortSignal } = {},
): Promise<BulkMatchResult> {
  const { status, data } = await call<{
    matches?: Array<ApolloPersonRaw | null>
    credits_consumed?: number
    request_id?: number | string
  }>(
    key,
    'people/bulk_match',
    {
      query: opts.phones ? { reveal_phone_number: 'true', poll_only: 'true' } : undefined,
      body: { details },
    },
    opts.signal,
  )
  if (status !== 200) throw apolloFailure(status, data)
  return {
    matches: details.map((_, i) => data?.matches?.[i] ?? null),
    credits: Number(data?.credits_consumed ?? 0) || 0,
    ...(data?.request_id !== undefined && data?.request_id !== null ? { requestId: String(data.request_id) } : {}),
  }
}

export type PollResult =
  | { state: 'pending'; retryAfterSeconds: number }
  | { state: 'done'; people: Array<{ id?: string; phone_numbers?: ApolloPhoneRaw[] }> }
  | { state: 'gone'; message: string }

/** Apollo's suggested wait, kept between 2 seconds and 2 minutes. */
const retryAfter = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(Math.max(n, 2), 120) : 15
}

/** Checks whether phone numbers for a request are ready. */
export async function pollPhones(key: string, requestId: string, signal?: AbortSignal): Promise<PollResult> {
  if (!/^-?\d{1,20}$/.test(requestId)) return { state: 'gone', message: 'Invalid request id.' }
  const { status, data } = await call<{
    error_code?: string
    retry_after_seconds?: number
    webhook_result?: { people?: Array<{ id?: string; phone_numbers?: ApolloPhoneRaw[] }> }
  }>(key, `webhook_result/${requestId}`, {}, signal)
  if (status === 200) return { state: 'done', people: data?.webhook_result?.people ?? [] }
  if (status === 404 && data?.error_code === 'result_pending')
    return { state: 'pending', retryAfterSeconds: retryAfter(data.retry_after_seconds) }
  if (status === 404 || status === 410 || status === 400)
    return { state: 'gone', message: 'Apollo no longer has this phone request. Run it again.' }
  throw apolloFailure(status, data)
}
