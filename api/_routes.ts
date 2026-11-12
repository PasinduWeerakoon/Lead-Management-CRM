import type { Db } from 'mongodb'
import { createHash } from 'node:crypto'
import { handleAdmin } from './_admin.js'
import { handleAuth, readSession } from './_auth.js'
import { handleSources } from './_sources.js'
import { handleCoresignal } from './_coresignal.js'
import { handleResearch } from './_research.js'
import { companyAiConfigured, companyAiStatus, handleAi } from './_ai.js'
import { checkAccess, json, PROFILE_ID, SYNCED_TABLES, type SyncedTable } from './_db.js'
import { getStore, mongoStore, StoreError, storeConfigured, type DataStore, type RecordWrite } from './_store.js'

/**
 * The shared-database API. Profiles keep their data apart by `profileId`; each record carries `srv`,
 * the server's write stamp, so browsers can ask for "everything changed since…". Deleted records stay
 * as `deleted: true` markers so other browsers learn about the delete. Storage is in _store.ts
 * (DynamoDB, MongoDB or memory).
 */

const MAX_BODY = 4_000_000
const MAX_RECORDS = 500
const PAGE = 1000
/** Pulls re-read a few seconds back, so writes landing on another server instance at the same moment aren't missed. */
const OVERLAP_MS = 10_000

/** DynamoDB keeps at most 400 KB per item. A very large search drops its step log, then shortens reasons, then keeps the top people. */
const RUN_BYTES = 360_000
export function fitRun(run: Record<string, unknown>): Record<string, unknown> {
  const size = (r: unknown) => Buffer.byteLength(JSON.stringify(r))
  if (size(run) <= RUN_BYTES) return run
  let r: Record<string, unknown> = { ...run, log: undefined, trimmed: true }
  type P = { score?: number; reason?: string; checks?: Array<{ evidence?: string }> }
  const people = (Array.isArray(r.people) ? (r.people as P[]) : []).map((p) => ({
    ...p,
    reason: p.reason?.slice(0, 240),
    checks: p.checks?.map((c) => ({ ...c, evidence: c.evidence?.slice(0, 160) })),
  }))
  r = { ...r, people }
  for (let keep = people.length; size(r) > RUN_BYTES && keep > 50; keep = Math.floor(keep * 0.8))
    r = { ...r, people: [...people].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, Math.floor(keep * 0.8)) }
  return r
}

const isTable = (t: unknown): t is SyncedTable =>
  typeof t === 'string' && (SYNCED_TABLES as readonly string[]).includes(t)
const cleanName = (n: unknown) => (typeof n === 'string' ? n.replace(/\s+/g, ' ').trim().slice(0, 80) : '')

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const raw = await request.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'Too much data in one request.' })
  try {
    const body = JSON.parse(raw) as unknown
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : json(400, { error: 'Expected a JSON object.' })
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
}

const fp = (k: string) => createHash('sha256').update(k).digest('hex').slice(0, 6)
const accessKeyId = () => {
  const k = process.env.APP_ACCESS_KEY?.trim()
  return k ? fp(k) : null
}

/** GET /api/status — whether the shared database is set up. Reveals no data. */
export async function handleStatus(request: Request): Promise<Response> {
  const denied = await checkAccess(request)
  let companyAi: Awaited<ReturnType<typeof companyAiStatus>> | undefined
  // Only told to people with the access code; never includes the key.
  if (!denied && companyAiConfigured()) companyAi = await companyAiStatus().catch(() => undefined)
  return json(200, {
    database: storeConfigured(),
    accessRequired: false,
    accessOk: !denied,
    // A short fingerprint of the server's code, so a mismatch can be spotted without revealing it.
    accessKeyId: accessKeyId(),
    // Fingerprint and length of the code this request carried, to tell a typo from a lost header.
    ...(denied && request.headers.get('x-app-key')
      ? {
          receivedKeyId: fp(request.headers.get('x-app-key')!.trim()),
          receivedLength: request.headers.get('x-app-key')!.trim().length,
        }
      : {}),
    // Whether a company AI key is set up (never the key); details need the access code.
    companyKey: companyAiConfigured(),
    ...(companyAi ? { companyAi } : {}),
  })
}

/** Runs a handler with the shared store, turning a missing configuration or outage into a clear answer. */
async function withStore(fn: (store: DataStore) => Promise<Response>, override?: Db | DataStore): Promise<Response> {
  let store: DataStore | undefined
  try {
    store = override ? ('collection' in override ? mongoStore(override) : override) : await getStore()
  } catch {
    return json(503, { error: "Couldn't reach the database.", code: 'db_down' })
  }
  if (!store) return json(503, { error: 'The shared database isn’t set up.', code: 'no_db' })
  try {
    return await fn(store)
  } catch (err) {
    if (err instanceof StoreError) return json(err.status, { error: err.message })
    throw err
  }
}

/** /api/profiles — list (GET), create (POST), rename (PATCH), delete with all its data (DELETE). */
export async function handleProfiles(request: Request, override?: Db | DataStore): Promise<Response> {
  const denied = await checkAccess(request)
  if (denied) return denied
  return withStore(async (store) => {
    if (request.method === 'GET') return json(200, { profiles: await store.listProfiles() })

    if (request.method === 'DELETE') {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!PROFILE_ID.test(id)) return json(400, { error: 'Invalid profile id.' })
      await store.deleteProfile(id)
      return json(200, { deleted: id })
    }

    const body = await readJson(request)
    if (body instanceof Response) return body
    const id = typeof body.id === 'string' ? body.id : ''
    const name = cleanName(body.name)
    if (!PROFILE_ID.test(id)) return json(400, { error: 'Invalid profile id.' })
    if (!name) return json(400, { error: 'Give the profile a name.' })

    if (request.method === 'POST') {
      // Creating an existing id just renames it, so retries are harmless.
      const createdAt = typeof body.createdAt === 'string' ? body.createdAt.slice(0, 40) : new Date().toISOString()
      await store.saveProfile(id, name, createdAt)
      return json(200, { id, name })
    }
    if (request.method === 'PATCH')
      return (await store.renameProfile(id, name)) ? json(200, { id, name }) : json(404, { error: 'No such profile.' })
    return json(405, { error: 'Method not allowed.' })
  }, override)
}

/**
 * /api/data
 *  GET  ?profileId=&table=&since=[&cont=1]  → records changed after `since` (one page; `more` says if there's another)
 *  POST { profileId, table, upserts: [{ id, data }], deletes: [id] } → saves them
 * The first page re-reads a few seconds back (OVERLAP_MS); later pages (cont=1) start exactly at the
 * cursor, so a big import saved within those seconds can't make the same page come back forever.
 */
export async function handleData(request: Request, override?: Db | DataStore): Promise<Response> {
  const denied = await checkAccess(request)
  if (denied) return denied
  return withStore(async (store) => {
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams
      const profileId = q.get('profileId') ?? ''
      const table = q.get('table')
      const since = Number(q.get('since') ?? 0) || 0
      if (!PROFILE_ID.test(profileId) || !isTable(table)) return json(400, { error: 'Invalid profile or table.' })
      const after = q.get('cont') === '1' ? since : Math.max(0, since - OVERLAP_MS)
      const { records, more } = await store.changes(profileId, table, after, PAGE)
      return json(200, {
        records: records.map((d) => (d.deleted ? { id: d.id, deleted: true } : { id: d.id, data: d.data })),
        cursor: records.length ? records[records.length - 1].srv : since,
        more,
      })
    }

    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })
    const body = await readJson(request)
    if (body instanceof Response) return body
    const { profileId, table } = body
    if (typeof profileId !== 'string' || !PROFILE_ID.test(profileId) || !isTable(table))
      return json(400, { error: 'Invalid profile or table.' })
    const upserts = Array.isArray(body.upserts) ? body.upserts : []
    const deletes = Array.isArray(body.deletes) ? body.deletes : []
    if (upserts.length + deletes.length > MAX_RECORDS)
      return json(413, { error: `At most ${MAX_RECORDS} records per request.` })

    const by = table === 'scoreRuns' ? (await readSession(request))?.email : undefined
    const writes: RecordWrite[] = []
    for (const u of upserts as Array<{ id?: unknown; data?: unknown }>) {
      if (
        typeof u?.id !== 'string' ||
        u.id.length > 200 ||
        !u.data ||
        typeof u.data !== 'object' ||
        Array.isArray(u.data)
      )
        return json(400, { error: 'Each record needs an id and data.' })
      const { _ts: _drop, ...data } = u.data as Record<string, unknown>
      void _drop
      // Searches carry who ran them (for the super admin) and are trimmed to fit one database item.
      writes.push({ id: u.id, data: table === 'scoreRuns' ? fitRun({ ...data, by: data.by ?? by }) : data })
    }
    for (const id of deletes) {
      if (typeof id !== 'string' || id.length > 200) return json(400, { error: 'Invalid id to delete.' })
      writes.push({ id, deleted: true })
    }
    if (writes.length) await store.write(profileId, table, writes)
    return json(200, { saved: upserts.length, deleted: deletes.length })
  }, override)
}

/** One entry point for the dev server: picks the handler by path. */
export async function routeApi(path: string, request: Request): Promise<Response | undefined> {
  if (path === '/api/auth') return handleAuth(request)
  if (path === '/api/admin') return handleAdmin(request)
  if (path === '/api/sources') return handleSources(request)
  if (path === '/api/coresignal') return handleCoresignal(request)
  if (path === '/api/status') return handleStatus(request)
  if (path === '/api/profiles') return handleProfiles(request)
  if (path === '/api/data') return handleData(request)
  if (path === '/api/research') return handleResearch(request)
  if (path === '/api/ai') return handleAi(request)
  return undefined
}
