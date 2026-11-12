import { companyKey, domainOf, rank } from '../company-hq'
import { db } from '../db'
import type { Contact } from '../schemas'
import { AiError, structuredCall } from '../ai/provider'
import { extractModelFor, type Effort } from '../ai/models'
import { CORESIGNAL_ONLY, fetchCoresignalCompany } from './coresignal'
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
import { mergeResearch, searchCompany, splitOwnProducts } from './company-web'
import { fetchCompanyExtras, mergeExtras } from './sources'
import { WEB_MODEL, WEB_SEARCH_USD } from './person'
const DOMAIN_BATCH = 20
const RATE_WAITS_MS = [20_000, 40_000, 60_000]

export interface ResearchCompany {
  key: string
  company: string
  /** Website already known from your data, Apollo or an earlier run. */
  domain?: string
  people: Contact[]
}

/** "Self-employed", "Stealth startup", "Freelance"…: not a company anyone can look up. */
export const PLACEHOLDER_COMPANY =
  /^\s*(self[\s-]?employed|freelanc\w*|independent( consultant| contractor)?|stealth( mode| startup| start-up| company)?|retired|student|unemployed|open to work|looking for (new )?opportunities|confidential|private|n\/?a|none|-+|various|career break|sabbatical)\s*$/i

/** Companies to research for these people (one per company; people without a company are skipped). */
export function planResearch(people: Contact[], redo = false): { companies: ResearchCompany[]; noCompany: number } {
  const groups = new Map<string, ResearchCompany>()
  let noCompany = 0
  for (const c of people) {
    // Failed attempts are always tried again; finished ones only when redoing.
    if (c.research && c.research.status !== 'error' && !redo) continue
    const key = companyKey(c)
    if (!key || !c.company || PLACEHOLDER_COMPANY.test(c.company)) {
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
  /**
   * Also search the web (GPT only): finds companies whose site can't be read and open roles the site
   * doesn't list. Runs a few companies at a time.
   */
  web?: { provider: string }
  /** Copy fresh research from other people at the same company instead of researching again (default on). */
  reuse?: boolean
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
  // A new attempt that finds nothing (site down, search empty) never replaces what was found before.
  if (r.status !== 'found' && c.research?.status === 'found') return c
  // New findings are added to what was found before (newer values win, lists are joined), so each
  // run builds on the last instead of losing what an earlier search happened to find.
  if (r.status === 'found' && c.research?.status === 'found') {
    const { status: _s, at: _a, ...fresh } = r
    const { status: _os, at: _oa, ...prev } = c.research
    void _s
    void _a
    void _os
    void _oa
    r = { ...mergeResearch(fresh, prev), status: 'found', at: r.at }
  }
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
/**
 * Companies already researched recently (for other people who work there) are copied to these people
 * instead of being researched again. Returns the companies that still need research.
 */
export async function reuseFreshResearch(companies: ResearchCompany[], maxAgeDays = 7): Promise<ResearchCompany[]> {
  const cutoff = Date.now() - maxAgeDays * 86_400_000
  const known = new Map<string, CompanyResearch>()
  for (const c of await db.contacts.toArray()) {
    const r = c.research
    const key = companyKey(c)
    if (!key || !r || r.status === 'error' || Date.parse(r.at) < cutoff) continue
    const prev = known.get(key)
    if (!prev || r.at > prev.at) known.set(key, r)
  }
  const left: ResearchCompany[] = []
  for (const company of companies) {
    const r = known.get(company.key)
    if (r) await save(company, r)
    else left.push(company)
  }
  return left
}

export async function runResearch(opts: RunOptions): Promise<ResearchSummary> {
  const companies = opts.reuse === false ? opts.companies : await reuseFreshResearch(opts.companies)
  const reused = opts.companies.length - companies.length
  if (reused)
    opts.onProgress({
      done: 0,
      total: companies.length,
      costUsd: 0,
      step: `Reused recent data for ${reused} ${reused === 1 ? 'company' : 'companies'} already collected`,
    })
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
    model = opts.model,
  ): Promise<T> => {
    const waits = opts.waitsMs ?? RATE_WAITS_MS
    for (let attempt = 0; ; attempt++) {
      try {
        await opts.beforeCall?.()
        const res = await structuredCall({
          apiKey: opts.apiKey,
          model,
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
    // Coresignal mode looks companies up by name, so no AI website guessing is needed.
    const unknown = CORESIGNAL_ONLY ? [] : companies.filter((c) => !c.domain)
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

    // 2–3. Read each company's site, pull out cited facts, then fill gaps with a web search.
    const queue = [...companies]
    let halt: unknown
    const worker = async () => {
      while (queue.length && !halt) {
        if (opts.signal.aborted) {
          summary.stopped = 'Stopped. Everything researched so far is saved.'
          return
        }
        const company = queue.shift()!
        try {
          await researchOne(company, suggestions.get(company.key) ?? [])
        } catch (err) {
          if (err instanceof AiError && STOP.has(err.kind)) {
            halt ??= err
            return
          }
          summary.failed++
          await save(company, {
            status: 'error',
            note: (err instanceof Error ? err.message : 'Research failed.').slice(0, 300),
            at: new Date().toISOString(),
          })
        }
        summary.done++
        progress()
      }
    }

    /** Reads the company's own website, careers pages and the job boards they link to. */
    const readCompanySite = async (company: ResearchCompany, candidates: string[], trusted: boolean) => {
      let site: SiteResponse | undefined
      let domain: string | undefined
      for (const d of candidates) {
        progress(`Reading ${d}…`)
        const s = await readSiteRemote(d, company.company, opts.signal)
        // A website from your own data is trusted; an AI-suggested one must show the company's name.
        if (s.ok && (trusted || s.matchesCompany)) {
          site = s
          domain = d
          break
        }
      }

      let found: Omit<CompanyResearch, 'status' | 'at'> | undefined
      if (site && domain) {
        progress(`Reading what ${company.company} says about itself…`)
        const out = await ai(
          EXTRACT_SYSTEM,
          extractUserMessage(company.company, site.pages, site.jobs),
          'company_research',
          EXTRACT_SCHEMA,
          (v) => ExtractOutput.parse(v),
          4000,
          // Reading pages into quoted fields is simple, so it runs on the low-cost model.
          extractModelFor(opts.model),
        )
        const { facts, dropped } = validateExtract(out, site.pages, site.jobs)
        summary.dropped += dropped
        found = {
          domain,
          siteUrl: site.url,
          verified: trusted || site.matchesCompany,
          ...Object.fromEntries(
            Object.entries(facts).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)),
          ),
          jobsTotal: site.jobs.length,
          model: extractModelFor(opts.model).slice(0, 60),
          ...(site.blocked.length
            ? { note: `Skipped ${site.blocked.length} page(s) the site asks bots not to read.` }
            : {}),
        }
      }

      return { found, domain }
    }

    const researchOne = async (company: ResearchCompany, suggested: string[]) => {
      const at = new Date().toISOString()

      // Coresignal first: one licensed company record with its jobs. The old sources below stay
      // as they were and run again when CORESIGNAL_ONLY is false.
      if (CORESIGNAL_ONLY) {
        progress(`Looking up ${company.company} in Coresignal…`)
        const { research, credits } = await fetchCoresignalCompany(company.company, company.domain, opts.signal)
        // Then the company's own website and careers pages, for what it says about itself and the
        // jobs on its own job board. The site's own facts and jobs come first.
        const site = company.domain ?? research?.domain
        let found = research
        if (site) {
          try {
            const own = await readCompanySite(company, [site], true)
            if (own.found) found = research ? mergeResearch(own.found, research) : own.found
          } catch (err) {
            // A site that cannot be read keeps the Coresignal record; stopping still stops.
            if (err instanceof AiError && err.kind === 'cancelled') throw err
            progress(`${company.company}: website could not be read, keeping the Coresignal record`)
          }
        }
        // Free official and open records: SEC EDGAR (US filers) and Wikidata. No Coresignal credits.
        progress(`Checking SEC EDGAR and Wikidata for ${company.company}…`)
        found = mergeExtras(
          found,
          await fetchCompanyExtras(company.company, found?.domain ?? site, opts.signal, { jobs: false }),
        )
        if (!found) {
          await save(company, { status: 'no_site', note: 'Coresignal has no record for this company.', at })
          summary.noSite++
          progress(`${company.company}: not found in Coresignal (${credits} credits)`)
          return
        }
        await save(company, { status: 'found', ...splitOwnProducts(company.company, found), at })
        summary.found++
        progress(
          `${company.company}: ${[
            found.domain,
            found.industry?.value,
            found.hiring?.length ? `${found.hiring.length} open jobs` : 'no open jobs',
            found.technologies?.length ? `${found.technologies.length} technologies` : '',
            found.registry ? 'SEC record' : '',
            `${credits} credits`,
          ]
            .filter(Boolean)
            .join(', ')}`,
        )
        return
      }
      const candidates = company.domain ? [company.domain] : suggested
      // eslint-disable-next-line prefer-const
      let { found, domain } = await readCompanySite(company, candidates, !!company.domain)

      // Always search the web too: the site alone misses clients, partners, news, leaders and most
      // job ads, and nobody can predict what people will later ask about a company.
      if (opts.web) {
        progress(`Searching the web and LinkedIn for ${company.company}…`)
        await opts.beforeCall?.()
        const res = await searchCompany({
          apiKey: opts.apiKey,
          provider: opts.web.provider,
          company: company.company,
          hint: {
            domain: domain ?? company.domain,
            country: company.people.find((p) => p.location?.value)?.location?.value,
          },
          signal: opts.signal,
        })
        summary.costUsd += (await recordUsage(WEB_MODEL, 'research', res.usage, res.searches * WEB_SEARCH_USD)).costUsd
        if (res.research) found = mergeResearch(found, res.research)
      }

      // Free registries and job boards: SEC EDGAR, Wikidata, Adzuna.
      progress(`Checking company registries and job boards for ${company.company}…`)
      found = mergeExtras(found, await fetchCompanyExtras(company.company, found?.domain ?? domain, opts.signal))

      if (!found) {
        await save(company, {
          status: 'no_site',
          note: opts.web
            ? 'Nothing about this company could be found on its website or the web. Add its website in the lead panel and run research again.'
            : candidates.length
              ? `No website that clearly belongs to this company could be read (tried ${candidates.join(', ')}). Add the website in the lead panel and run research again.`
              : 'Website unknown. Add it in the lead panel and run research again.',
          at,
        })
        summary.noSite++
        progress(`${company.company}: no website or public data found`)
        return
      }
      await save(company, { status: 'found', ...splitOwnProducts(company.company, found), at })
      summary.found++
      progress(
        `${company.company}: ${[
          found.domain,
          found.hiring?.length ? `${found.hiring.length} open jobs` : 'no open jobs listed',
          found.technologies?.length ? `${found.technologies.length} technologies` : '',
          found.registry ? 'SEC record' : '',
        ]
          .filter(Boolean)
          .join(', ')}`,
      )
    }

    await Promise.all(Array.from({ length: opts.web || CORESIGNAL_ONLY ? 4 : 1 }, worker))
    if (halt) throw halt
  } catch (err) {
    const e =
      err instanceof AiError ? err : new AiError(err instanceof Error ? err.message : 'Research failed.', 'other')
    summary.stopped = e.kind === 'cancelled' ? 'Stopped. Everything researched so far is saved.' : e.message
  }
  return summary
}
