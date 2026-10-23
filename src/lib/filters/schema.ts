import { z } from 'zod'

export const OPERATORS = [
  'contains',
  'not_contains',
  'is',
  'is_not',
  'any_of',
  'none_of',
  'has_any_word',
  'has_no_word',
  'matches_pack',
  'not_matches_pack',
  'before',
  'after',
  'within_last',
  'is_empty',
  'is_not_empty',
] as const
export type Operator = (typeof OPERATORS)[number]

export const FIELD_KEYS = [
  'fullName',
  'position',
  'company',
  'website',
  'industry',
  'companySize',
  'email',
  'location',
  'companyHq',
  'anyLocation',
  'workEmail',
  'phone',
  'technologies',
  'keywords',
  'keywordPack',
  'seniority',
  'function',
  'titleTags',
  'status',
  'priority',
  'aiPriority',
  'tags',
  'source',
  'connectedOn',
] as const
export type FieldKey = (typeof FIELD_KEYS)[number]

export const ConditionSchema = z.object({
  id: z.string(),
  kind: z.literal('condition'),
  field: z.enum(FIELD_KEYS),
  op: z.enum(OPERATORS),
  /** string for text/date/pack, string[] for lists, number (months) for "within last". */
  value: z.union([z.string().max(500), z.array(z.string().max(200)).max(200), z.number()]).optional(),
})
export type Condition = z.infer<typeof ConditionSchema>

export const CombinatorSchema = z.enum(['and', 'or'])
export type Combinator = z.infer<typeof CombinatorSchema>

export const SubGroupSchema = z.object({
  id: z.string(),
  kind: z.literal('group'),
  combinator: CombinatorSchema,
  conditions: z.array(ConditionSchema).max(50),
})
export type SubGroup = z.infer<typeof SubGroupSchema>

/** One level of nesting keeps the builder understandable: root → conditions and groups of conditions. */
export const FilterGroupSchema = z.object({
  combinator: CombinatorSchema,
  items: z.array(z.union([ConditionSchema, SubGroupSchema])).max(50),
})
export type FilterGroup = z.infer<typeof FilterGroupSchema>

export const emptyFilter = (): FilterGroup => ({ combinator: 'and', items: [] })

export const KeywordPackSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  keywords: z.array(z.string().min(1).max(80)).max(300),
  builtIn: z.boolean().optional(),
  updatedAt: z.string(),
})
export type KeywordPack = z.infer<typeof KeywordPackSchema>

export const SavedViewSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  filter: FilterGroupSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type SavedView = z.infer<typeof SavedViewSchema>

/** A reusable filter starting point. Built-ins are seeded on first run and are editable like your own. */
export const SavedPresetSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  filter: FilterGroupSchema,
  /** Key of the built-in preset this came from, so "Restore built-in presets" can reset it. */
  builtIn: z.string().max(40).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type SavedPreset = z.infer<typeof SavedPresetSchema>
