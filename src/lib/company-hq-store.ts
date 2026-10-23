import { companyKeys, rank, type CompanyHq } from './company-hq'
import { db } from './db'
import type { Contact } from './schemas'

/** Saves an HQ for these people. An AI answer never overwrites one you typed or imported. */
export async function saveHq(ids: string[], hq: CompanyHq): Promise<void> {
  if (!ids.length) return
  await db.contacts
    .where('id')
    .anyOf(ids)
    .modify((c) => {
      // Never replace a better-sourced HQ (typed > imported > provider > AI).
      if (c.companyHq && rank(c.companyHq) > rank(hq)) return
      c.companyHq = hq
    })
}

/**
 * Sets (or clears) the HQ you typed for a person, and for everyone at the same company.
 * Returns how many people were updated.
 */
export async function setManualHq(contact: Contact, value: string): Promise<number> {
  const text = value.trim().slice(0, 200)
  const all = companyKeys(contact).length ? await db.contacts.toArray() : [contact]
  const keys = new Set(companyKeys(contact))
  const ids = all.filter((c) => c.id === contact.id || companyKeys(c).some((k) => keys.has(k))).map((c) => c.id)
  await db.contacts
    .where('id')
    .anyOf(ids)
    .modify((c) => {
      if (text) c.companyHq = { status: 'found', value: text, origin: 'manual', at: new Date().toISOString() }
      else delete c.companyHq
    })
  return ids.length
}

/** Removes AI answers (found or unknown) for these people before they're looked up again. HQs you typed stay. */
export async function clearAiHq(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.contacts
    .where('id')
    .anyOf(ids)
    .modify((c) => {
      if (c.companyHq?.origin === 'ai') delete c.companyHq
    })
}
