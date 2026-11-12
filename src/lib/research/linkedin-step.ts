import { companyKey } from '../company-hq'
import { db } from '../db'
import type { Contact } from '../schemas'
import { AiError } from '../ai/provider'
import { recordUsage } from '../ai/settings'
import { searchCompanyLinkedIn } from './company-web'
import { searchPersonLinkedIn, WEB_MODEL, WEB_SEARCH_USD } from './person'
import { applyResearch, PLACEHOLDER_COMPANY } from './run'
import { saveWeb } from './run-person'

/**
 * The LinkedIn step of every search: each company's public LinkedIn job posts and page, and each
 * person's public LinkedIn profile, found by web search (the app never logs in to LinkedIn).
 * Skipped for what was searched recently; results are added to what is already saved.
 */

const DAY = 86_400_000
const PARALLEL = 4
const STOP = new Set(['cancelled', 'auth', 'permission', 'model', 'limit', 'network'])
const recent = (at: string | undefined, days: number) => !!at && Date.now() - Date.parse(at) < days * DAY

export interface LinkedInPlan {
  companies: Array<{ key: string; company: string; domain?: string; country?: string; ids: string[] }>
  people: Contact[]
}

export function planLinkedIn(people: Contact[]): LinkedInPlan {
  const groups = new Map<string, LinkedInPlan['companies'][number] & { fresh: boolean }>()
  for (const c of people) {
    const key = companyKey(c)
    if (!key || !c.company || PLACEHOLDER_COMPANY.test(c.company)) continue
    const g = groups.get(key) ?? { key, company: c.company, ids: [], fresh: false }
    g.ids.push(c.id)
    g.domain ??= c.research?.domain
    g.country ??= c.location?.value
    g.fresh ||= recent(c.research?.linkedinAt, 7)
    groups.set(key, g)
  }
  return {
    companies: [...groups.values()].filter((g) => !g.fresh).map(({ fresh: _f, ...g }) => (void _f, g)),
    people: people.filter((c) => !recent(c.web?.linkedinAt, 30)),
  }
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>, signal: AbortSignal) {
  const queue = [...items]
  let halt: AiError | undefined
  const worker = async () => {
    while (queue.length && !halt && !signal.aborted) {
      try {
        await fn(queue.shift()!)
      } catch (err) {
        const e = err instanceof AiError ? err : new AiError('LinkedIn search failed.', 'other')
        if (STOP.has(e.kind)) halt = e
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  if (halt) throw halt
}

export async function runLinkedInStep(opts: {
  apiKey: string
  provider: string
  plan: LinkedInPlan
  signal: AbortSignal
  onStep: (text: string) => void
  beforeEach?: () => Promise<void>
}): Promise<{ companies: number; people: number; costUsd: number }> {
  const out = { companies: 0, people: 0, costUsd: 0 }
  const { companies, people } = opts.plan

  await pool(
    companies,
    async (g) => {
      await opts.beforeEach?.()
      const res = await searchCompanyLinkedIn({
        apiKey: opts.apiKey,
        provider: opts.provider,
        company: g.company,
        hint: { domain: g.domain, country: g.country },
        signal: opts.signal,
      })
      out.costUsd += (await recordUsage(WEB_MODEL, 'research', res.usage, res.searches * WEB_SEARCH_USD)).costUsd
      out.companies++
      const at = new Date().toISOString()
      const jobs = res.research?.hiring?.length ?? 0
      await db.transaction('rw', db.contacts, async () => {
        const current = (await db.contacts.bulkGet(g.ids)).filter((c): c is Contact => !!c)
        await db.contacts.bulkPut(
          current.map((c) => {
            const next = res.research ? applyResearch(c, { status: 'found', ...res.research, at }) : c
            // Remember the search even when it found nothing, so it isn't repeated every time.
            return next.research ? { ...next, research: { ...next.research, linkedinAt: at } } : next
          }),
        )
      })
      opts.onStep(`${g.company}: ${jobs ? `${jobs} job ${jobs === 1 ? 'post' : 'posts'}` : 'no job posts found'}`)
    },
    opts.signal,
  )

  await pool(
    people,
    async (c) => {
      await opts.beforeEach?.()
      const res = await searchPersonLinkedIn({
        apiKey: opts.apiKey,
        provider: opts.provider,
        contact: c,
        signal: opts.signal,
      })
      out.costUsd += (await recordUsage(WEB_MODEL, 'web', res.usage, res.searches * WEB_SEARCH_USD)).costUsd
      out.people++
      const w = res.web
      await saveWeb(c.id, w)
      // Remember the search even when nothing was found, so it isn't repeated every time.
      await db.contacts.update(c.id, { 'web.linkedinAt': w.linkedinAt } as never)
      opts.onStep(
        w.status === 'found'
          ? `${c.fullName}: profile found${w.career?.length ? `, ${w.career.length} ${w.career.length === 1 ? 'role' : 'roles'}` : ''}${w.education?.length ? `, ${w.education.length} ${w.education.length === 1 ? 'degree' : 'degrees'}` : ''}`
          : `${c.fullName}: no public profile found`,
      )
    },
    opts.signal,
  )
  return out
}
