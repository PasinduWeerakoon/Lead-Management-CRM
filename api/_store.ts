import type { AnyBulkWriteOperation, Db } from 'mongodb'
import { getDb, nextStamp, SYNCED_TABLES, type SyncedTable } from './_db.js'

/**
 * Where the shared data lives. The routes only talk to this interface, so the same code runs on:
 *  - DynamoDB (DATA_TABLE): the AWS setup, on-demand, no cost when idle
 *  - MongoDB (MONGODB_URI): the earlier setup, kept so nothing breaks
 *  - memory (DATA_STORE=memory): a local server with no database, data lost on restart
 * With none of these set there is no shared database and the app works in each browser only.
 */

export interface Profile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/** One synced record. `srv` is the server's write stamp; deleted records stay as markers. */
export interface StoredRecord {
  id: string
  data?: Record<string, unknown>
  deleted?: boolean
  srv: number
}

export interface RecordWrite {
  id: string
  data?: Record<string, unknown>
  deleted?: boolean
}

export interface DataStore {
  readonly kind: 'dynamo' | 'mongo' | 'memory'
  listProfiles(): Promise<Profile[]>
  /** Creates the profile, or renames it if it exists (createdAt is kept). */
  saveProfile(id: string, name: string, createdAt: string): Promise<void>
  /** False when there is no such profile. */
  renameProfile(id: string, name: string): Promise<boolean>
  /** Removes the profile and every record in it. */
  deleteProfile(id: string): Promise<void>
  /** Records with srv > after, oldest first, at most `limit`; `more` says if there are others. */
  changes(
    profileId: string,
    table: SyncedTable,
    after: number,
    limit: number,
  ): Promise<{ records: StoredRecord[]; more: boolean }>
  write(profileId: string, table: SyncedTable, records: RecordWrite[]): Promise<void>
}

/** A refusal the routes turn into an HTTP answer (e.g. a record too big for the database). */
export class StoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const storeConfigured = () =>
  !!process.env.DATA_TABLE || !!process.env.MONGODB_URI || process.env.DATA_STORE === 'memory'

// --- memory -------------------------------------------------------------------------------------

export function memoryStore(): DataStore {
  const profiles = new Map<string, Profile>()
  const records = new Map<string, Map<string, StoredRecord>>()
  const part = (p: string, t: string) => {
    const k = `${p}#${t}`
    if (!records.has(k)) records.set(k, new Map())
    return records.get(k)!
  }
  return {
    kind: 'memory',
    listProfiles: async () => [...profiles.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    saveProfile: async (id, name, createdAt) => {
      const now = new Date().toISOString()
      profiles.set(id, { id, name, createdAt: profiles.get(id)?.createdAt ?? createdAt, updatedAt: now })
    },
    renameProfile: async (id, name) => {
      const p = profiles.get(id)
      if (!p) return false
      profiles.set(id, { ...p, name, updatedAt: new Date().toISOString() })
      return true
    },
    deleteProfile: async (id) => {
      profiles.delete(id)
      for (const t of SYNCED_TABLES) records.delete(`${id}#${t}`)
    },
    changes: async (p, t, after, limit) => {
      const all = [...part(p, t).values()].filter((r) => r.srv > after).sort((a, b) => a.srv - b.srv)
      return { records: all.slice(0, limit), more: all.length > limit }
    },
    write: async (p, t, recs) => {
      const m = part(p, t)
      for (const r of recs) m.set(r.id, { ...r, srv: nextStamp() })
    },
  }
}

// --- MongoDB (the earlier setup) ---------------------------------------------------------------

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

export function mongoStore(db: Db): DataStore {
  const profiles = db.collection<ProfileDoc>('profiles')
  return {
    kind: 'mongo',
    listProfiles: async () =>
      (await profiles.find({}).sort({ createdAt: 1 }).limit(500).toArray()).map((p) => ({
        id: p._id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    saveProfile: async (id, name, createdAt) => {
      await profiles.updateOne(
        { _id: id },
        { $set: { name, updatedAt: new Date().toISOString() }, $setOnInsert: { createdAt } },
        { upsert: true },
      )
    },
    renameProfile: async (id, name) =>
      (await profiles.updateOne({ _id: id }, { $set: { name, updatedAt: new Date().toISOString() } })).matchedCount > 0,
    deleteProfile: async (id) => {
      await Promise.all([
        profiles.deleteOne({ _id: id }),
        ...SYNCED_TABLES.map((t) => db.collection(t).deleteMany({ profileId: id })),
      ])
    },
    changes: async (profileId, table, after, limit) => {
      const docs = await db
        .collection<RecordDoc>(table)
        .find({ profileId, srv: { $gt: after } })
        .sort({ srv: 1 })
        .limit(limit + 1)
        .toArray()
      return {
        records: docs.slice(0, limit).map((d) => ({ id: d.id, data: d.data, deleted: d.deleted, srv: d.srv })),
        more: docs.length > limit,
      }
    },
    write: async (profileId, table, recs) => {
      const ops: AnyBulkWriteOperation<RecordDoc>[] = recs.map((r) => ({
        replaceOne: {
          filter: { _id: `${profileId}:${r.id}` },
          replacement: r.deleted
            ? { profileId, id: r.id, deleted: true, srv: nextStamp() }
            : { profileId, id: r.id, data: r.data, srv: nextStamp() },
          upsert: true,
        },
      }))
      if (ops.length) await db.collection<RecordDoc>(table).bulkWrite(ops, { ordered: false })
    },
  }
}

// --- picking one ------------------------------------------------------------------------------

let memory: DataStore | undefined
let dynamo: Promise<DataStore> | undefined

/** The configured store, or undefined when there is no shared database. Throws if it can't be reached. */
export async function getStore(): Promise<DataStore | undefined> {
  const table = process.env.DATA_TABLE
  if (table) {
    // Loaded only on AWS (or with DynamoDB Local), so other setups don't need the SDK.
    dynamo ??= import('./_store-dynamo.js').then((m) => m.dynamoStore(table))
    return dynamo
  }
  if (process.env.MONGODB_URI) {
    const db = await getDb()
    return db ? mongoStore(db) : undefined
  }
  if (process.env.DATA_STORE === 'memory') return (memory ??= memoryStore())
  return undefined
}

/** For tests: forget the cached stores so a new configuration is picked up. */
export function resetStores() {
  memory = undefined
  dynamo = undefined
}
