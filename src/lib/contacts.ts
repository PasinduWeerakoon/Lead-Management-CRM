import { db } from './db'
import type { Contact, LeadStatus, Priority } from './schemas'

/** Fields the user owns. LinkedIn data (name, title, company…) only changes through import. */
export type ContactEdit = Partial<Pick<Contact, 'status' | 'priority' | 'tags' | 'notes' | 'location'>>

const MAX_TAGS = 50
const MAX_NOTES = 10_000

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out.slice(0, MAX_TAGS)
}

export async function updateContact(id: string, edit: ContactEdit): Promise<void> {
  const patch: Partial<Contact> = { ...edit, updatedAt: new Date().toISOString() }
  if (edit.tags) patch.tags = cleanTags(edit.tags)
  if (edit.notes !== undefined) patch.notes = edit.notes.slice(0, MAX_NOTES) || undefined
  if ('location' in edit) {
    const value = edit.location?.value.trim().slice(0, 200)
    patch.location = value ? { value, origin: 'manual' } : undefined
  }
  await db.contacts.update(id, patch)
}

export type BulkAction =
  | { kind: 'status'; status: LeadStatus }
  | { kind: 'priority'; priority: Priority | undefined }
  | { kind: 'addTag'; tag: string }
  | { kind: 'removeTag'; tag: string }
  /** Copies the AI's suggested priority into your own priority (people without a score are left alone). */
  | { kind: 'aiPriority' }

/** Applies one change to many contacts in a single transaction. Returns how many changed. */
export async function bulkUpdate(ids: string[], action: BulkAction): Promise<number> {
  const now = new Date().toISOString()
  return db.contacts
    .where('id')
    .anyOf(ids)
    .modify((c) => {
      switch (action.kind) {
        case 'status':
          c.status = action.status
          break
        case 'priority':
          if (action.priority) c.priority = action.priority
          else delete c.priority
          break
        case 'addTag':
          c.tags = cleanTags([...c.tags, action.tag])
          break
        case 'removeTag':
          c.tags = c.tags.filter((t) => t.toLowerCase() !== action.tag.toLowerCase())
          break
        case 'aiPriority':
          if (c.ai) c.priority = c.ai.priority
          break
      }
      c.updatedAt = now
    })
}
