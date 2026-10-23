import { db } from '../../lib/db'
import type { FilterGroup, SavedView } from '../../lib/filters/schema'

export async function createView(name: string, filter: FilterGroup): Promise<SavedView> {
  const now = new Date().toISOString()
  const view: SavedView = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 80),
    filter: structuredClone(filter),
    createdAt: now,
    updatedAt: now,
  }
  await db.views.add(view)
  return view
}

export async function updateView(id: string, patch: Partial<Pick<SavedView, 'name' | 'filter'>>) {
  await db.views.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteView(id: string) {
  await db.views.delete(id)
}
