import type { Contact } from './schemas'

/**
 * Sharing one import between several people: each person takes the next block of connections
 * ("the next 30") and collects web data only for those. The server keeps who holds what, so two
 * people never get the same connection (see api/_claims.ts).
 */

export interface Claim {
  id: string
  by: string
  at: string
}

/**
 * The shared order everyone sees: oldest import first, then as LinkedIn lists them (newest
 * connection first), then by name. Same data in, same order out, in every browser.
 */
export function shareOrder(contacts: Contact[]): Contact[] {
  return [...contacts].sort(
    (a, b) =>
      a.importedAt.localeCompare(b.importedAt) ||
      (b.connectedOn ?? '').localeCompare(a.connectedOn ?? '') ||
      a.fullName.localeCompare(b.fullName) ||
      a.id.localeCompare(b.id),
  )
}

/** People-level web data is what a claim is for; anything checked (found or not) counts as done. */
export const collected = (c: Contact) => !!c.web

/** "1–20, 41–50" from 1-based positions. */
export function ranges(positions: number[]): string {
  const sorted = [...positions].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length;) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`)
    i = j + 1
  }
  return out.join(', ')
}

export class ClaimsError extends Error {
  constructor(
    message: string,
    readonly noDatabase = false,
  ) {
    super(message)
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ClaimsError('Couldn’t reach the server. Check your connection.')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string }
  if (res.status === 503 && data.code === 'no_db') throw new ClaimsError('No shared database.', true)
  if (!res.ok) throw new ClaimsError(data.error ?? 'Request failed.')
  return data
}

export const fetchClaims = (profileId: string) =>
  call<{ claims: Claim[]; me: string }>('GET', `/api/claims?profileId=${encodeURIComponent(profileId)}`)

/** Takes the first `count` of `orderedIds` that nobody holds yet. */
export const takeClaims = (profileId: string, orderedIds: string[], count: number) =>
  call<{ claimed: string[] }>('POST', '/api/claims', { profileId, ids: orderedIds, count })

/** Gives claims back: your own, or anyone's for the super admin with `all`. */
export const giveBackClaims = (profileId: string, ids: string[], all = false) =>
  call<{ released: number }>('DELETE', '/api/claims', { profileId, ids, all })
