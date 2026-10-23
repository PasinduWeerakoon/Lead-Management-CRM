import { keywordRegex } from './filters/engine'
import type { Contact } from './schemas'

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Builds a fast matcher for many keywords: one compiled pattern, run once per person, returning the
 * keywords (as written in your packs) found as whole words in the job title or company.
 */
export function keywordMatcher(terms: string[]): (c: Contact) => string[] {
  const unique = [...new Map(terms.filter((t) => t.trim()).map((t) => [norm(t), t.trim()])).values()]
  const base = keywordRegex(unique)
  if (!base) return () => []
  const re = new RegExp(base.source, 'giu')
  const canonical = new Map(unique.map((t) => [norm(t), t]))

  return (c) => {
    const text = [c.position, c.company].filter(Boolean).join('\n')
    if (!text) return []
    const found: string[] = []
    for (const m of text.matchAll(re)) {
      const term = canonical.get(norm(m[0]))
      if (term && !found.includes(term)) found.push(term)
    }
    return found
  }
}

/** Matched keywords for every person, computed once per keyword set. */
export function keywordIndex(contacts: Contact[], terms: string[]): Map<string, string[]> {
  const match = keywordMatcher(terms)
  const index = new Map<string, string[]>()
  for (const c of contacts) {
    const hits = match(c)
    if (hits.length) index.set(c.id, hits)
  }
  return index
}
