import { MongoClient, type Db } from 'mongodb'
import { requireUser } from './_auth.js'

/**
 * Shared server helpers: the MongoDB connection (reused across requests, as serverless functions
 * keep warm instances), the Google sign-in check, and JSON responses.
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

/** Every data route calls this: a 401 unless someone is signed in with Google (see _auth.ts). */
export function checkAccess(request: Request): Response | undefined {
  return requireUser(request)
}

/** Strictly increasing write stamps, so "changes since" never misses two writes in the same millisecond. */
let lastStamp = 0
export function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return lastStamp
}
