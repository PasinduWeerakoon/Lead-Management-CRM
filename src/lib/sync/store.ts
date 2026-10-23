import { create } from 'zustand'
import { activeProfileId } from '../db'
import { getStatus, SyncError } from './api'
import { ensureProfilesLinked } from '../profiles'
import { installChangeTracking, setChangeListener, syncOnce } from './engine'

export type SyncStatus =
  | 'starting'
  /** No database configured: data stays in this browser. */
  | 'local'
  | 'syncing'
  | 'synced'
  /** Couldn't reach the server/database; changes are kept and retried. */
  | 'offline'
  /** The workspace access code is missing or wrong. */
  | 'access'
  | 'error'

interface SyncStore {
  status: SyncStatus
  message?: string
  lastSyncedAt?: string
  start: () => Promise<void>
  syncNow: () => Promise<void>
}

const SEND_AFTER_MS = 2500
const PULL_EVERY_MS = 60_000

let running: Promise<void> | undefined
let again = false
let debounce: ReturnType<typeof setTimeout> | undefined
let started = false

export const useSync = create<SyncStore>((set, get) => ({
  status: 'starting',

  start: async () => {
    if (started) return
    started = true
    installChangeTracking()
    setChangeListener(() => {
      clearTimeout(debounce)
      debounce = setTimeout(() => void get().syncNow(), SEND_AFTER_MS)
    })
    setInterval(() => void get().syncNow(), PULL_EVERY_MS)
    window.addEventListener('focus', () => void get().syncNow())
    window.addEventListener('online', () => void get().syncNow())
    await get().syncNow()
  },

  syncNow: async () => {
    // One round at a time; a request during a round queues exactly one more.
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        try {
          const server = await getStatus()
          // The access code also unlocks website research and Apollo, so ask for it even without a database.
          if (!server.accessOk) {
            set({ status: 'access', message: 'Enter the workspace access code.' })
            return
          }
          if (!server.database) {
            set({ status: 'local', message: undefined })
            return
          }
          if (get().status !== 'synced') set({ status: 'syncing' })
          await ensureProfilesLinked()
          await syncOnce(activeProfileId())
          set({ status: 'synced', message: undefined, lastSyncedAt: new Date().toISOString() })
        } catch (e) {
          const err =
            e instanceof SyncError ? e : new SyncError(e instanceof Error ? e.message : 'Sync failed.', 'other')
          set({
            status:
              err.kind === 'access'
                ? 'access'
                : err.kind === 'no_db'
                  ? 'local'
                  : err.kind === 'offline'
                    ? 'offline'
                    : 'error',
            message: err.message,
          })
          return
        }
      } while (again)
    })().finally(() => {
      running = undefined
    })
    return running
  },
}))
