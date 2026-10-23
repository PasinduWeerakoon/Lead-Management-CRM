import type { SyncedTable } from '../db'

/** Calls to this app's own /api functions (profiles and shared data in MongoDB). */

const ACCESS_KEY = 'leads.accessCode'

export class SyncError extends Error {
  constructor(
    message: string,
    /** access: wrong/missing access code · no_db: database not set up · offline · other */
    readonly kind: 'access' | 'no_db' | 'offline' | 'other',
  ) {
    super(message)
  }
}

export function readAccessCode(): string | undefined {
  try {
    return localStorage.getItem(ACCESS_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function saveAccessCode(code: string | undefined) {
  try {
    if (code) localStorage.setItem(ACCESS_KEY, code.trim())
    else localStorage.removeItem(ACCESS_KEY)
  } catch {
    // storage blocked: asked again next time
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const code = readAccessCode()
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(code ? { 'x-app-key': code } : {}), ...init.headers },
    })
  } catch {
    throw new SyncError("Can't reach the server. Changes are kept in this browser and sent later.", 'offline')
  }
  let body: { error?: string; code?: string } & Record<string, unknown> = {}
  try {
    body = await res.json()
  } catch {
    // no JSON
  }
  if (res.ok) return body as T
  if (res.status === 401) throw new SyncError(body.error ?? 'Enter the workspace access code.', 'access')
  if (body.code === 'no_db') throw new SyncError(body.error ?? 'The shared database isn’t set up.', 'no_db')
  if (body.code === 'db_down' || res.status >= 500)
    throw new SyncError(body.error ?? 'The database is unavailable right now.', 'offline')
  throw new SyncError(body.error ?? `The server rejected the request (${res.status}).`, 'other')
}

export interface ServerStatus {
  database: boolean
  accessRequired: boolean
  accessOk: boolean
}

export const getStatus = () => call<ServerStatus>('/api/status')

export interface ServerProfile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export const listServerProfiles = () => call<{ profiles: ServerProfile[] }>('/api/profiles').then((r) => r.profiles)

export const saveServerProfile = (p: { id: string; name: string; createdAt?: string }) =>
  call('/api/profiles', { method: 'POST', body: JSON.stringify(p) })

export const renameServerProfile = (id: string, name: string) =>
  call('/api/profiles', { method: 'PATCH', body: JSON.stringify({ id, name }) })

export const deleteServerProfile = (id: string) =>
  call(`/api/profiles?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

export interface PulledRecord {
  id: string
  data?: Record<string, unknown>
  deleted?: boolean
}

export const pullRecords = (profileId: string, table: SyncedTable, since: number) =>
  call<{ records: PulledRecord[]; cursor: number; more: boolean }>(
    `/api/data?profileId=${encodeURIComponent(profileId)}&table=${table}&since=${since}`,
  )

export const pushRecords = (
  profileId: string,
  table: SyncedTable,
  upserts: Array<{ id: string; data: Record<string, unknown> }>,
  deletes: string[],
) => call('/api/data', { method: 'POST', body: JSON.stringify({ profileId, table, upserts, deletes }) })
