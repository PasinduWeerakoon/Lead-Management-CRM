import { readSession, requireUser } from './_auth.js'
import { json, PROFILE_ID } from './_db.js'
import { getStore } from './_store.js'

/**
 * /api/claims — who collects web data for which connections, so several people can share one import
 * without doing the same connection twice (or paying for it twice).
 *   GET    ?profileId=                         → { claims: [{ id, by, at }], me }
 *   POST   { profileId, ids: [...], count }    → claims the first `count` of `ids` (in that order) that
 *                                               nobody holds yet; returns { claimed: [...] }
 *   DELETE { profileId, ids: [...], all? }     → gives your own claims back; the super admin can give
 *                                               back anyone's with all: true
 * The browser sends the ids in the shared order (oldest import first) minus the connections that
 * already have data, so "the next 30" means the same 30 for everyone.
 */

const MAX_IDS = 20_000

export async function handleClaims(request: Request): Promise<Response> {
  const denied = await requireUser(request)
  if (denied) return denied
  const me = (await readSession(request))!
  const store = await getStore()
  if (!store) return json(503, { error: 'The shared database isn’t set up.', code: 'no_db' })

  if (request.method === 'GET') {
    const profileId = new URL(request.url).searchParams.get('profileId') ?? ''
    if (!PROFILE_ID.test(profileId)) return json(400, { error: 'Invalid profile.' })
    return json(200, { claims: await store.listClaims(profileId), me: me.email })
  }

  let body: { profileId?: unknown; ids?: unknown; count?: unknown; all?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 2_000_000) return json(413, { error: 'Too many connections in one request.' })
    body = JSON.parse(raw) as typeof body
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
  const profileId = typeof body.profileId === 'string' ? body.profileId : ''
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64).slice(0, MAX_IDS)
    : []
  if (!PROFILE_ID.test(profileId)) return json(400, { error: 'Invalid profile.' })

  if (request.method === 'POST') {
    const count = Math.max(0, Math.min(Number(body.count) || 0, ids.length))
    if (!count) return json(400, { error: 'Choose how many connections to take.' })
    const held = new Set((await store.listClaims(profileId)).map((c) => c.id))
    const next = ids.filter((id) => !held.has(id)).slice(0, count)
    const claimed = await store.addClaims(profileId, next, me.email)
    return json(200, { claimed })
  }

  if (request.method === 'DELETE') {
    const anyone = body.all === true && me.role === 'super_admin'
    const released = await store.removeClaims(profileId, ids, anyone ? undefined : me.email)
    return json(200, { released })
  }

  return json(405, { error: 'Method not allowed.' })
}
