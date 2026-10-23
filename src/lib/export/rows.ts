import { companyTechnologies } from '../apollo/apply'
import { keywordRegex } from '../filters/engine'
import type { Contact } from '../schemas'

/**
 * Columns from the lead-generation brief first, then useful extras.
 * Website, industry and size come only from “Company data” imports or values you typed — never guessed.
 * Company HQ may be AI-inferred, so its source is exported next to it.
 */
export const EXPORT_COLUMNS = [
  { key: 'fullName', header: 'Full Name', width: 24 },
  { key: 'jobTitle', header: 'Job Title', width: 36 },
  { key: 'company', header: 'Company', width: 26 },
  { key: 'location', header: 'Location', width: 20 },
  { key: 'linkedinUrl', header: 'LinkedIn URL', width: 40 },
  { key: 'degree', header: 'Connection Degree', width: 12 },
  { key: 'skillMatch', header: 'Skill Match', width: 32 },
  { key: 'website', header: 'Company Website', width: 24 },
  { key: 'companyHq', header: 'Company HQ', width: 30 },
  { key: 'companyHqSource', header: 'Company HQ Source', width: 18 },
  { key: 'priority', header: 'Lead Priority', width: 12 },
  { key: 'reason', header: 'Reason for Match', width: 56 },
  { key: 'aiScore', header: 'AI Score', width: 10 },
  { key: 'confirmed', header: 'Confirmed Evidence', width: 40 },
  { key: 'inferred', header: 'Inferred (verify)', width: 48 },
  { key: 'seniority', header: 'Seniority', width: 12 },
  { key: 'function', header: 'Function', width: 14 },
  { key: 'industry', header: 'Industry', width: 22 },
  { key: 'companySize', header: 'Company Size', width: 14 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'tags', header: 'Tags', width: 20 },
  { key: 'email', header: 'Email', width: 28 },
  { key: 'workEmail', header: 'Work Email', width: 30 },
  { key: 'emailStatus', header: 'Work Email Status', width: 16 },
  { key: 'phone', header: 'Phone', width: 20 },
  { key: 'technologies', header: 'Company Technologies', width: 40 },
  { key: 'connectedOn', header: 'Connected On', width: 14 },
  { key: 'notes', header: 'Notes', width: 48 },
] as const

export type ExportKey = (typeof EXPORT_COLUMNS)[number]['key']
export type ExportRow = Record<ExportKey, string>

const STATUS_LABEL: Record<Contact['status'], string> = {
  new: 'New',
  shortlisted: 'Shortlisted',
  contacted: 'Contacted',
  not_a_fit: 'Not a fit',
}

function degree(c: Contact): string {
  if (c.source === 'linkedin_export' || c.source === 'sample') return '1st'
  if (c.source === 'sales_nav') return '2nd'
  return ''
}

/** Which of `terms` appear in the title or company, as whole words, dropping ones covered by a longer match. */
export function matchedTerms(c: Contact, terms: string[]): string[] {
  const text = [c.position, c.company].filter(Boolean).join('\n')
  if (!text) return []
  const hits = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].filter((t) => keywordRegex([t])!.test(text))
  return hits.filter((t) => !hits.some((o) => o !== t && o.length > t.length && keywordRegex([t])!.test(o)))
}

/** A plain-English, rule-based reason. It only states what the data shows. */
export function ruleReason(c: Contact, skills: string[]): string {
  const parts: string[] = []
  const roleTags = c.titleTags.filter((t) => !['VP', 'Director', 'Head'].includes(t))
  if (c.seniority !== 'IC' && c.seniority !== 'Unknown') {
    parts.push(
      `${c.seniority === 'C-level' ? 'C-level' : c.seniority} in ${c.function === 'Other' ? 'a business' : c.function.toLowerCase()} role` +
        (roleTags.length ? ` (${roleTags.join(', ')})` : ''),
    )
  } else if (c.function !== 'Other') {
    parts.push(`${c.function} role`)
  }
  if (skills.length) parts.push(`title/company mentions ${skills.join(', ')}`)
  if (c.location?.value) parts.push(`based in ${c.location.value}`)
  if (c.connectedOn) parts.push(`connected since ${c.connectedOn.slice(0, 4)}`)
  if (parts.length === 0) return ''
  const text = parts.join('; ')
  return text[0].toUpperCase() + text.slice(1) + '.'
}

export interface ExportOptions {
  /** Keywords to report under "Skill Match" (from the active filter, or all keyword packs). */
  skillTerms: string[]
  includeNotes: boolean
  includeEmail: boolean
}

export function toExportRow(c: Contact, opts: ExportOptions): ExportRow {
  const skills = matchedTerms(c, opts.skillTerms)
  return {
    fullName: c.fullName,
    jobTitle: c.position ?? '',
    company: c.company ?? '',
    location: c.location?.value ?? '',
    companyHq:
      c.companyHq?.status === 'found' ? [c.companyHq.value, c.companyHq.metro].filter(Boolean).join(' · ') : '',
    companyHqSource: !c.companyHq
      ? ''
      : c.companyHq.origin === 'web'
        ? `Company website (${c.companyHq.source ?? ''})`
        : c.companyHq.origin === 'provider'
          ? (c.companyHq.source ?? 'Data provider')
          : c.companyHq.origin === 'import'
            ? `Imported${c.companyHq.source ? ` (${c.companyHq.source})` : ''}`
            : c.companyHq.origin === 'manual'
              ? 'Typed in'
              : c.companyHq.status === 'unknown'
                ? 'AI: unknown'
                : `AI-inferred (${c.companyHq.confidence ?? 'low'})`,
    linkedinUrl: c.profileUrl ?? '',
    degree: degree(c),
    skillMatch: skills.join(', '),
    website: c.enrichment?.website ?? '',
    // Your own priority wins; otherwise the AI's suggestion.
    priority: c.priority ?? c.ai?.priority ?? '',
    reason: c.ai?.reason || ruleReason(c, skills),
    aiScore: c.ai ? String(c.ai.score) : '',
    confirmed: c.ai ? c.ai.confirmed.join('; ') : '',
    inferred: c.ai ? c.ai.inferred.join('; ') : '',
    seniority: c.seniority === 'IC' ? 'Individual' : c.seniority,
    function: c.function,
    industry: c.enrichment?.industry ?? '',
    companySize: c.enrichment?.companySize ?? '',
    status: STATUS_LABEL[c.status],
    tags: c.tags.join(', '),
    email: opts.includeEmail ? (c.email ?? '') : '',
    // Contact details follow the same "include email" choice.
    workEmail: opts.includeEmail ? (c.apollo?.email ?? '') : '',
    emailStatus: opts.includeEmail && c.apollo?.email ? (c.apollo.emailStatus ?? '') : '',
    phone: opts.includeEmail ? (c.phone?.numbers?.map((n) => n.number).join('; ') ?? '') : '',
    technologies: companyTechnologies(c).join(', '),
    connectedOn: c.connectedOn ?? '',
    notes: opts.includeNotes ? (c.notes ?? '') : '',
  }
}

export function exportColumns(opts: Pick<ExportOptions, 'includeNotes' | 'includeEmail'>) {
  return EXPORT_COLUMNS.filter(
    (col) => (col.key !== 'notes' || opts.includeNotes) && (col.key !== 'email' || opts.includeEmail),
  )
}

/**
 * Spreadsheet apps treat cells starting with = + - @ (or tab / CR) as formulas — a classic
 * CSV-injection hole when exporting data other people wrote (names, titles). Prefixing a quote
 * makes them plain text.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function safeFileName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return base || 'leads'
}
