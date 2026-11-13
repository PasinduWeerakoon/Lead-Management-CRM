/**
 * One-off: rebuilds work history for people found by the Brave batch from the text already saved
 * (no new searches). Drops entries where a place or school was taken for a job.
 *
 *   DATA_TABLE=leadsapp-data AWS_REGION=ap-south-1 npx tsx scripts/fix-brave-career.mts [--dry]
 */
import { getStore, type StoredRecord } from '../api/_store.ts'
import { careerFromText, validEmployer } from './career-from-snippets.mts'

type Obj = Record<string, any>
const dry = process.argv.includes('--dry')
const store = (await getStore())!
let changed = 0
let withJobs = 0
for (const profile of await store.listProfiles()) {
  const people: StoredRecord[] = []
  for (let after = 0; ;) {
    const { records, more } = await store.changes(profile.id, 'contacts', after, 1000)
    people.push(...records.filter((r) => !r.deleted && r.data))
    if (!more || !records.length) break
    after = records[records.length - 1].srv
  }
  const writes = []
  for (const r of people) {
    const c = r.data as Obj
    const w = c.web
    if (w?.model !== 'brave' || w.status !== 'found') continue
    const kept = (w.career ?? []).filter((j: Obj) => validEmployer(j.company, j.role))
    const found = careerFromText(w.summary ?? '', w.sources?.[0] ?? '', c)
    const career = [...found]
    for (const j of kept)
      if (!career.some((x) => x.company.toLowerCase() === String(j.company).toLowerCase())) career.push(j)
    if (career.length) withJobs++
    if (JSON.stringify(career) === JSON.stringify(w.career ?? [])) continue
    changed++
    const { career: _old, ...rest } = w
    void _old
    writes.push({ id: r.id, data: { ...c, web: career.length ? { ...rest, career: career.slice(0, 10) } : rest } })
  }
  if (!dry)
    for (let i = 0; i < writes.length; i += 25) await store.write(profile.id, 'contacts', writes.slice(i, i + 25))
}
console.log({ changed, withJobs, dry })
