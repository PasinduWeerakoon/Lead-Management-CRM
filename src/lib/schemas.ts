import { z } from 'zod'
import { KeywordPackSchema, SavedPresetSchema, SavedViewSchema } from './filters/schema'

export const SENIORITIES = ['C-level', 'VP', 'Head', 'Director', 'Manager', 'IC', 'Unknown'] as const
export const FUNCTIONS = [
  'Executive',
  'Technology',
  'Digital',
  'Operations',
  'Finance',
  'Sales',
  'Marketing',
  'People',
  'Other',
] as const
export const STATUSES = ['new', 'shortlisted', 'contacted', 'not_a_fit'] as const
export const SOURCES = ['linkedin_export', 'manual', 'sales_nav', 'sample'] as const
export const PRIORITIES = ['High', 'Medium', 'Low'] as const

export type Seniority = (typeof SENIORITIES)[number]
export type JobFunction = (typeof FUNCTIONS)[number]
export type LeadStatus = (typeof STATUSES)[number]
export type ContactSource = (typeof SOURCES)[number]
export type Priority = (typeof PRIORITIES)[number]

export const ContactSchema = z.object({
  id: z.string().min(1).max(64),
  firstName: z.string().max(200),
  lastName: z.string().max(200),
  fullName: z.string().min(1).max(400),
  profileUrl: z.string().max(500).optional(),
  email: z.string().max(320).optional(),
  company: z.string().max(300).optional(),
  position: z.string().max(500).optional(),
  connectedOn: z.string().max(10).optional(),
  source: z.enum(SOURCES),
  importedAt: z.string(),
  updatedAt: z.string(),

  seniority: z.enum(SENIORITIES),
  function: z.enum(FUNCTIONS),
  titleTags: z.array(z.string().max(40)).max(20),

  status: z.enum(STATUSES),
  /** Set by you now; AI scoring will suggest it later. */
  priority: z.enum(PRIORITIES).optional(),
  tags: z.array(z.string().max(60)).max(50),
  notes: z.string().max(10_000).optional(),
  location: z.object({ value: z.string().max(200), origin: z.enum(['manual', 'enriched']) }).optional(),
  /** Company data added from a CSV (any vendor) or typed in by you. Never guessed. */
  enrichment: z
    .object({
      website: z.string().max(200).optional(),
      industry: z.string().max(120).optional(),
      companySize: z.string().max(60).optional(),
      /** File name, or "manual" for values you typed. */
      source: z.string().max(120),
      updatedAt: z.string(),
    })
    .optional(),
  /**
   * Where the person's company is headquartered — not where the person works. Looked up once per
   * company by AI (an educated guess, with a confidence), imported from a CSV, or typed in by you.
   */
  companyHq: z
    .object({
      /** "unknown" means the lookup ran and wasn't sure, so it isn't asked again. */
      status: z.enum(['found', 'unknown']),
      /** City, region, country — e.g. "Cambridge, Massachusetts, United States". */
      value: z.string().max(200).optional(),
      /** Metro area, e.g. "Greater Boston", so "Boston" also finds Cambridge or Waltham. */
      metro: z.string().max(100).optional(),
      confidence: z.enum(['high', 'medium', 'low']).optional(),
      origin: z.enum(['ai', 'manual', 'import', 'provider', 'web']),
      /** File name for imports, the data provider's name (e.g. "Apollo"), or the web page it came from. */
      source: z.string().max(120).optional(),
      model: z.string().max(60).optional(),
      at: z.string(),
    })
    .optional(),
  /**
   * Latest Apollo lookup for this person (one paid match feeds several columns). `matched: false`
   * means Apollo found no one, so it isn't asked again unless you re-run it.
   */
  apollo: z
    .object({
      matched: z.boolean(),
      id: z.string().max(40).optional(),
      confidence: z.string().max(10).optional(),
      email: z.string().max(320).optional(),
      /** Apollo's own check: "verified", "guessed", "unavailable"… */
      emailStatus: z.string().max(30).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      country: z.string().max(100).optional(),
      org: z
        .object({
          name: z.string().max(300).optional(),
          domain: z.string().max(200).optional(),
          city: z.string().max(100).optional(),
          state: z.string().max(100).optional(),
          country: z.string().max(100).optional(),
          industry: z.string().max(120).optional(),
          size: z.string().max(30).optional(),
          technologies: z.array(z.string().max(80)).max(80).optional(),
        })
        .optional(),
      at: z.string(),
    })
    .optional(),
  /** Last Apollo lookup that failed (shown as an error in the enrichment cells). */
  apolloError: z.object({ message: z.string().max(300), at: z.string() }).optional(),
  /** Mobile/direct phone from Apollo, which arrives a few minutes after it's requested. */
  phone: z
    .object({
      status: z.enum(['found', 'not_found', 'pending', 'error']),
      numbers: z
        .array(z.object({ number: z.string().max(40), type: z.string().max(30).optional() }))
        .max(10)
        .optional(),
      requestId: z.string().max(30).optional(),
      note: z.string().max(300).optional(),
      at: z.string(),
    })
    .optional(),
  /**
   * Company research from the company's own website and job board (shared by everyone at the
   * company). Every fact carries the page it came from and a quote from that page.
   */
  research: z
    .object({
      status: z.enum(['found', 'no_site', 'error']),
      domain: z.string().max(200).optional(),
      siteUrl: z.string().max(500).optional(),
      /** The company's name was found on the site (or the site came from your own data). */
      verified: z.boolean().optional(),
      hq: z.object({ value: z.string().max(200), url: z.string().max(500), quote: z.string().max(200) }).optional(),
      industry: z
        .object({ value: z.string().max(200), url: z.string().max(500), quote: z.string().max(200) })
        .optional(),
      size: z.object({ value: z.string().max(200), url: z.string().max(500), quote: z.string().max(200) }).optional(),
      technologies: z
        .array(z.object({ name: z.string().max(80), url: z.string().max(500), quote: z.string().max(200) }))
        .max(15)
        .optional(),
      /** Relevant open roles (technology, IT, data, ERP/CRM…). */
      hiring: z
        .array(
          z.object({
            title: z.string().max(200),
            url: z.string().max(500).optional(),
            location: z.string().max(120).optional(),
            /** When it was posted, as the job board gives it. */
            postedAt: z.string().max(40).optional(),
            /** Where it was found, e.g. "Workday", "Greenhouse", "Careers page". */
            source: z.string().max(40).optional(),
          }),
        )
        .max(15)
        .optional(),
      /** All open roles found on the job board. */
      jobsTotal: z.number().int().nonnegative().optional(),
      summary: z.string().max(600).optional(),
      sources: z.array(z.string().max(500)).max(10).optional(),
      note: z.string().max(300).optional(),
      model: z.string().max(60).optional(),
      at: z.string(),
    })
    .optional(),
  /**
   * Your ✓/✗ checks of what the system decided, per item. `value` is what you judged, so a check stops
   * counting once that value changes.
   */
  feedback: z
    .record(z.string().max(40), z.object({ ok: z.boolean(), value: z.string().max(300), at: z.string() }))
    .optional(),
  /** Latest AI assessment against a brief. Suggestions only — `priority` above stays yours. */
  ai: z
    .object({
      briefId: z.string(),
      briefName: z.string().max(80),
      score: z.number().int().min(0).max(100),
      priority: z.enum(PRIORITIES),
      reason: z.string().max(600),
      /** Quotes from the person's own data that support the match. */
      confirmed: z.array(z.string().max(200)).max(10),
      /** Educated guesses (e.g. about the company's needs) to verify before relying on them. */
      inferred: z.array(z.string().max(300)).max(10),
      model: z.string().max(60),
      at: z.string(),
    })
    .optional(),
})

export type Contact = z.infer<typeof ContactSchema>
export type AiAssessment = NonNullable<Contact['ai']>

export const BriefSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  text: z.string().min(1).max(4000),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Brief = z.infer<typeof BriefSchema>

export const ImportRecordSchema = z.object({
  id: z.string(),
  fileName: z.string().max(300),
  at: z.string(),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
})

export type ImportRecord = z.infer<typeof ImportRecordSchema>

export const BackupSchema = z.object({
  app: z.literal('leads-management'),
  version: z.union([z.literal(1), z.literal(2)]),
  exportedAt: z.string(),
  contacts: z.array(ContactSchema),
  imports: z.array(ImportRecordSchema),
  // Added in version 2; version-1 backups simply don't have them.
  keywordPacks: z.array(KeywordPackSchema).optional(),
  views: z.array(SavedViewSchema).optional(),
  briefs: z.array(BriefSchema).optional(),
  presets: z.array(SavedPresetSchema).optional(),
})

export type Backup = z.infer<typeof BackupSchema>
