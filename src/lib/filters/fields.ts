import { hqText } from '../company-hq'
import { technologiesText } from '../apollo/apply'
import { FUNCTIONS, PRIORITIES, SENIORITIES, SOURCES, STATUSES, type Contact } from '../schemas'
import type { FieldKey, Operator } from './schema'

export type FieldType = 'text' | 'enum' | 'list' | 'keywords' | 'pack' | 'date'

export interface FieldDef {
  key: FieldKey
  label: string
  group: 'Person' | 'Role' | 'Company' | 'Keywords' | 'Your workflow' | 'Dates'
  type: FieldType
  ops: Operator[]
  /** Fixed options for enum fields. Role/user tags take their options from the data. */
  options?: Array<{ value: string; label: string }>
  hint?: string
}

const TEXT_OPS: Operator[] = ['contains', 'not_contains', 'is', 'is_not', 'is_empty', 'is_not_empty']
const ENUM_OPS: Operator[] = ['any_of', 'none_of']
const LIST_OPS: Operator[] = ['any_of', 'none_of', 'is_empty', 'is_not_empty']

const opts = (values: readonly string[], labels: Record<string, string> = {}) =>
  values.map((v) => ({ value: v, label: labels[v] ?? v }))

export const FIELDS: FieldDef[] = [
  { key: 'fullName', label: 'Name', group: 'Person', type: 'text', ops: TEXT_OPS },
  { key: 'email', label: 'Email', group: 'Person', type: 'text', ops: TEXT_OPS },
  {
    key: 'workEmail',
    label: 'Work email',
    group: 'Person',
    type: 'text',
    ops: TEXT_OPS,
    hint: 'From “Find work email” (Apollo).',
  },
  {
    key: 'phone',
    label: 'Phone',
    group: 'Person',
    type: 'text',
    ops: ['contains', 'is_empty', 'is_not_empty'],
    hint: 'From “Find phone” (Apollo).',
  },
  {
    key: 'location',
    label: 'Location',
    group: 'Person',
    type: 'text',
    ops: TEXT_OPS,
    hint: "Where the person is. LinkedIn exports don't include it; it's typed in or imported.",
  },
  {
    key: 'anyLocation',
    label: 'Location or company HQ',
    group: 'Person',
    type: 'text',
    ops: ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
    hint: 'Matches the person’s own location or their company’s HQ and metro area — either one.',
  },
  { key: 'position', label: 'Job title', group: 'Role', type: 'text', ops: TEXT_OPS },
  {
    key: 'seniority',
    label: 'Seniority',
    group: 'Role',
    type: 'enum',
    ops: ENUM_OPS,
    options: opts(SENIORITIES, { IC: 'Individual' }),
  },
  { key: 'function', label: 'Function', group: 'Role', type: 'enum', ops: ENUM_OPS, options: opts(FUNCTIONS) },
  {
    key: 'titleTags',
    label: 'Role tags',
    group: 'Role',
    type: 'list',
    ops: LIST_OPS,
    hint: 'CEO, CIO, IT Director… detected from the job title',
  },
  { key: 'company', label: 'Company', group: 'Company', type: 'text', ops: TEXT_OPS },
  {
    key: 'website',
    label: 'Company website',
    group: 'Company',
    type: 'text',
    ops: TEXT_OPS,
    hint: 'From “Company data” imports or typed in the lead panel.',
  },
  {
    key: 'companyHq',
    label: 'Company HQ',
    group: 'Company',
    type: 'text',
    ops: TEXT_OPS,
    hint: 'Company headquarters and metro area, e.g. “Greater Boston”. From “Find company HQ” or typed in.',
  },
  {
    key: 'technologies',
    label: 'Company technologies',
    group: 'Company',
    type: 'keywords',
    ops: ['has_any_word', 'has_no_word'],
    hint: 'Software the company uses (Apollo), e.g. Dynamics 365, Salesforce, Azure.',
  },
  { key: 'industry', label: 'Industry', group: 'Company', type: 'text', ops: TEXT_OPS },
  { key: 'companySize', label: 'Company size', group: 'Company', type: 'text', ops: TEXT_OPS },
  {
    key: 'keywords',
    label: 'Keywords',
    group: 'Keywords',
    type: 'keywords',
    ops: ['has_any_word', 'has_no_word'],
    hint: 'Whole-word match in job title and company',
  },
  {
    key: 'keywordPack',
    label: 'Keyword pack',
    group: 'Keywords',
    type: 'pack',
    ops: ['matches_pack', 'not_matches_pack'],
    hint: 'A saved list of keywords, e.g. Microsoft Dynamics',
  },
  {
    key: 'status',
    label: 'Status',
    group: 'Your workflow',
    type: 'enum',
    ops: ENUM_OPS,
    options: opts(STATUSES, { new: 'New', shortlisted: 'Shortlisted', contacted: 'Contacted', not_a_fit: 'Not a fit' }),
  },
  {
    key: 'priority',
    label: 'Priority',
    group: 'Your workflow',
    type: 'enum',
    ops: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
    options: opts(PRIORITIES),
  },
  {
    key: 'aiPriority',
    label: 'AI priority',
    group: 'Your workflow',
    type: 'enum',
    ops: ['any_of', 'none_of', 'is_empty', 'is_not_empty'],
    options: opts(PRIORITIES),
    hint: 'From the latest “Score with AI” run. People scored 0 (no fit) are left out. Empty means not scored yet.',
  },
  { key: 'tags', label: 'Your tags', group: 'Your workflow', type: 'list', ops: LIST_OPS },
  {
    key: 'source',
    label: 'Source',
    group: 'Your workflow',
    type: 'enum',
    ops: ENUM_OPS,
    options: opts(SOURCES, {
      linkedin_export: 'LinkedIn export',
      manual: 'Added by hand',
      sales_nav: 'Sales Navigator',
      sample: 'Sample data',
    }),
  },
  {
    key: 'connectedOn',
    label: 'Connected on',
    group: 'Dates',
    type: 'date',
    ops: ['within_last', 'before', 'after', 'is_empty', 'is_not_empty'],
  },
]

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<FieldKey, FieldDef>

export const OP_LABEL: Record<Operator, string> = {
  contains: 'contains',
  not_contains: "doesn't contain",
  is: 'is',
  is_not: 'is not',
  any_of: 'is any of',
  none_of: 'is none of',
  has_any_word: 'has any of',
  has_no_word: 'has none of',
  matches_pack: 'matches',
  not_matches_pack: "doesn't match",
  before: 'is before',
  after: 'is after',
  within_last: 'is within the last',
  is_empty: 'is unknown',
  is_not_empty: 'is known',
}

export const NO_VALUE_OPS: Operator[] = ['is_empty', 'is_not_empty']

/** Field value used for matching; keyword fields search title and company together. */
export function fieldText(c: Contact, key: FieldKey): string | undefined {
  switch (key) {
    case 'fullName':
      return c.fullName
    case 'email':
      return c.email
    case 'location':
      return c.location?.value
    case 'companyHq':
      return hqText(c.companyHq)
    case 'workEmail':
      return c.apollo?.email
    case 'phone':
      return c.phone?.numbers?.map((n) => n.number).join('\n')
    case 'technologies':
      return technologiesText(c)
    case 'anyLocation':
      return [c.location?.value, hqText(c.companyHq)].filter(Boolean).join('\n') || undefined
    case 'position':
      return c.position
    case 'company':
      return c.company
    case 'website':
      return c.enrichment?.website
    case 'industry':
      return c.enrichment?.industry
    case 'companySize':
      return c.enrichment?.companySize
    case 'keywords':
    case 'keywordPack':
      return [c.position, c.company].filter(Boolean).join('\n')
    default:
      return undefined
  }
}
