import { db } from './db'
import type { ColumnMapping, ParsedTable } from './csv'
import { mergeContact, rowToContact, sameSourceData } from './normalize'
import type { Contact, ContactSource, ImportRecord } from './schemas'

export interface SkippedRow {
  /** 1-based data row, counting from the first row after the header. */
  row: number
  reason: string
}

export interface ImportPlan {
  toAdd: Contact[]
  toUpdate: Contact[]
  unchanged: number
  duplicatesInFile: number
  skipped: SkippedRow[]
}

/** Works out what an import would do, without writing anything. */
export async function planImport(
  table: ParsedTable,
  mapping: ColumnMapping,
  source: ContactSource,
  now = new Date().toISOString(),
): Promise<ImportPlan> {
  const byId = new Map<string, Contact>()
  const skipped: SkippedRow[] = []
  let duplicatesInFile = 0

  table.rows.forEach((row, i) => {
    const res = rowToContact(row, mapping, source, now)
    if (!res.ok) {
      skipped.push({ row: i + 1, reason: res.reason })
      return
    }
    if (byId.has(res.contact.id)) duplicatesInFile++
    byId.set(res.contact.id, res.contact)
  })

  const incoming = [...byId.values()]
  const existing = await db.contacts.bulkGet(incoming.map((c) => c.id))

  const toAdd: Contact[] = []
  const toUpdate: Contact[] = []
  let unchanged = 0
  incoming.forEach((c, i) => {
    const prev = existing[i]
    if (!prev) toAdd.push(c)
    else if (sameSourceData(prev, c)) unchanged++
    else toUpdate.push(mergeContact(prev, c))
  })

  return { toAdd, toUpdate, unchanged, duplicatesInFile, skipped }
}

export async function commitImport(plan: ImportPlan, fileName: string): Promise<ImportRecord> {
  const record: ImportRecord = {
    id: crypto.randomUUID(),
    fileName: fileName.slice(0, 300),
    at: new Date().toISOString(),
    added: plan.toAdd.length,
    updated: plan.toUpdate.length,
    skipped: plan.skipped.length,
  }
  await db.transaction('rw', db.contacts, db.imports, async () => {
    await db.contacts.bulkPut([...plan.toAdd, ...plan.toUpdate])
    await db.imports.add(record)
  })
  return record
}
