import type { Table } from 'dexie'
import { activeProfileId, db, SYNCED_TABLES, type SyncedTable } from '../db'
import { pullRecords, pushRecords, SyncError, type PulledRecord } from './api'
import { markQuiet, quietTransactions } from './marks'

/**
 * Keeps this profile's local data and the shared MongoDB copy in step.
 *
 * - Every local change gets a `_ts` stamp; anything stamped after the last successful send is
 *   "unsent" and goes up in batches. Deletes are remembered until sent.
 * - Changes from the database come down by `since` cursors and are applied quietly (not re-sent).
 *   A record with unsent local changes keeps them — they reach the database on the next send.
 * - The first time a browser links a profile that already has data in the database, the
 *   database's copy wins, so an old browser can't overwrite newer shared data.
 */

const PUSH_BATCH = 300

interface SyncState {
  /** Server cursor per table. */
  pulled: Partial<Record<SyncedTable, number>>
  /** Highest local `_ts` already sent, per table. */
  pushed: Partial<Record<SyncedTable, number>>
  /** Deletes waiting to be sent. */
  deletes: Partial<Record<SyncedTable, string[]>>
  /** Set once this browser has linked the profile to the database. */
  linked?: boolean
}

const stateKey = (profileId: string) => `leads.sync.${profileId}`

export function readState(profileId = activeProfileId()): SyncState {
  try {
    const raw = localStorage.getItem(stateKey(profileId))
    if (raw) return { pulled: {}, pushed: {}, deletes: {}, ...JSON.parse(raw) }
  } catch {
    // fall through
  }
  return { pulled: {}, pushed: {}, deletes: {} }
}

function writeState(state: SyncState, profileId = activeProfileId()) {
  try {
    localStorage.setItem(stateKey(profileId), JSON.stringify(state))
  } catch {
    // storage blocked: everything is re-checked next time
  }
}

export function forgetState(profileId: string) {
  try {
    localStorage.removeItem(stateKey(profileId))
  } catch {
    // ignore
  }
}

let lastStamp = 0
/** Strictly increasing, so two changes in the same millisecond are both seen as new. */
export function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1)
  return lastStamp
}

const table = (t: SyncedTable) => db.table(t) as Table<Record<string, unknown> & { _ts?: number }, string>

// --- change tracking --------------------------------------------------------------------------

let onLocalChange: () => void = () => {}
/** Called after any local change to synced data (the sync scheduler sends it shortly after). */
export const setChangeListener = (fn: () => void) => {
  onLocalChange = fn
}

let installed = false
export function installChangeTracking() {
  if (installed) return
  installed = true
  for (const t of SYNCED_TABLES) {
    const tbl = table(t)
    tbl.hook('creating', (_key, obj, tx) => {
      if (quietTransactions.has(tx)) {
        obj._ts = 0
        return
      }
      obj._ts = stamp()
      onLocalChange()
    })
    tbl.hook('updating', (mods, _key, _obj, tx) => {
      if (quietTransactions.has(tx)) return { _ts: 0 }
      // A change that only touches _ts itself isn't a user change.
      if (Object.keys(mods).every((k) => k === '_ts')) return undefined
      onLocalChange()
      return { _ts: stamp() }
    })
    tbl.hook('deleting', (key, _obj, tx) => {
      if (quietTransactions.has(tx)) return
      rememberDelete(t, String(key))
    })
  }
}

/** Deletes are collected and written to the sync state once per tick, so clearing 1,000s of rows stays fast. */
const pendingDeletes = new Map<SyncedTable, Set<string>>()
function rememberDelete(t: SyncedTable, id: string) {
  if (!pendingDeletes.size) queueMicrotask(flushDeletes)
  const set = pendingDeletes.get(t) ?? new Set<string>()
  set.add(id)
  pendingDeletes.set(t, set)
}

export function flushDeletes() {
  if (!pendingDeletes.size) return
  const state = readState()
  for (const [t, ids] of pendingDeletes) state.deletes[t] = [...new Set([...(state.deletes[t] ?? []), ...ids])]
  pendingDeletes.clear()
  writeState(state)
  onLocalChange()
}

// --- send & receive ---------------------------------------------------------------------------

const strip = ({ _ts, ...rest }: Record<string, unknown>) => {
  void _ts
  return rest
}

/** Sends unsent changes for one table. Returns how many records went up. */
export async function pushTable(t: SyncedTable, profileId = activeProfileId()): Promise<number> {
  flushDeletes()
  const state = readState(profileId)
  const since = state.pushed[t] ?? 0
  const rows = await table(t).where('_ts').above(since).toArray()
  // A record deleted and then saved again (e.g. restoring a backup) is sent as saved, not deleted.
  const saved = new Set(rows.map((r) => String(r.id)))
  const queued = state.deletes[t] ?? []
  const deletes = queued.filter((id) => !saved.has(id))

  // Deletes first, in their own batches; each batch is forgotten once the server has it.
  for (let i = 0; i < deletes.length; i += PUSH_BATCH) {
    const chunk = deletes.slice(i, i + PUSH_BATCH)
    await pushRecords(profileId, t, [], chunk)
    const latest = readState(profileId)
    latest.deletes[t] = (latest.deletes[t] ?? []).filter((id) => !chunk.includes(id))
    writeState(latest, profileId)
  }
  if (deletes.length !== queued.length) {
    // Drop deletes that were superseded by a later save.
    const latest = readState(profileId)
    latest.deletes[t] = (latest.deletes[t] ?? []).filter((id) => !saved.has(id))
    writeState(latest, profileId)
  }

  let maxTs = since
  for (let i = 0; i < rows.length; i += PUSH_BATCH) {
    const chunk = rows.slice(i, i + PUSH_BATCH)
    await pushRecords(
      profileId,
      t,
      chunk.map((r) => ({ id: String(r.id), data: strip(r) })),
      [],
    )
    for (const r of chunk) maxTs = Math.max(maxTs, r._ts ?? 0)
    // Save progress after each batch, so a failure part-way doesn't resend everything.
    const latest = readState(profileId)
    latest.pushed[t] = maxTs
    writeState(latest, profileId)
  }
  return rows.length + deletes.length
}

/** Brings down changes for one table. Returns how many records were applied. */
export async function pullTable(t: SyncedTable, profileId = activeProfileId(), serverWins = false): Promise<number> {
  let applied = 0
  for (;;) {
    const state = readState(profileId)
    const res = await pullRecords(profileId, t, state.pulled[t] ?? 0)
    applied += await applyRemote(t, res.records, serverWins ? Infinity : (state.pushed[t] ?? 0))
    const latest = readState(profileId)
    latest.pulled[t] = Math.max(latest.pulled[t] ?? 0, res.cursor)
    writeState(latest, profileId)
    if (!res.more) return applied
  }
}

/**
 * Applies records from the database. A local record changed after `sentUpTo` has unsent edits and
 * is left alone (pass Infinity to let the database win, as on first link).
 */
export async function applyRemote(t: SyncedTable, records: PulledRecord[], sentUpTo: number): Promise<number> {
  if (!records.length) return 0
  const tbl = table(t)
  let applied = 0
  await db.transaction('rw', tbl, async (tx) => {
    markQuiet(tx)
    const locals = await tbl.bulkGet(records.map((r) => r.id))
    const puts: Array<Record<string, unknown>> = []
    const dels: string[] = []
    records.forEach((r, i) => {
      const local = locals[i]
      if (local && sentUpTo !== Infinity && (local._ts ?? 0) > sentUpTo) return // unsent local edit wins
      if (r.deleted) {
        if (local) dels.push(r.id)
      } else if (r.data) puts.push({ ...r.data, _ts: 0 })
    })
    if (puts.length) await tbl.bulkPut(puts)
    if (dels.length) await tbl.bulkDelete(dels)
    applied = puts.length + dels.length
  })
  return applied
}

export interface SyncResult {
  pulled: number
  pushed: number
}

/**
 * One full round: receive then send, table by table. On a browser's first link to a profile, if
 * the database already has data for it, the database's copy replaces the local one.
 */
export async function syncOnce(profileId = activeProfileId()): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0 }
  const state = readState(profileId)
  if (!state.linked) {
    const remoteHasData = (await pullRecords(profileId, 'contacts', 0)).records.length > 0
    if (remoteHasData) {
      // The shared copy wins: drop local leftovers and take the database's data.
      await db.transaction('rw', SYNCED_TABLES.map(table), async (tx) => {
        markQuiet(tx)
        for (const t of SYNCED_TABLES) await table(t).clear()
      })
      writeState({ pulled: {}, pushed: {}, deletes: {}, linked: true }, profileId)
      for (const t of SYNCED_TABLES) result.pulled += await pullTable(t, profileId, true)
      return result
    }
    writeState({ ...state, linked: true }, profileId)
  }
  for (const t of SYNCED_TABLES) {
    result.pulled += await pullTable(t, profileId)
    result.pushed += await pushTable(t, profileId)
  }
  return result
}

export { SyncError }
