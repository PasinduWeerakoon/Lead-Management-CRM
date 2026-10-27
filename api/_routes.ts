import type { AnyBulkWriteOperation, Db } from 'mongodb'
import { handleResearch } from './_research'
import { companyAiConfigured, companyAiStatus, handleAi } from './_ai'
import {
  checkAccess,
  databaseConfigured,
  isHosted,
  json,
  nextStamp,
  PROFILE_ID,
  SYNCED_TABLES,
  withDb,
  type SyncedTable,
} from './_db'

/**
 * The shared-database API. Profiles keep their data apart by `profileId`; each record is stored as
 * { _id: "<profile>:<id>", profileId, id, data, srv } where `srv` is the server's write stamp, so
 * browsers can ask for "everything changed since…". Deleted records stay as `deleted: true` markers
 * so other browsers learn about the delete.
 */

const MAX_BODY = 4_000_000
const MAX_RECORDS = 500
const PAGE = 1000
/** Pulls re-read a few seconds back, so writes landing on another server instance at the same moment aren't missed. */
const OVERLAP_MS = 10_000

interface ProfileDoc {
  _id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface RecordDoc {
  _id: string
  profileId: string
  id: string
  data?: Record<string, unknown>
  deleted?: boolean
  srv: number
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

/** GET /api/status — whether the shared database is set up. Reveals no data. */
export async function handleStatus(request: Request): Promise<Response> {
  const denied = checkAccess(request)
  let companyAi: Awaited<ReturnType<typeof companyAiStatus>> | undefined
  // Only told to people with the access code; never includes the key.
  if (!denied && companyAiConfigured()) companyAi = await companyAiStatus().catch(() => undefined)
  return json(200, {
    database: databaseConfigured(),
    accessRequired: !!process.env.APP_ACCESS_KEY || isHosted(),
    accessOk: !denied,
    ...(companyAi ? { companyAi } : {}),
  })
}

/** /api/profiles — list (GET), create (POST), rename (PATCH), delete with all its data (DELETE). */
export async function handleProfiles(request: Request, dbOverride?: Db): Promise<Response> {
  const denied = checkAccess(request)
  if (denied) return denied
  return withDb(async (db) => {
    const profiles = db.collection<ProfileDoc>('profiles')
    const now = new Date().toISOString()

    if (request.method === 'GET') {
      const list = await profiles.find({}).sort({ createdAt: 1 }).limit(500).toArray()
      return json(200, {
        profiles: list.map((p) => ({ id: p._id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt })),
      })
    }

    if (request.method === 'DELETE') {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!PROFILE_ID.test(id)) return json(400, { error: 'Invalid profile id.' })
      await Promise.all([
        profiles.deleteOne({ _id: id }),
        ...SYNCED_TABLES.map((t) => db.collection(t).deleteMany({ profileId: id })),
      ])
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
      const createdAt = typeof body.createdAt === 'string' ? body.createdAt.slice(0, 40) : now
      await profiles.updateOne(
        { _id: id },
        { $set: { name, updatedAt: now }, $setOnInsert: { createdAt } },
        { upsert: true },
      )
      return json(200, { id, name })
    }
    if (request.method === 'PATCH') {
      const res = await profiles.updateOne({ _id: id }, { $set: { name, updatedAt: now } })
      return res.matchedCount ? json(200, { id, name }) : json(404, { error: 'No such profile.' })
    }
    return json(405, { error: 'Method not allowed.' })
  }, dbOverride)
}

/**
 * /api/data
 *  GET  ?profileId=&table=&since=  → records changed after `since` (one page; `more` says if there's another)
 *  POST { profileId, table, upserts: [{ id, data }], deletes: [id] } → saves them
 */
export async function handleData(request: Request, dbOverride?: Db): Promise<Response> {
  const denied = checkAccess(request)
  if (denied) return denied
  return withDb(async (db) => {
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams
      const profileId = q.get('profileId') ?? ''
      const table = q.get('table')
      const since = Number(q.get('since') ?? 0) || 0
      if (!PROFILE_ID.test(profileId) || !isTable(table)) return json(400, { error: 'Invalid profile or table.' })
      const docs = await db
        .collection<RecordDoc>(table)
        .find({ profileId, srv: { $gt: Math.max(0, since - OVERLAP_MS) } })
        .sort({ srv: 1 })
        .limit(PAGE + 1)
        .toArray()
      const page = docs.slice(0, PAGE)
      return json(200, {
        records: page.map((d) => (d.deleted ? { id: d.id, deleted: true } : { id: d.id, data: d.data })),
        // Next page starts after the last stamp returned (overlap is only applied to the first page's start).
        cursor: page.length ? page[page.length - 1].srv : since,
        more: docs.length > PAGE,
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

    const ops: AnyBulkWriteOperation<RecordDoc>[] = []
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
      ops.push({
        replaceOne: {
          filter: { _id: `${profileId}:${u.id}` },
          replacement: { profileId, id: u.id, data, srv: nextStamp() },
          upsert: true,
        },
      })
    }
    for (const id of deletes) {
      if (typeof id !== 'string' || id.length > 200) return json(400, { error: 'Invalid id to delete.' })
      ops.push({
        replaceOne: {
          filter: { _id: `${profileId}:${id}` },
          replacement: { profileId, id, deleted: true, srv: nextStamp() },
          upsert: true,
        },
      })
    }
    if (ops.length) await db.collection<RecordDoc>(table).bulkWrite(ops, { ordered: false })
    return json(200, { saved: upserts.length, deleted: deletes.length })
  }, dbOverride)
}

/** One entry point for the dev server: picks the handler by path. */
export async function routeApi(path: string, request: Request): Promise<Response | undefined> {
  if (path === '/api/status') return handleStatus(request)
  if (path === '/api/profiles') return handleProfiles(request)
  if (path === '/api/data') return handleData(request)
  if (path === '/api/research') return handleResearch(request)
  if (path === '/api/ai') return handleAi(request)
  return undefined
}
