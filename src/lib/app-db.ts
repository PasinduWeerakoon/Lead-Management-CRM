import Dexie, { type EntityTable } from 'dexie'
import type { AiUsageRecord } from './ai/settings'

/** A LinkedIn network you manage (yours, a colleague's…). Each one's data is kept separately. */
export interface Profile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/**
 * App-wide data shared by every profile in this browser: settings (AI and Apollo keys, models),
 * AI spend, and the list of profiles. Never synced to the database — keys stay on this device.
 */
export const appDb = new Dexie('leads-app') as Dexie & {
  settings: EntityTable<{ key: string; value: unknown }, 'key'>
  aiUsage: EntityTable<AiUsageRecord, 'id'>
  profiles: EntityTable<Profile, 'id'>
}

appDb.version(1).stores({
  settings: 'key',
  aiUsage: 'id, at',
  profiles: 'id, name',
})
