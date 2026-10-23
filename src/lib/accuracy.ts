import { companyTechnologies } from './apollo/apply'
import { db } from './db'
import type { Contact } from './schemas'

/**
 * Accuracy: you mark what the system decided as right (✓) or wrong (✗); these numbers come only from
 * your marks. A mark stores the value you judged, so it stops counting when that value changes.
 */

export interface CheckField {
  key: string
  label: string
  /** The value being judged, as shown to you; undefined = nothing to check. */
  value: (c: Contact) => string | undefined
  /** Where the value came from, to compare sources (e.g. HQ from Website vs AI). */
  source?: (c: Contact) => string
}

const seniorityLabel = (s: Contact['seniority']) => (s === 'IC' ? 'Individual' : s)

export const CHECK_FIELDS: CheckField[] = [
  { key: 'seniority', label: 'Seniority', value: (c) => (c.position ? seniorityLabel(c.seniority) : undefined) },
  { key: 'function', label: 'Function', value: (c) => (c.position ? c.function : undefined) },
  { key: 'roleTags', label: 'Role tags', value: (c) => (c.titleTags.length ? c.titleTags.join(', ') : undefined) },
  {
    key: 'website',
    label: 'Company website',
    value: (c) => c.enrichment?.website?.replace(/^https?:\/\/(www\.)?/, ''),
    source: (c) =>
      c.research?.domain && c.enrichment?.website?.includes(c.research.domain)
        ? 'Website research'
        : (c.enrichment?.source ?? 'Unknown'),
  },
  {
    key: 'companyHq',
    label: 'Company HQ',
    value: (c) => (c.companyHq?.status === 'found' ? c.companyHq.value : undefined),
    source: (c) =>
      ({
        ai: 'AI guess',
        manual: 'Typed',
        import: 'Imported',
        provider: c.companyHq?.source ?? 'Provider',
        web: 'Website',
      })[c.companyHq?.origin ?? 'ai'],
  },
  { key: 'industry', label: 'Industry', value: (c) => c.enrichment?.industry },
  {
    key: 'technologies',
    label: 'Technologies',
    value: (c) => {
      const t = companyTechnologies(c)
      return t.length ? t.slice(0, 8).join(', ') : undefined
    },
  },
  {
    key: 'hiring',
    label: 'Hiring signals',
    value: (c) =>
      c.research?.hiring?.length
        ? c.research.hiring
            .map((h) => h.title)
            .slice(0, 5)
            .join('; ')
        : undefined,
  },
  {
    key: 'aiScore',
    label: 'AI score (fit)',
    value: (c) => (c.ai ? `${c.ai.score} · ${c.ai.priority} · ${c.ai.briefName}` : undefined),
    source: (c) => c.ai?.model ?? 'Unknown',
  },
]

export const FIELD = Object.fromEntries(CHECK_FIELDS.map((f) => [f.key, f])) as Record<string, CheckField>

/** The person's mark for a field, only if it still matches the current value. */
export function currentMark(c: Contact, key: string): boolean | undefined {
  const mark = c.feedback?.[key]
  const value = FIELD[key]?.value(c)
  return mark && value !== undefined && mark.value === value.slice(0, 300) ? mark.ok : undefined
}

/** Sets ✓ (true), ✗ (false) or clears (undefined) a mark on one person. */
export async function setMark(id: string, key: string, ok: boolean | undefined): Promise<void> {
  const c = await db.contacts.get(id)
  if (!c) return
  const value = FIELD[key]?.value(c)
  const feedback = { ...c.feedback }
  if (ok === undefined || value === undefined) delete feedback[key]
  else feedback[key] = { ok, value: value.slice(0, 300), at: new Date().toISOString() }
  await db.contacts.update(id, { feedback: Object.keys(feedback).length ? feedback : undefined })
}

export interface FieldStats {
  key: string
  label: string
  /** People who have a value for this field. */
  withValue: number
  checked: number
  correct: number
  /** Correct ÷ checked, or undefined before any checks. */
  accuracy?: number
  bySource: Array<{ source: string; checked: number; correct: number; accuracy: number }>
  wrong: Array<{ id: string; name: string; value: string }>
}

export function accuracyStats(contacts: Contact[]): FieldStats[] {
  return CHECK_FIELDS.map((f) => {
    let withValue = 0
    let checked = 0
    let correct = 0
    const sources = new Map<string, { checked: number; correct: number }>()
    const wrong: FieldStats['wrong'] = []
    for (const c of contacts) {
      const value = f.value(c)
      if (value === undefined) continue
      withValue++
      const ok = currentMark(c, f.key)
      if (ok === undefined) continue
      checked++
      if (ok) correct++
      else wrong.push({ id: c.id, name: c.fullName, value })
      if (f.source) {
        const s = f.source(c)
        const row = sources.get(s) ?? { checked: 0, correct: 0 }
        row.checked++
        if (ok) row.correct++
        sources.set(s, row)
      }
    }
    return {
      key: f.key,
      label: f.label,
      withValue,
      checked,
      correct,
      accuracy: checked ? correct / checked : undefined,
      bySource: [...sources]
        .map(([source, r]) => ({ source, ...r, accuracy: r.correct / r.checked }))
        .sort((a, b) => b.checked - a.checked),
      wrong: wrong.slice(0, 50),
    }
  })
}

/**
 * People to check next: the ones with the most values you haven't judged yet, spread across the list
 * (a fixed stride rather than the top rows, so results aren't biased toward one company or name).
 */
export function pickToCheck(contacts: Contact[], n = 10, seed = Date.now()): Contact[] {
  const unchecked = contacts.filter((c) =>
    CHECK_FIELDS.some((f) => f.value(c) !== undefined && currentMark(c, f.key) === undefined),
  )
  if (unchecked.length <= n) return unchecked
  const picked: Contact[] = []
  const start = seed % unchecked.length
  const step = Math.max(1, Math.floor(unchecked.length / n))
  for (let i = 0; picked.length < n && i < unchecked.length; i++)
    picked.push(unchecked[(start + i * step) % unchecked.length])
  return [...new Set(picked)]
}
