import Dexie from 'dexie'
import { appDb, type Profile } from './app-db'
import { activeProfileId, DEFAULT_PROFILE_ID, profileDbName, setActiveProfileId } from './db'
import {
  deleteServerProfile,
  getStatus,
  listServerProfiles,
  renameServerProfile,
  saveServerProfile,
  SyncError,
} from './sync/api'
import { forgetState, readState } from './sync/engine'

/**
 * Profiles: separate LinkedIn networks (yours, a colleague's…). Each has its own local database in this
 * browser and its own data in MongoDB. The list itself is kept in the app-wide store and, when the
 * shared database is set up, in MongoDB so every browser sees the same profiles.
 */

export const DEFAULT_PROFILE_NAME = 'My network'

const cleanName = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, 80)

/** Makes sure there's at least the first profile (which holds data from before profiles existed). */
export async function ensureDefaultProfile(): Promise<Profile[]> {
  const list = await appDb.profiles.toArray()
  if (list.length) return list
  const now = new Date().toISOString()
  const first = { id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: now, updatedAt: now }
  await appDb.profiles.put(first)
  return [first]
}

async function databaseReady(): Promise<boolean> {
  try {
    const s = await getStatus()
    return s.database && s.accessOk
  } catch {
    return false
  }
}

/**
 * Brings the local profile list and the database's list together: profiles created in another
 * browser appear here, ones only known here are saved to the database, names follow the newest edit,
 * and a profile deleted elsewhere disappears (unless it's the one open in this tab).
 */
export async function ensureProfilesLinked(): Promise<void> {
  const local = await ensureDefaultProfile()
  const remote = await listServerProfiles()
  const remoteById = new Map(remote.map((p) => [p.id, p]))
  const active = activeProfileId()

  for (const p of local) {
    const r = remoteById.get(p.id)
    if (r) {
      if (r.name !== p.name && r.updatedAt > p.updatedAt)
        await appDb.profiles.put({ ...p, name: r.name, updatedAt: r.updatedAt })
      else if (r.name !== p.name) await renameServerProfile(p.id, p.name)
    } else if (readState(p.id).linked && p.id !== active) {
      await removeLocalProfile(p.id) // deleted in another browser
    } else {
      await saveServerProfile({ id: p.id, name: p.name, createdAt: p.createdAt })
    }
  }
  for (const r of remote) if (!local.some((p) => p.id === r.id)) await appDb.profiles.put(r)
}

export async function createProfile(name: string): Promise<Profile> {
  const clean = cleanName(name)
  if (!clean) throw new Error('Give the profile a name.')
  const now = new Date().toISOString()
  const profile: Profile = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 20),
    name: clean,
    createdAt: now,
    updatedAt: now,
  }
  await appDb.profiles.put(profile)
  if (await databaseReady()) await saveServerProfile(profile)
  return profile
}

export async function renameProfile(id: string, name: string): Promise<void> {
  const clean = cleanName(name)
  if (!clean) throw new Error('Give the profile a name.')
  const p = await appDb.profiles.get(id)
  if (!p) return
  await appDb.profiles.put({ ...p, name: clean, updatedAt: new Date().toISOString() })
  if (await databaseReady()) await renameServerProfile(id, clean)
}

async function removeLocalProfile(id: string) {
  await appDb.profiles.delete(id)
  forgetState(id)
  await Dexie.delete(profileDbName(id))
}

/**
 * Deletes a profile and all its data — in this browser and in the shared database. If it's the
 * open profile, switches to another one first (reloads the page).
 */
export async function deleteProfile(id: string): Promise<void> {
  const others = (await appDb.profiles.toArray()).filter((p) => p.id !== id)
  if (!others.length) throw new Error('You need at least one profile. Create another before deleting this one.')
  if (await databaseReady()) {
    try {
      await deleteServerProfile(id)
    } catch (e) {
      if (!(e instanceof SyncError && e.kind === 'no_db')) throw e
    }
  }
  if (id === activeProfileId()) {
    await appDb.profiles.delete(id)
    forgetState(id)
    setActiveProfileId(others[0].id)
    // The open database can't be deleted from this page; it's removed after the reload.
    await appDb.settings.put({ key: 'pendingProfileDbDelete', value: id })
    window.location.reload()
    return
  }
  await removeLocalProfile(id)
}

/** Removes a profile database left over from deleting the open profile (runs at startup). */
export async function finishPendingDeletes(): Promise<void> {
  const row = await appDb.settings.get('pendingProfileDbDelete')
  const id = row?.value
  if (typeof id !== 'string' || id === activeProfileId()) return
  await Dexie.delete(profileDbName(id))
  await appDb.settings.delete('pendingProfileDbDelete')
}

/** Opens another profile. Each profile has its own local database, so the page reloads. */
export function switchProfile(id: string) {
  if (id === activeProfileId()) return
  setActiveProfileId(id)
  window.location.reload()
}
