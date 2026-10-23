import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/db'
import { autoMapColumns, parseCsvText } from '../src/lib/csv'
import { commitImport, planImport } from '../src/lib/import-service'
import { createBackup, deleteAllData, readBackup, restoreBackup } from '../src/lib/backup'
import { bulkUpdate, updateContact } from '../src/lib/contacts'

const CSV = `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://www.linkedin.com/in/jane-doe,,Contoso,CIO,15 Oct 2024
Mark,Kim,https://www.linkedin.com/in/mark-kim,,Fabrikam,IT Director,01 Feb 2020
Jane,Doe,https://www.linkedin.com/in/jane-doe,,Contoso,CIO,15 Oct 2024
,,,,Litware,CTO,01 Feb 2020
`

async function importText(text: string) {
  const table = parseCsvText(text)
  const plan = await planImport(table, autoMapColumns(table.headers), 'linkedin_export')
  return { plan, record: await commitImport(plan, 'Connections.csv') }
}

beforeEach(async () => {
  await deleteAllData()
})

describe('import', () => {
  it('adds new people, merges in-file duplicates and reports skipped lines', async () => {
    const { plan, record } = await importText(CSV)
    expect(plan.toAdd).toHaveLength(2)
    expect(plan.duplicatesInFile).toBe(1)
    expect(plan.skipped).toEqual([{ row: 4, reason: 'No name' }])
    expect(record).toMatchObject({ added: 2, updated: 0, skipped: 1 })
    expect(await db.contacts.count()).toBe(2)
  })

  it('re-import updates changed rows and keeps the status', async () => {
    await importText(CSV)
    const jane = (await db.contacts.where('fullName').equals('Jane Doe').first())!
    await db.contacts.update(jane.id, { status: 'contacted' })

    const { plan } = await importText(CSV.replaceAll('Contoso,CIO', 'Contoso,Chief Executive Officer'))
    expect(plan.toAdd).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(1)
    expect(plan.unchanged).toBe(1)

    const after = (await db.contacts.get(jane.id))!
    expect(after.position).toBe('Chief Executive Officer')
    expect(after.status).toBe('contacted')
  })
})

describe('backup', () => {
  it('round-trips through JSON', async () => {
    await importText(CSV)
    const json = JSON.stringify(await createBackup())
    await deleteAllData()
    expect(await db.contacts.count()).toBe(0)

    const res = readBackup(json)
    expect(res.ok).toBe(true)
    if (res.ok) await restoreBackup(res.backup)
    expect(await db.contacts.count()).toBe(2)
    expect(await db.imports.count()).toBe(1)
  })

  it('rejects files that are not backups', () => {
    expect(readBackup('not json').ok).toBe(false)
    expect(readBackup(JSON.stringify({ app: 'other' })).ok).toBe(false)
  })
})

describe('keyword packs and views', () => {
  it('seeds the starter packs on a new database', async () => {
    const packs = await db.keywordPacks.toArray()
    expect(packs.map((p) => p.id)).toContain('pack-microsoft-d365')
    expect(packs.every((p) => p.builtIn)).toBe(true)
  })

  it('are included in backups and kept by "delete all data"', async () => {
    await db.views.put({
      id: 'v1',
      name: 'Boston D365',
      filter: { combinator: 'and', items: [] },
      createdAt: '2026-10-15',
      updatedAt: '2026-10-15',
    })
    const backup = await createBackup()
    expect(backup.version).toBe(2)
    expect(backup.views?.map((v) => v.name)).toEqual(['Boston D365'])
    expect(backup.keywordPacks?.length).toBeGreaterThan(0)

    await deleteAllData()
    expect(await db.views.count()).toBe(1)

    await db.views.clear()
    const res = readBackup(JSON.stringify(backup))
    if (res.ok) await restoreBackup(res.backup)
    expect(await db.views.count()).toBe(1)
  })

  it('still restores version-1 backups without touching packs or views', async () => {
    const v1 = { app: 'leads-management', version: 1, exportedAt: '2026-01-01', contacts: [], imports: [] }
    const res = readBackup(JSON.stringify(v1))
    expect(res.ok).toBe(true)
    const packsBefore = await db.keywordPacks.count()
    if (res.ok) await restoreBackup(res.backup)
    expect(await db.keywordPacks.count()).toBe(packsBefore)
  })
})

describe('editing and bulk actions', () => {
  it('edits only user-owned fields, cleaning tags and empty values', async () => {
    await importText(CSV)
    const jane = (await db.contacts.where('fullName').equals('Jane Doe').first())!
    await updateContact(jane.id, {
      tags: [' Warm ', 'warm', 'Event 2026'],
      notes: '',
      location: { value: '  Boston, MA ', origin: 'manual' },
    })
    const after = (await db.contacts.get(jane.id))!
    expect(after.tags).toEqual(['Warm', 'Event 2026'])
    expect(after.notes).toBeUndefined()
    expect(after.location).toEqual({ value: 'Boston, MA', origin: 'manual' })

    await updateContact(jane.id, { location: undefined })
    expect((await db.contacts.get(jane.id))!.location).toBeUndefined()
  })

  it('applies bulk status, priority and tag changes', async () => {
    await importText(CSV)
    const ids = (await db.contacts.toArray()).map((c) => c.id)
    expect(await bulkUpdate(ids, { kind: 'status', status: 'contacted' })).toBe(2)
    await bulkUpdate(ids, { kind: 'priority', priority: 'High' })
    await bulkUpdate(ids, { kind: 'addTag', tag: 'Boston' })
    await bulkUpdate(ids, { kind: 'addTag', tag: 'boston' })
    let all = await db.contacts.toArray()
    expect(all.every((c) => c.status === 'contacted' && c.priority === 'High' && c.tags.length === 1)).toBe(true)

    await bulkUpdate(ids, { kind: 'removeTag', tag: 'BOSTON' })
    await bulkUpdate(ids, { kind: 'priority', priority: undefined })
    all = await db.contacts.toArray()
    expect(all.every((c) => c.tags.length === 0 && c.priority === undefined)).toBe(true)
  })
})
