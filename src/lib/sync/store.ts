import { create } from 'zustand'
import { activeProfileId, MEMORY_ONLY } from '../db'
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
  /** The first round has finished (data loaded, or it's clear there is no database). */
  ready: boolean
  /** Local changes not yet confirmed by the server. */
  unsent: boolean
  message?: string
  lastSyncedAt?: string
  start: () => Promise<void>
  syncNow: () => Promise<void>
}

// Memory-only data has no other copy, so changes go to the server almost at once.
const SEND_AFTER_MS = MEMORY_ONLY ? 300 : 2500
const PULL_EVERY_MS = 60_000

let running: Promise<void> | undefined
let again = false
let debounce: ReturnType<typeof setTimeout> | undefined
let started = false

export const useSync = create<SyncStore>((set, get) => ({
  status: 'starting',
  ready: false,
  unsent: false,

  start: async () => {
    if (started) return
    started = true
    installChangeTracking()
    setChangeListener(() => {
      if (!get().unsent) set({ unsent: true })
      clearTimeout(debounce)
      debounce = setTimeout(() => void get().syncNow(), SEND_AFTER_MS)
    })
    setInterval(() => void get().syncNow(), PULL_EVERY_MS)
    window.addEventListener('focus', () => void get().syncNow())
    window.addEventListener('online', () => void get().syncNow())
    // Closing the tab with changes still on their way would lose them when nothing is kept locally.
    window.addEventListener('beforeunload', (e) => {
      if (MEMORY_ONLY && get().unsent) e.preventDefault()
    })
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
        const pending = get().unsent
        try {
          const server = await getStatus()
          // The access code also unlocks website research and Apollo, so ask for it even without a database.
          if (!server.accessOk) {
            set({ status: 'access', message: 'Enter the workspace access code.', ready: true })
            return
          }
          if (!server.database) {
            set({ status: 'local', message: undefined, ready: true })
            return
          }
          if (get().status !== 'synced') set({ status: 'syncing' })
          await ensureProfilesLinked()
          // A change made during the round marks unsent again (and queues another round).
          set({ unsent: false })
          await syncOnce(activeProfileId())
          set({ status: 'synced', message: undefined, lastSyncedAt: new Date().toISOString(), ready: true })
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
            ready: true,
            // Changes that didn't reach the server are still waiting.
            unsent: get().unsent || pending,
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
