import { timingSafeEqual } from 'node:crypto'
import { MongoClient, type Db } from 'mongodb'

/**
 * Shared server helpers: the MongoDB connection (reused across requests, as serverless functions
 * keep warm instances), the workspace access code check, and JSON responses.
 */

export const SYNCED_TABLES = ['contacts', 'imports', 'keywordPacks', 'views', 'briefs', 'presets'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

export const PROFILE_ID = /^[A-Za-z0-9_-]{1,64}$/

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

let clientPromise: Promise<MongoClient> | undefined
let indexesReady: Promise<void> | undefined

export const databaseConfigured = () => !!process.env.MONGODB_URI

/** The app's database, or undefined when MONGODB_URI isn't set (the app then works locally only). */
export async function getDb(): Promise<Db | undefined> {
  const uri = process.env.MONGODB_URI
  if (!uri) return undefined
  clientPromise ??= new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 }).connect().catch((e) => {
    clientPromise = undefined
    throw e
  })
  const db = (await clientPromise).db(process.env.MONGODB_DB || 'leads')
  indexesReady ??= ensureIndexes(db).catch((e) => {
    indexesReady = undefined
    throw e
  })
  await indexesReady
  return db
}

export async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection('profiles').createIndex({ name: 1 }),
    ...SYNCED_TABLES.map((t) => db.collection(t).createIndex({ profileId: 1, srv: 1 })),
  ])
}

/**
 * There's no login, so a shared workspace access code (APP_ACCESS_KEY) keeps the data private.
 * It's required whenever the app is hosted (Vercel or AWS Lambda); only the local dev server runs
 * open without one.
 */
/** Running on a real host rather than the local dev server. */
export const isHosted = () =>
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production'

export function checkAccess(request: Request): Response | undefined {
  // Trimmed: a value pasted into Vercel with a stray space or line break still works.
  const expected = process.env.APP_ACCESS_KEY?.trim()
  if (!expected) {
    if (isHosted())
      return json(503, {
        error: 'Set APP_ACCESS_KEY on the server (Vercel or Lambda environment) before using it.',
        code: 'no_access_key',
      })
    return undefined
  }
  const given = (request.headers.get('x-app-key') ?? '').trim()
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return json(401, { error: 'Enter the workspace access code.', code: 'access' })
  return undefined
}

/** Strictly increasing write stamps, so "changes since" never misses two writes in the same millisecond. */
let lastStamp = 0
export function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return lastStamp
}

/** Runs a handler with the database, turning a missing configuration or outage into a clear answer. */
export async function withDb(fn: (db: Db) => Promise<Response>, dbOverride?: Db): Promise<Response> {
  let db: Db | undefined
  try {
    db = dbOverride ?? (await getDb())
  } catch {
    return json(503, {
      error: "Couldn't reach the database. Check MONGODB_URI and Atlas network access.",
      code: 'db_down',
    })
  }
  if (!db) return json(503, { error: 'The shared database isn’t set up (MONGODB_URI).', code: 'no_db' })
  return fn(db)
}
