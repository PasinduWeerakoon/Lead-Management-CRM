import { companyKey, domainOf, rank } from '../company-hq'
import { db } from '../db'
import type { Contact } from '../schemas'
import { AiError, structuredCall } from '../ai/provider'
import type { Effort } from '../ai/models'
import { recordUsage } from '../ai/settings'
import { readSiteRemote, type SiteResponse } from './api'
import {
  cleanDomain,
  DOMAIN_SCHEMA,
  DOMAIN_SYSTEM,
  DomainOutput,
  EXTRACT_SCHEMA,
  EXTRACT_SYSTEM,
  extractUserMessage,
  ExtractOutput,
  validateExtract,
  type CompanyResearch,
} from './extract'

export const MAX_COMPANIES_PER_RUN = 200
const DOMAIN_BATCH = 20
const RATE_WAITS_MS = [20_000, 40_000, 60_000]

export interface ResearchCompany {
  key: string
  company: string
  /** Website already known from your data, Apollo or an earlier run. */
  domain?: string
  people: Contact[]
}

/** Companies to research for these people (one per company; people without a company are skipped). */
export function planResearch(people: Contact[], redo = false): { companies: ResearchCompany[]; noCompany: number } {
  const groups = new Map<string, ResearchCompany>()
  let noCompany = 0
  for (const c of people) {
    // Failed attempts are always tried again; finished ones only when redoing.
    if (c.research && c.research.status !== 'error' && !redo) continue
    const key = companyKey(c)
    if (!key || !c.company) {
      noCompany++
      continue
    }
    const known = domainOf(c.enrichment?.website) ?? c.apollo?.org?.domain ?? c.research?.domain
    const g = groups.get(key) ?? { key, company: c.company, people: [] }
    g.domain ??= known
    g.people.push(c)
    groups.set(key, g)
  }
  return { companies: [...groups.values()], noCompany }
}

export interface ResearchProgress {
  done: number
  total: number
  costUsd: number
  /** What's happening now, e.g. "Reading wso2.com…". */
  step?: string
}

export interface ResearchSummary extends ResearchProgress {
  found: number
  noSite: number
  failed: number
  /** Facts dropped because the page didn't back them up. */
  dropped: number
  stopped?: string
}

interface RunOptions {
  apiKey: string
  model: string
  effort: Effort
  companies: ResearchCompany[]
  signal: AbortSignal
  onProgress: (p: ResearchProgress) => void
  beforeCall?: () => Promise<void>
  /** Overridable in tests. */
  waitsMs?: number[]
}

const STOP = new Set(['cancelled', 'auth', 'permission', 'model', 'limit', 'network'])

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })
}

/**
 * Saves a company's research on everyone who works there and fills fields that are still empty:
 * website, industry, size and company HQ (never replacing what you typed, imported or got from Apollo).
 */
export function applyResearch(c: Contact, r: CompanyResearch): Contact {
  const next: Contact = { ...c, research: r }
  if (r.status !== 'found') return next
  const e = c.enrichment
  const website = r.siteUrl ? `https://${r.domain}` : undefined
  if ((website && !e?.website) || (r.industry && !e?.industry) || (r.size && !e?.companySize)) {
    next.enrichment = {
      ...e,
      ...(website && !e?.website ? { website } : {}),
      ...(r.industry && !e?.industry ? { industry: r.industry.value } : {}),
      ...(r.size && !e?.companySize ? { companySize: r.size.value } : {}),
      source: e?.source ?? 'Company website',
      updatedAt: r.at,
    }
  }
  if (r.hq) {
    const hq = { status: 'found' as const, value: r.hq.value, origin: 'web' as const, source: r.hq.url, at: r.at }
    if (!c.companyHq || rank(c.companyHq) < rank(hq)) next.companyHq = hq
  }
  return next
}

async function save(company: ResearchCompany, r: CompanyResearch) {
  const ids = company.people.map((p) => p.id)
  await db.transaction('rw', db.contacts, async () => {
    const current = await db.contacts.bulkGet(ids)
    await db.contacts.bulkPut(current.filter((c): c is Contact => !!c).map((c) => applyResearch(c, r)))
  })
}

/** Researches companies one by one; each company's findings are saved as soon as they're ready. */
export async function runResearch(opts: RunOptions): Promise<ResearchSummary> {
  const companies = opts.companies.slice(0, MAX_COMPANIES_PER_RUN)
  const summary: ResearchSummary = {
    done: 0,
    total: companies.length,
    costUsd: 0,
    found: 0,
    noSite: 0,
    failed: 0,
    dropped: 0,
  }
  const progress = (step?: string) => opts.onProgress({ ...summary, step })
  progress('Starting…')

  const ai = async <T>(
    system: string,
    user: string,
    schemaName: string,
    schema: Record<string, unknown>,
    parse: (v: unknown) => T,
    maxTokens: number,
  ): Promise<T> => {
    const waits = opts.waitsMs ?? RATE_WAITS_MS
    for (let attempt = 0; ; attempt++) {
      try {
        await opts.beforeCall?.()
        const res = await structuredCall({
          apiKey: opts.apiKey,
          model: opts.model,
          effort: opts.effort,
          system,
          user,
          schemaName,
          schema,
          maxTokens,
          signal: opts.signal,
        })
        summary.costUsd += (await recordUsage(res.servedBy, 'research', res.usage)).costUsd
        try {
          return parse(JSON.parse(res.text))
        } catch {
          throw new AiError("The AI's answer couldn't be read.", 'invalid')
        }
      } catch (err) {
        // Rate limits — and the dropped connections some providers answer with when a minute's quota is
        // used up — are waited out and retried.
        const retryable =
          err instanceof AiError && (err.kind === 'rate' || err.kind === 'network' || err.kind === 'busy')
        if (!retryable || attempt >= waits.length || opts.signal.aborted) throw err
        progress(
          `The AI provider is busy or rate-limiting — waiting ${Math.round(waits[attempt] / 1000)}s, then retrying…`,
        )
        await pause(waits[attempt], opts.signal)
      }
    }
  }

  try {
    // 1. Suggest domains for companies whose website isn't known yet (checked by visiting later).
    const unknown = companies.filter((c) => !c.domain)
    const suggestions = new Map<string, string[]>()
    for (let i = 0; i < unknown.length; i += DOMAIN_BATCH) {
      if (opts.signal.aborted) break
      const batch = unknown.slice(i, i + DOMAIN_BATCH)
      progress(`Finding websites (${Math.min(i + DOMAIN_BATCH, unknown.length)} of ${unknown.length})…`)
      const out = await ai(
        DOMAIN_SYSTEM,
        `Companies:\n${batch.map((c, j) => JSON.stringify({ ref: `c${j}`, company: c.company })).join('\n')}`,
        'company_domains',
        DOMAIN_SCHEMA,
        (v) => DomainOutput.parse(v),
        4000,
      )
      for (const r of out.results) {
        const company = batch[Number(r.ref.slice(1))]
        if (company)
          suggestions.set(
            company.key,
            r.domains
              .map(cleanDomain)
              .filter((d): d is string => !!d)
              .slice(0, 3),
          )
      }
    }

    // 2–3. Read each company's site, then pull out cited facts.
    for (const company of companies) {
      if (opts.signal.aborted) {
        summary.stopped = 'Stopped. Everything researched so far is saved.'
        break
      }
      const at = new Date().toISOString()
      try {
        const candidates = company.domain ? [company.domain] : (suggestions.get(company.key) ?? [])
        let site: SiteResponse | undefined
        let domain: string | undefined
        for (const d of candidates) {
          progress(`Reading ${d}…`)
          const s = await readSiteRemote(d, company.company, opts.signal)
          // A website from your own data is trusted; an AI-suggested one must show the company's name.
          if (s.ok && (company.domain || s.matchesCompany)) {
            site = s
            domain = d
            break
          }
        }
        if (!site || !domain) {
          await save(company, {
            status: 'no_site',
            note: candidates.length
              ? `No website that clearly belongs to this company could be read (tried ${candidates.join(', ')}). Add the website in the lead panel and run research again.`
              : 'Website unknown. Add it in the lead panel and run research again.',
            at,
          })
          summary.noSite++
        } else {
          progress(`Reading what ${company.company} says about itself…`)
          const out = await ai(
            EXTRACT_SYSTEM,
            extractUserMessage(company.company, site.pages, site.jobs),
            'company_research',
            EXTRACT_SCHEMA,
            (v) => ExtractOutput.parse(v),
            4000,
          )
          const { facts, dropped } = validateExtract(out, site.pages, site.jobs)
          summary.dropped += dropped
          await save(company, {
            status: 'found',
            domain,
            siteUrl: site.url,
            verified: !!company.domain || site.matchesCompany,
            ...Object.fromEntries(
              Object.entries(facts).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)),
            ),
            jobsTotal: site.jobs.length,
            model: opts.model.slice(0, 60),
            ...(site.blocked.length
              ? { note: `Skipped ${site.blocked.length} page(s) the site asks bots not to read.` }
              : {}),
            at,
          })
          summary.found++
        }
      } catch (err) {
        if (err instanceof AiError && STOP.has(err.kind)) throw err
        summary.failed++
        await save(company, {
          status: 'error',
          note: (err instanceof Error ? err.message : 'Research failed.').slice(0, 300),
          at,
        })
      }
      summary.done++
      progress()
    }
  } catch (err) {
    const e =
      err instanceof AiError ? err : new AiError(err instanceof Error ? err.message : 'Research failed.', 'other')
    summary.stopped = e.kind === 'cancelled' ? 'Stopped. Everything researched so far is saved.' : e.message
  }
  return summary
}
