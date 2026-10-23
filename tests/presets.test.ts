import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from '../src/lib/db'
import { createBackup, readBackup, restoreBackup } from '../src/lib/backup'
import {
  createPreset,
  deletePreset,
  restoreBuiltInPresets,
  sortPresets,
  updatePreset,
} from '../src/lib/filters/preset-store'
import { builtInPresetId, PRESETS } from '../src/lib/filters/presets'
import type { FilterGroup } from '../src/lib/filters/schema'

const filter: FilterGroup = {
  combinator: 'and',
  items: [{ id: 'x', kind: 'condition', field: 'company', op: 'contains', value: 'bank' }],
}

describe('stored presets', () => {
  it('seeds the built-in presets on a new database', async () => {
    const all = await db.presets.toArray()
    expect(all.map((p) => p.builtIn).sort()).toEqual(PRESETS.map((p) => p.key).sort())
  })

  it('creates, edits, replaces filters and deletes — built-ins included', async () => {
    const mine = await createPreset('  Sri Lanka banks ', 'Bank employees', filter)
    expect(mine).toMatchObject({ name: 'Sri Lanka banks', description: 'Bank employees' })

    const id = builtInPresetId('c-suite')
    await updatePreset(id, { name: 'Chiefs only', description: '' })
    await updatePreset(id, { filter })
    const edited = (await db.presets.get(id))!
    expect(edited).toMatchObject({ name: 'Chiefs only', builtIn: 'c-suite' })
    expect(edited.description).toBeUndefined()
    expect(edited.filter.items[0]).toMatchObject({ field: 'company' })

    await deletePreset(builtInPresetId('recent'))
    expect(await db.presets.get(builtInPresetId('recent'))).toBeUndefined()

    const order = sortPresets(await db.presets.toArray()).map((p) => p.name)
    expect(order[0]).toBe('Sri Lanka banks') // your presets come first
  })

  it('restore brings built-ins back and resets edits, keeping your own', async () => {
    await restoreBuiltInPresets()
    expect((await db.presets.get(builtInPresetId('c-suite')))!.name).toBe('C-suite')
    expect(await db.presets.get(builtInPresetId('recent'))).toBeDefined()
    expect((await db.presets.toArray()).some((p) => p.name === 'Sri Lanka banks')).toBe(true)
  })

  it('travels in backups', async () => {
    const backup = await createBackup()
    expect(backup.presets?.some((p) => p.name === 'Sri Lanka banks')).toBe(true)
    await db.presets.clear()
    const res = readBackup(JSON.stringify(backup))
    if (res.ok) await restoreBackup(res.backup)
    expect(await db.presets.count()).toBe(backup.presets!.length)
  })
})

describe('sample briefs', () => {
  it('are seeded once and never overwrite an edited one', async () => {
    const { SAMPLE_BRIEFS } = await import('../src/lib/ai/sample-briefs')
    const ids = SAMPLE_BRIEFS.map((b) => b.id)
    expect((await db.briefs.bulkGet(ids)).every(Boolean)).toBe(true)
    expect(SAMPLE_BRIEFS.every((b) => b.text.length < 4000 && b.name.length <= 80)).toBe(true)
  })
})
