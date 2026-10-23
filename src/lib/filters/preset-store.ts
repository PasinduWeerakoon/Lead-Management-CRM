import { db } from '../db'
import { builtInPresetRecords } from './presets'
import type { FilterGroup, SavedPreset } from './schema'

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)

export async function createPreset(name: string, description: string, filter: FilterGroup): Promise<SavedPreset> {
  const now = new Date().toISOString()
  const preset: SavedPreset = {
    id: crypto.randomUUID(),
    name: clean(name, 80) || 'Untitled preset',
    description: clean(description, 200) || undefined,
    filter: structuredClone(filter),
    createdAt: now,
    updatedAt: now,
  }
  await db.presets.add(preset)
  return preset
}

export async function updatePreset(
  id: string,
  patch: Partial<Pick<SavedPreset, 'name' | 'description' | 'filter'>>,
): Promise<void> {
  const next: Partial<SavedPreset> = { updatedAt: new Date().toISOString() }
  if (patch.name !== undefined) next.name = clean(patch.name, 80) || 'Untitled preset'
  if (patch.description !== undefined) next.description = clean(patch.description, 200) || undefined
  if (patch.filter) next.filter = structuredClone(patch.filter)
  await db.presets.update(id, next)
}

export async function deletePreset(id: string): Promise<void> {
  await db.presets.delete(id)
}

/** Brings back any deleted built-in presets and resets edited ones. Your own presets are untouched. */
export async function restoreBuiltInPresets(): Promise<number> {
  const records = builtInPresetRecords(new Date().toISOString())
  await db.presets.bulkPut(records)
  return records.length
}

/** Your presets first (newest first), then the built-ins in their original order. */
export function sortPresets(list: SavedPreset[]): SavedPreset[] {
  const own = list.filter((p) => !p.builtIn).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const builtIn = list.filter((p) => p.builtIn).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return [...own, ...builtIn]
}
