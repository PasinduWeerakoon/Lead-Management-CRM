import type { JobFunction, Seniority } from './schemas'

export interface TitleClassification {
  seniority: Seniority
  function: JobFunction
  titleTags: string[]
}

// Acronyms are matched case-sensitively so "it" in a sentence never reads as "IT".
const ACRONYM_TAGS: Array<[RegExp, string]> = [
  [/\bCEO\b/, 'CEO'],
  [/\bCTO\b/, 'CTO'],
  [/\bCIO\b/, 'CIO'],
  [/\bCOO\b/, 'COO'],
  [/\bCDO\b/, 'CDO'],
  [/\bCFO\b/, 'CFO'],
  [/\bCMO\b/, 'CMO'],
  [/\bCRO\b/, 'CRO'],
  [/\bCISO\b/, 'CISO'],
  [/\bCPO\b/, 'CPO'],
]

const CHIEF_TAGS: Array<[RegExp, string]> = [
  [/chief executive/i, 'CEO'],
  [/chief (technology|technical) officer/i, 'CTO'],
  [/chief information officer/i, 'CIO'],
  [/chief operating officer|chief operations officer/i, 'COO'],
  [/chief digital/i, 'CDO'],
  [/chief data/i, 'CDO'],
  [/chief financial/i, 'CFO'],
  [/chief marketing/i, 'CMO'],
  [/chief revenue/i, 'CRO'],
  [/chief information security/i, 'CISO'],
  [/chief transformation/i, 'Chief Transformation Officer'],
  [/chief product/i, 'CPO'],
]

const VP = /\b(s?vp|evp|avp)\b|vice[\s-]+president/i
const C_LEVEL = /\bchief\b|\bfounder\b|co-?founder|\bpresident\b|\bowner\b|managing director|\bmanaging partner\b/i
const HEAD = /\bhead\s+of\b|\bhead,|^head\b|\bglobal head\b/i
const DIRECTOR = /\bdirector\b|\bpartner\b/i
const MANAGER = /\bmanager\b|\blead\b|\bsupervisor\b|\bteam lead\b/i

// Order matters: the first function whose pattern matches wins.
const FUNCTION_RULES: Array<[JobFunction, RegExp]> = [
  // Recruiting comes first: "Technical Recruiter" is a People role, not a Technology one.
  ['People', /\bpeople\b|\bHR\b|human resources|talent|recruit/i],
  ['Digital', /digital|transformation|innovation|\bCDO\b/i],
  [
    'Technology',
    /technology|technical|\bIT\b|information|engineer|software|systems|enterprise applications|infrastructure|security|cloud|architect|developer|devops|\bdata\b|\bERP\b|\bCRM\b|\bCTO\b|\bCIO\b|\bCISO\b|dynamics|platform|\bQA\b|quality assurance|full[ -]?stack|front[ -]?end|back[ -]?end|programmer|tester|\bAI\b|machine learning|network|database|\bDBA\b|administrator|application/,
  ],
  ['Operations', /operations|operating|\bCOO\b|supply chain|logistics|procurement/i],
  [
    'Finance',
    /financ|\bCFO\b|accounting|accountant|controller|treasur|\btax\b|pricing|wealth|investment|audit|credit|banking/i,
  ],
  ['Sales', /sales|business development|revenue|\bCRO\b|account executive|commercial|customer success/i],
  [
    'Marketing',
    /marketing|\bCMO\b|brand|growth|public relations|\bPR\b|communications?\b|content|designer|social media/i,
  ],
  ['Executive', /\bCEO\b|chief executive|founder|president|owner|managing director|general manager/i],
]

// "IT" must stay case-sensitive, so the Technology rule above has no /i flag;
// this second pass catches lower/mixed-case words for that function.
const TECHNOLOGY_WORDS =
  /technology|technical|information|engineer|software|systems|enterprise applications|infrastructure|security|cloud|architect|developer|devops|\bdata\b|\berp\b|\bcrm\b|dynamics|platform|\bqa\b|quality assurance|full[ -]?stack|front[ -]?end|back[ -]?end|programmer|tester|machine learning|network|database|administrator|application/i

const TAG_FUNCTION: Record<string, JobFunction> = {
  CTO: 'Technology',
  CIO: 'Technology',
  CISO: 'Technology',
  CDO: 'Digital',
  'Chief Transformation Officer': 'Digital',
  COO: 'Operations',
  CFO: 'Finance',
  CMO: 'Marketing',
  CRO: 'Sales',
  CEO: 'Executive',
}

export function classifyTitle(rawTitle: string | undefined): TitleClassification {
  const title = (rawTitle ?? '').trim()
  if (!title) return { seniority: 'Unknown', function: 'Other', titleTags: [] }

  const tags = new Set<string>()
  for (const [re, tag] of ACRONYM_TAGS) if (re.test(title)) tags.add(tag)
  for (const [re, tag] of CHIEF_TAGS) if (re.test(title)) tags.add(tag)
  if (/founder/i.test(title)) tags.add('Founder')

  let seniority: Seniority
  if (VP.test(title)) {
    seniority = 'VP'
    tags.add('VP')
  } else if (tags.size > 0 || C_LEVEL.test(title)) {
    seniority = 'C-level'
    if (/\bpresident\b/i.test(title)) tags.add('President')
    if (/managing director/i.test(title)) tags.add('Managing Director')
  } else if (HEAD.test(title)) {
    seniority = 'Head'
    tags.add('Head')
  } else if (DIRECTOR.test(title)) {
    seniority = 'Director'
    tags.add(/\bpartner\b/i.test(title) && !/\bdirector\b/i.test(title) ? 'Partner' : 'Director')
  } else if (MANAGER.test(title)) {
    seniority = 'Manager'
  } else {
    seniority = 'IC'
  }

  // A C-suite tag is the strongest signal of function ("CEO, Contoso Data" is Executive).
  let fn: JobFunction | undefined
  for (const tag of tags) {
    fn = TAG_FUNCTION[tag]
    if (fn) break
  }
  if (!fn) {
    fn = 'Other'
    for (const [name, re] of FUNCTION_RULES) {
      if (re.test(title) || (name === 'Technology' && TECHNOLOGY_WORDS.test(title))) {
        fn = name
        break
      }
    }
  }

  if (fn === 'Technology' && seniority === 'Director') tags.add('IT Director')
  if (fn === 'Technology' && seniority === 'Head') tags.add('Head of IT')
  if (fn === 'Technology' && seniority === 'VP') tags.add('VP Technology')

  return { seniority, function: fn, titleTags: [...tags] }
}
