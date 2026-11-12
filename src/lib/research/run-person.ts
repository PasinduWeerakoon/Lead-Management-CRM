import { db } from '../db'
import type { Contact } from '../schemas'
import { AiError } from '../ai/provider'
import { recordUsage } from '../ai/settings'
import { mergeWeb, searchPerson, WEB_MODEL, WEB_SEARCH_USD, type PersonWeb } from './person'
import { fetchWorkEmail } from './sources'

const PARALLEL = 4
const STOP_KINDS = new Set(['cancelled', 'auth', 'permission', 'model', 'limit', 'network'])

export interface WebProgress {
  done: number
  total: number
  found: number
  costUsd: number
  stopped?: string
  warnings: string[]
  /** What just happened, e.g. "Ana Example: found, 4 employers, 2 degrees". */
  step?: string
}

/** People to search: everyone without a finished search (failed ones are always tried again). */
export function planWeb(people: Contact[], redo = false): Contact[] {
  return people.filter((c) => redo || !c.web || c.web.status === 'error')
}

/** Saves a search result; it also fills Location when you haven't set one yourself. */
export async function saveWeb(id: string, web: PersonWeb) {
  await db.contacts
    .where('id')
    .equals(id)
    .modify((c) => {
      // A new search that finds nothing never replaces a profile found before.
      if (web.status !== 'found' && c.web?.status === 'found') return
      // Add to what was found before instead of replacing it (newer values win, lists are joined).
      c.web = c.web?.status === 'found' && web.status === 'found' ? { ...mergeWeb(web, c.web), at: web.at } : web
      if (web.location && c.location?.origin !== 'manual') c.location = { value: web.location, origin: 'enriched' }
    })
}

/** Searches the web for each person, a few at a time. Each result is saved as soon as it arrives. */
export async function runWeb(opts: {
  apiKey: string
  provider: string
  people: Contact[]
  signal: AbortSignal
  onProgress: (p: WebProgress) => void
  /** Called before every search; throw (e.g. budget reached) to stop. */
  beforeEach?: () => Promise<void>
}): Promise<WebProgress> {
  const p: WebProgress = { done: 0, total: opts.people.length, found: 0, costUsd: 0, warnings: [] }
  opts.onProgress({ ...p })
  const queue = [...opts.people]

  const worker = async () => {
    while (queue.length && !p.stopped) {
      if (opts.signal.aborted) {
        p.stopped = 'Stopped. Everything found so far is saved.'
        return
      }
      const contact = queue.shift()!
      try {
        await opts.beforeEach?.()
        const res = await searchPerson({ apiKey: opts.apiKey, provider: opts.provider, contact, signal: opts.signal })
        const usage = await recordUsage(WEB_MODEL, 'web', res.usage, res.searches * WEB_SEARCH_USD)
        p.costUsd += usage.costUsd
        // Hunter: a published or verified work email, when the web search didn't find one.
        const domain = contact.research?.domain
        if (res.web.status !== 'error' && !res.web.email && domain && contact.firstName && contact.lastName) {
          const found = await fetchWorkEmail(contact.firstName, contact.lastName, domain, opts.signal)
          if (found)
            res.web = {
              ...res.web,
              ...(res.web.status === 'not_found' ? { status: 'found' as const, facts: [] } : {}),
              email: { value: found.email, url: found.url, basis: found.basis },
            }
        }
        await saveWeb(contact.id, res.web)
        if (res.web.status === 'found') p.found++
        const w = res.web
        p.step =
          w.status === 'found'
            ? `${contact.fullName}: ${
                [
                  w.career?.length && `${w.career.length} employers`,
                  w.education?.length && `${w.education.length} degrees`,
                  w.projects?.length && `${w.projects.length} projects`,
                  w.email && 'work email',
                  w.github && 'GitHub',
                ]
                  .filter(Boolean)
                  .join(', ') || 'profile found'
              }`
            : `${contact.fullName}: nothing public found on the web or LinkedIn`
      } catch (err) {
        const e = err instanceof AiError ? err : new AiError('Unexpected error while searching.', 'other')
        if (STOP_KINDS.has(e.kind)) {
          p.stopped ??= e.kind === 'cancelled' ? 'Stopped. Everything found so far is saved.' : e.message
          return
        }
        await saveWeb(contact.id, { status: 'error', note: e.message.slice(0, 300), at: new Date().toISOString() })
        if (p.warnings.length < 5) p.warnings.push(`${contact.fullName}: ${e.message}`)
      }
      p.done++
      opts.onProgress({ ...p })
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  opts.onProgress({ ...p })
  return p
}
