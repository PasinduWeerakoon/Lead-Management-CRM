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

/** Running on a real host rather than the local dev server. */
export const isHosted = () =>
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production'

/**
 * The app has no login and no access code: every request is allowed. The company AI key is
 * protected by its daily spending limit. (APP_ACCESS_KEY is ignored if it's still set.)
 */
export function checkAccess(_request: Request): Response | undefined {
  void _request
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
