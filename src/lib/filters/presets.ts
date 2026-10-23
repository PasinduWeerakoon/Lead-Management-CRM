import type { Condition, FilterGroup, SavedPreset } from './schema'

export const BUILT_IN_PACK_IDS = {
  microsoft: 'pack-microsoft-d365',
  erpCrm: 'pack-erp-crm',
  digital: 'pack-digital-transformation',
  cloudData: 'pack-cloud-data',
} as const

export const BUILT_IN_PACKS: Array<{ id: string; name: string; keywords: string[] }> = [
  {
    id: BUILT_IN_PACK_IDS.microsoft,
    name: 'Microsoft Dynamics & Power Platform',
    keywords: [
      'Microsoft Dynamics',
      'Dynamics 365',
      'Dynamics',
      'D365',
      'Dynamics CRM',
      'Dynamics 365 CE',
      'Dynamics 365 F&O',
      'Finance and Operations',
      'Business Central',
      'Customer Engagement',
      'Power Platform',
      'Power Apps',
      'PowerApps',
      'Power Automate',
      'Power BI',
      'Dataverse',
      'Microsoft 365',
      'Azure',
      'Azure DevOps',
    ],
  },
  {
    id: BUILT_IN_PACK_IDS.erpCrm,
    name: 'ERP & CRM',
    keywords: [
      'ERP',
      'CRM',
      'Enterprise Applications',
      'Business Applications',
      'Business Systems',
      'SAP',
      'Oracle',
      'NetSuite',
      'Salesforce',
      'Workday',
    ],
  },
  {
    id: BUILT_IN_PACK_IDS.digital,
    name: 'Digital transformation',
    keywords: [
      'Digital Transformation',
      'Transformation',
      'Digital',
      'Innovation',
      'Modernization',
      'Modernisation',
      'Business Process',
      'Process Automation',
      'Automation',
    ],
  },
  {
    id: BUILT_IN_PACK_IDS.cloudData,
    name: 'Cloud & data',
    keywords: ['Cloud', 'Azure', 'AWS', 'GCP', 'Data', 'Analytics', 'BI', 'Infrastructure', 'DevOps', 'Platform'],
  },
]

const SENIOR = ['C-level', 'VP', 'Head', 'Director']

let n = 0
const cond = (c: Omit<Condition, 'id' | 'kind'>): Condition => ({ id: `preset-${++n}`, kind: 'condition', ...c })

export interface Preset {
  key: string
  name: string
  description: string
  filter: FilterGroup
}

export const PRESETS: Preset[] = [
  {
    key: 'c-suite',
    name: 'C-suite',
    description: 'CEOs, CTOs, CIOs and other chiefs, plus founders',
    filter: { combinator: 'and', items: [cond({ field: 'seniority', op: 'any_of', value: ['C-level'] })] },
  },
  {
    key: 'senior',
    name: 'Senior decision-makers',
    description: 'C-level, VPs, Heads and Directors',
    filter: { combinator: 'and', items: [cond({ field: 'seniority', op: 'any_of', value: SENIOR })] },
  },
  {
    key: 'tech-leaders',
    name: 'Tech & digital leaders',
    description: 'Senior people in technology or digital roles',
    filter: {
      combinator: 'and',
      items: [
        cond({ field: 'seniority', op: 'any_of', value: SENIOR }),
        cond({ field: 'function', op: 'any_of', value: ['Technology', 'Digital'] }),
      ],
    },
  },
  {
    key: 'd365',
    name: 'Dynamics 365 decision-makers',
    description: 'Senior people in tech/digital roles, or who mention the Microsoft stack',
    filter: {
      combinator: 'and',
      items: [
        cond({ field: 'seniority', op: 'any_of', value: SENIOR }),
        {
          id: 'preset-group-d365',
          kind: 'group',
          combinator: 'or',
          conditions: [
            cond({ field: 'function', op: 'any_of', value: ['Technology', 'Digital', 'Operations'] }),
            cond({ field: 'keywordPack', op: 'matches_pack', value: BUILT_IN_PACK_IDS.microsoft }),
          ],
        },
      ],
    },
  },
  {
    key: 'microsoft',
    name: 'Mentions the Microsoft stack',
    description: 'Title or company matches the Microsoft Dynamics & Power Platform pack',
    filter: {
      combinator: 'and',
      items: [cond({ field: 'keywordPack', op: 'matches_pack', value: BUILT_IN_PACK_IDS.microsoft })],
    },
  },
  {
    key: 'boston',
    name: 'Greater Boston',
    description: 'Based in the Boston area, or at a company headquartered there',
    filter: { combinator: 'and', items: [cond({ field: 'anyLocation', op: 'contains', value: 'Boston' })] },
  },
  {
    key: 'recent',
    name: 'Connected in the last 2 years',
    description: 'Warmer relationships are easier to reopen',
    filter: { combinator: 'and', items: [cond({ field: 'connectedOn', op: 'within_last', value: 24 })] },
  },
]

/** Presets are templates: every use gets fresh ids so edits never collide. */
export function instantiate(filter: FilterGroup): FilterGroup {
  const id = () => crypto.randomUUID()
  return {
    combinator: filter.combinator,
    items: filter.items.map((item) =>
      item.kind === 'group'
        ? { ...item, id: id(), conditions: item.conditions.map((c) => ({ ...c, id: id() })) }
        : { ...item, id: id() },
    ),
  }
}

/** Built-ins added after the first release, seeded into existing databases by the matching upgrade. */
export const PRESETS_ADDED_IN_V6 = ['boston']

/** Stable id for a built-in preset, so restoring resets the same record instead of adding a copy. */
export const builtInPresetId = (key: string) => `preset-${key}`

/** The built-in presets as storable records (seeded on first run, restorable later). */
export function builtInPresetRecords(now: string): SavedPreset[] {
  return PRESETS.map((p, i) => ({
    id: builtInPresetId(p.key),
    name: p.name,
    description: p.description,
    filter: p.filter,
    builtIn: p.key,
    // Keeps the original order when sorted by creation time.
    createdAt: new Date(new Date(now).getTime() + i).toISOString(),
    updatedAt: now,
  }))
}
