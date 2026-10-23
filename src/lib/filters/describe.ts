import { FIELD_BY_KEY, NO_VALUE_OPS, OP_LABEL } from './fields'
import type { Condition, FilterGroup, KeywordPack } from './schema'

export interface ConditionLabel {
  field: string
  op: string
  value?: string
}

function list(values: string[], labelOf: (v: string) => string) {
  const shown = values.slice(0, 3).map(labelOf).join(', ')
  return values.length > 3 ? `${shown} +${values.length - 3}` : shown
}

/** Chip text, e.g. "Seniority" "is any of" "C-level, VP". */
export function describeCondition(cond: Condition, packs: Map<string, KeywordPack>): ConditionLabel {
  const field = FIELD_BY_KEY[cond.field]
  const op = OP_LABEL[cond.op]
  if (NO_VALUE_OPS.includes(cond.op)) return { field: field.label, op }

  if (cond.op === 'within_last' && typeof cond.value === 'number') {
    const v = cond.value
    const text = v % 12 === 0 ? `${v / 12} ${v === 12 ? 'year' : 'years'}` : `${v} ${v === 1 ? 'month' : 'months'}`
    return { field: field.label, op, value: text }
  }
  if (field.type === 'pack') {
    const pack = typeof cond.value === 'string' ? packs.get(cond.value) : undefined
    return { field: field.label, op, value: pack?.name ?? (cond.value ? 'a deleted pack' : undefined) }
  }
  if (field.type === 'date' && typeof cond.value === 'string' && cond.value) {
    return { field: field.label, op, value: cond.value }
  }
  if (Array.isArray(cond.value) && cond.value.length) {
    const labelOf = (v: string) => field.options?.find((o) => o.value === v)?.label ?? v
    return { field: field.label, op, value: list(cond.value, labelOf) }
  }
  if (typeof cond.value === 'string' && cond.value.trim()) {
    return { field: field.label, op, value: `“${cond.value.trim()}”` }
  }
  return { field: field.label, op }
}

const sentence = (l: ConditionLabel) => [l.field, l.op, l.value].filter(Boolean).join(' ')

/** One line per top-level item, e.g. for the "About this export" sheet. */
export function describeFilter(filter: FilterGroup, packs: Map<string, KeywordPack>): string[] {
  const join = filter.combinator === 'and' ? 'AND' : 'OR'
  return filter.items.map((item, i) => {
    const text =
      item.kind === 'group'
        ? `(${item.conditions.map((c) => sentence(describeCondition(c, packs))).join(item.combinator === 'and' ? ' AND ' : ' OR ')})`
        : sentence(describeCondition(item, packs))
    return i === 0 ? text : `${join} ${text}`
  })
}
