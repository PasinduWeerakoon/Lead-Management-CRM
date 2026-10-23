import { db } from './db'
import { BackupSchema, type Backup } from './schemas'

export async function createBackup(): Promise<Backup> {
  const [contacts, imports, keywordPacks, views, briefs, presets] = await Promise.all([
    db.contacts.toArray(),
    db.imports.toArray(),
    db.keywordPacks.toArray(),
    db.views.toArray(),
    db.briefs.toArray(),
    db.presets.toArray(),
  ])
  return {
    app: 'leads-management',
    version: 2,
    exportedAt: new Date().toISOString(),
    contacts,
    imports,
    keywordPacks,
    views,
    briefs,
    presets,
  }
}

export type RestoreResult = { ok: true; backup: Backup } | { ok: false; error: string }

export function readBackup(text: string): RestoreResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: "This file isn't valid JSON." }
  }
  const parsed = BackupSchema.safeParse(json)
  if (!parsed.success) {
    return { ok: false, error: "This doesn't look like a Leads backup file, or it's damaged." }
  }
  return { ok: true, backup: parsed.data }
}

/**
 * Replaces contacts and history with the backup's. Packs and views are replaced only if the backup has them.
 * Deletes go through the change tracking (not clear()), so they reach the shared database too.
 */
export async function restoreBackup(backup: Backup): Promise<void> {
  await db.transaction('rw', [db.contacts, db.imports, db.keywordPacks, db.views, db.briefs, db.presets], async () => {
    await db.contacts.toCollection().delete()
    await db.imports.toCollection().delete()
    await db.contacts.bulkPut(backup.contacts)
    await db.imports.bulkPut(backup.imports)
    if (backup.keywordPacks) {
      await db.keywordPacks.toCollection().delete()
      await db.keywordPacks.bulkPut(backup.keywordPacks)
    }
    if (backup.views) {
      await db.views.toCollection().delete()
      await db.views.bulkPut(backup.views)
    }
    if (backup.briefs) {
      await db.briefs.toCollection().delete()
      await db.briefs.bulkPut(backup.briefs)
    }
    if (backup.presets) {
      await db.presets.toCollection().delete()
      await db.presets.bulkPut(backup.presets)
    }
  })
}

/** Removes contacts and import history. Keyword packs and saved views are kept: they hold no personal data. */
export async function deleteAllData(): Promise<void> {
  await db.transaction('rw', db.contacts, db.imports, async () => {
    await db.contacts.toCollection().delete()
    await db.imports.toCollection().delete()
  })
}
