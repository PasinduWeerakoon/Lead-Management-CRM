import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { Brief, Contact, ImportRecord } from './schemas'
import type { KeywordPack, SavedPreset, SavedView } from './filters/schema'
import { BUILT_IN_PACKS, builtInPresetId, builtInPresetRecords, KEPT_PRESET_KEYS, PRESETS_ADDED_IN_V6 } from './filters/presets'
import type { AiUsageRecord } from './ai/settings'
import { SAMPLE_BRIEFS, sampleBriefRecords } from './ai/sample-briefs'
import { markQuiet } from './sync/marks'
import { classifyTitle } from './classify-title'

/** The profile shown in this tab. Switching profile reloads the page with another local database. */
export const DEFAULT_PROFILE_ID = 'default'
const ACTIVE_PROFILE_KEY = 'leads.activeProfile'

export function activeProfileId(): string {
  try {
    const id = localStorage.getItem(ACTIVE_PROFILE_KEY)
    return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : DEFAULT_PROFILE_ID
  } catch {
    return DEFAULT_PROFILE_ID
  }
}

export function setActiveProfileId(id: string) {
  try {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id)
  } catch {
    // storage blocked: stays on the current profile
  }
}

/** The first profile keeps the original database name, so existing data needs no move. */
export const profileDbName = (id: string) => (id === DEFAULT_PROFILE_ID ? 'leads-management' : `leads-profile-${id}`)

/** Tables copied to the shared database. Settings and keys never are. */
export const SYNCED_TABLES = ['contacts', 'imports', 'keywordPacks', 'views', 'briefs', 'presets'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

export const db = new Dexie(profileDbName(activeProfileId())) as Dexie & {
  contacts: EntityTable<Contact, 'id'>
  imports: EntityTable<ImportRecord, 'id'>
  keywordPacks: EntityTable<KeywordPack, 'id'>
  views: EntityTable<SavedView, 'id'>
  /** Before profiles, app settings lived here; they're copied to appDb once (see migrateLegacySettings). */
  settings: EntityTable<{ key: string; value: unknown }, 'key'>
  aiUsage: EntityTable<AiUsageRecord, 'id'>
  briefs: EntityTable<Brief, 'id'>
  presets: EntityTable<SavedPreset, 'id'>
}

db.version(1).stores({
  contacts: 'id, fullName, company, seniority, function, status, connectedOn, importedAt, source',
  imports: 'id, at',
})

db.version(2)
  .stores({
    keywordPacks: 'id, name',
    views: 'id, name, createdAt',
  })
  .upgrade((tx) => seedPacks(tx))

db.version(3).stores({
  settings: 'key',
  aiUsage: 'id, at',
})

db.version(4).stores({
  briefs: 'id, name, updatedAt',
})

db.version(5)
  .stores({ presets: 'id, name, createdAt' })
  .upgrade((tx) => seedPresets(tx))

// Adds the "Greater Boston" built-in to existing databases (company HQ made location filters useful).
db.version(6)
  .stores({})
  .upgrade(async (tx) => {
    const table = tx.table('presets')
    const fresh = builtInPresetRecords(new Date().toISOString()).filter((p) => PRESETS_ADDED_IN_V6.includes(p.builtIn!))
    for (const p of fresh) if (!(await table.get(p.id))) await table.put(p)
  })

// Adds the sample scoring briefs to existing databases.
db.version(7)
  .stores({})
  .upgrade((tx) => seedBriefs(tx))

// `_ts` marks local changes not yet sent to the shared database. Existing rows start as unsent.
db.version(8)
  .stores({
    contacts: 'id, fullName, company, seniority, function, status, connectedOn, importedAt, source, _ts',
    imports: 'id, at, _ts',
    keywordPacks: 'id, name, _ts',
    views: 'id, name, createdAt, _ts',
    briefs: 'id, name, updatedAt, _ts',
    presets: 'id, name, createdAt, _ts',
  })
  .upgrade(async (tx) => {
    for (const t of SYNCED_TABLES) await tx.table(t).toCollection().modify({ _ts: 1 })
  })

// Better title rules (engineers, QA, recruiters, finance, PR…): re-label everyone already imported.
db.version(9)
  .stores({})
  .upgrade((tx) =>
    tx
      .table('contacts')
      .toCollection()
      .modify((c: Contact) => {
        Object.assign(c, classifyTitle(c.position))
      }),
  )

// Clean slate: keep only the C-suite and Senior decision-makers presets and the Founders & CEOs
// brief; every other preset and brief (built-in or your own) is removed.
db.version(10)
  .stores({})
  .upgrade(async (tx) => {
    const keepPresets = new Set(KEPT_PRESET_KEYS.map(builtInPresetId))
    const keepBriefs = new Set(SAMPLE_BRIEFS.map((b) => b.id))
    await tx.table('presets').filter((p: SavedPreset) => !keepPresets.has(p.id)).delete()
    await tx.table('briefs').filter((b: Brief) => !keepBriefs.has(b.id)).delete()
  })

db.on('populate', async (tx) => {
  // Built-in packs, presets and briefs exist in every browser; they aren't sent to the shared database.
  markQuiet(tx)
  await seedPacks(tx)
  await seedPresets(tx)
  await seedBriefs(tx)
})

/** Adds sample briefs that aren't there yet, never touching briefs you've edited. */
async function seedBriefs(tx: Transaction) {
  const table = tx.table('briefs')
  for (const b of sampleBriefRecords(new Date().toISOString())) if (!(await table.get(b.id))) await table.put(b)
}

function seedPresets(tx: Transaction) {
  return tx.table('presets').bulkPut(builtInPresetRecords(new Date().toISOString()))
}

function seedPacks(tx: Transaction) {
  const now = new Date().toISOString()
  return tx.table('keywordPacks').bulkPut(BUILT_IN_PACKS.map((p) => ({ ...p, builtIn: true, updatedAt: now })))
}

/**
 * Settings, keys and AI spend used to live in the first profile's database. Copies them to the
 * app-wide store once, so every profile shares them.
 */
export async function migrateLegacySettings(): Promise<void> {
  const { appDb } = await import('./app-db')
  if (await appDb.settings.get('migratedLegacy')) return
  if (activeProfileId() === DEFAULT_PROFILE_ID) {
    const [settings, usage] = await Promise.all([db.settings.toArray(), db.aiUsage.toArray()])
    for (const row of settings) if (!(await appDb.settings.get(row.key))) await appDb.settings.put(row)
    if (usage.length) await appDb.aiUsage.bulkPut(usage)
  }
  await appDb.settings.put({ key: 'migratedLegacy', value: new Date().toISOString() })
}
