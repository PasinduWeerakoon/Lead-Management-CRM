import type { Contact } from '../schemas'
import { FIELD_BY_KEY, NO_VALUE_OPS, fieldText } from './fields'
import type { Condition, FilterGroup, KeywordPack, SubGroup } from './schema'

export interface FilterContext {
  packs: Map<string, KeywordPack>
  /** Injected so tests are deterministic. */
  today?: Date
}

type Predicate = (c: Contact) => boolean

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * One regex for a list of terms, matched as whole words: "CTO" won't hit "Director",
 * "Power BI" matches across any whitespace, and symbols like "F&O" or "C#" still work.
 */
export function keywordRegex(terms: string[]): RegExp | undefined {
  const parts = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // longest first, so highlights prefer "Dynamics 365" over "Dynamics"
    .map((t) => escapeRe(t).replace(/\s+/g, '\\s+'))
  if (parts.length === 0) return undefined
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
}

const asList = (v: Condition['value']) => (Array.isArray(v) ? v.filter((s) => s.trim()) : [])
const asText = (v: Condition['value']) => (typeof v === 'string' ? v.trim() : '')

/** A condition the user hasn't finished (no value yet) is ignored rather than hiding everyone. */
export function isComplete(cond: Condition, ctx?: FilterContext): boolean {
  if (NO_VALUE_OPS.includes(cond.op)) return true
  if (cond.op === 'within_last') return typeof cond.value === 'number' && cond.value > 0
  if (cond.op === 'matches_pack' || cond.op === 'not_matches_pack') {
    const pack = ctx?.packs.get(asText(cond.value))
    return ctx ? !!pack && pack.keywords.length > 0 : asText(cond.value) !== ''
  }
  if (Array.isArray(cond.value)) return asList(cond.value).length > 0
  return asText(cond.value) !== ''
}

function monthsAgoIso(today: Date, months: number): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()))
  return d.toISOString().slice(0, 10)
}

function compileCondition(cond: Condition, ctx: FilterContext): Predicate | undefined {
  if (!isComplete(cond, ctx)) return undefined
  const field = FIELD_BY_KEY[cond.field]

  if (field.type === 'enum') {
    const get = (c: Contact): string | undefined =>
      cond.field === 'aiPriority'
        ? c.ai?.priority
        : c[cond.field as 'seniority' | 'function' | 'status' | 'source' | 'priority']
    if (cond.op === 'is_empty') return (c) => !get(c)
    if (cond.op === 'is_not_empty') return (c) => !!get(c)
    const set = new Set(asList(cond.value))
    if (cond.field === 'aiPriority' && cond.op === 'any_of')
      // A score of 0 means "no fit at all", so it never shows up in AI priority results.
      return (c) => !!c.ai && c.ai.score > 0 && set.has(c.ai.priority)
    return cond.op === 'none_of' ? (c) => !set.has(get(c) ?? '') : (c) => set.has(get(c) ?? '')
  }

  if (field.type === 'list') {
    const get = (c: Contact) => (cond.field === 'titleTags' ? c.titleTags : c.tags)
    if (cond.op === 'is_empty') return (c) => get(c).length === 0
    if (cond.op === 'is_not_empty') return (c) => get(c).length > 0
    const set = new Set(asList(cond.value).map((s) => s.toLowerCase()))
    const hit = (c: Contact) => get(c).some((t) => set.has(t.toLowerCase()))
    return cond.op === 'none_of' ? (c) => !hit(c) : hit
  }

  if (field.type === 'date') {
    if (cond.op === 'is_empty') return (c) => !c.connectedOn
    if (cond.op === 'is_not_empty') return (c) => !!c.connectedOn
    if (cond.op === 'within_last') {
      const from = monthsAgoIso(ctx.today ?? new Date(), cond.value as number)
      return (c) => !!c.connectedOn && c.connectedOn >= from
    }
    const date = asText(cond.value).slice(0, 10)
    if (cond.op === 'before') return (c) => !!c.connectedOn && c.connectedOn < date
    return (c) => !!c.connectedOn && c.connectedOn > date
  }

  if (field.type === 'keywords' || field.type === 'pack') {
    const terms = field.type === 'pack' ? ctx.packs.get(asText(cond.value))!.keywords : asList(cond.value)
    const re = keywordRegex(terms)
    if (!re) return undefined
    const hit = (c: Contact) => re.test(fieldText(c, cond.field) ?? '')
    return cond.op === 'has_no_word' || cond.op === 'not_matches_pack' ? (c) => !hit(c) : hit
  }

  // text
  const get = (c: Contact) => (fieldText(c, cond.field) ?? '').toLowerCase()
  if (cond.op === 'is_empty') return (c) => get(c).trim() === ''
  if (cond.op === 'is_not_empty') return (c) => get(c).trim() !== ''
  const needle = asText(cond.value).toLowerCase()
  switch (cond.op) {
    case 'contains':
      return (c) => get(c).includes(needle)
    case 'not_contains':
      return (c) => !get(c).includes(needle)
    case 'is':
      return (c) => get(c).trim() === needle
    case 'is_not':
      return (c) => get(c).trim() !== needle
    default:
      return undefined
  }
}

function combine(preds: Predicate[], combinator: 'and' | 'or'): Predicate | undefined {
  if (preds.length === 0) return undefined
  if (preds.length === 1) return preds[0]
  return combinator === 'and' ? (c) => preds.every((p) => p(c)) : (c) => preds.some((p) => p(c))
}

function compileGroup(g: SubGroup, ctx: FilterContext): Predicate | undefined {
  return combine(
    g.conditions.map((c) => compileCondition(c, ctx)).filter((p): p is Predicate => !!p),
    g.combinator,
  )
}

/** Compiles once, then runs fast per contact. Returns undefined when nothing would filter. */
export function compileFilter(filter: FilterGroup, ctx: FilterContext): Predicate | undefined {
  const preds = filter.items
    .map((item) => (item.kind === 'group' ? compileGroup(item, ctx) : compileCondition(item, ctx)))
    .filter((p): p is Predicate => !!p)
  return combine(preds, filter.combinator)
}

export function countConditions(filter: FilterGroup): number {
  return filter.items.reduce((n, i) => n + (i.kind === 'group' ? i.conditions.length : 1), 0)
}

/** Keywords (word matches) and substrings the filter positively looks for. Negative conditions are skipped. */
export function positiveTerms(filter: FilterGroup, ctx: FilterContext): { words: string[]; substrings: string[] } {
  const words: string[] = []
  const substrings: string[] = []
  const visit = (c: Condition) => {
    if (!isComplete(c, ctx)) return
    if (c.op === 'has_any_word') words.push(...asList(c.value))
    if (c.op === 'matches_pack') words.push(...(ctx.packs.get(asText(c.value))?.keywords ?? []))
    if (c.op === 'contains' && (c.field === 'position' || c.field === 'company')) substrings.push(asText(c.value))
  }
  for (const item of filter.items) {
    if (item.kind === 'group') item.conditions.forEach(visit)
    else visit(item)
  }
  return { words: [...new Set(words)], substrings: [...new Set(substrings)] }
}

/**
 * One regex for everything the filter positively looks for, so the grid can highlight why a row matched.
 * Keyword and pack terms match whole words; "contains" on title/company matches anywhere, as it filters.
 */
export function highlightRegex(filter: FilterGroup, ctx: FilterContext): RegExp | undefined {
  const { words, substrings } = positiveTerms(filter, ctx)
  const wordRe = keywordRegex(words)
  const subParts = [...substrings].sort((a, b) => b.length - a.length).map(escapeRe)
  const parts = [wordRe?.source, ...subParts].filter(Boolean)
  return parts.length ? new RegExp(parts.join('|'), 'iu') : undefined
}
