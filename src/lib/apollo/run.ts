import { appDb } from '../app-db'
import { db } from '../db'
import type { Contact } from '../schemas'
import { applyApollo, toApolloCache, toPhoneNumbers } from './apply'
import { ApolloError, bulkMatch, matchDetails, pollPhones } from './client'

export const APOLLO_BATCH = 10
/** Apollo's published prices: 1 credit for a person's details or email, 8 more when a mobile is returned. */
export const CREDITS_PER_MATCH = 1
export const CREDITS_PER_PHONE = 9
const RATE_WAITS_MS = [10_000, 30_000, 60_000]
const PHONE_POLL_LIMIT_MS = 10 * 60_000

export interface ApolloProgress {
  done: number
  total: number
  credits: number
  /** Set while pausing for Apollo's rate limit, or while waiting for phone numbers. */
  waiting?: string
}

export interface ApolloSummary extends ApolloProgress {
  matched: number
  notMatched: number
  failed: number
  phonesFound?: number
  phonesPending?: number
  stopped?: string
}

interface RunOptions {
  key: string
  people: Contact[]
  signal: AbortSignal
  onProgress: (p: ApolloProgress) => void
  /** Overridable in tests. */
  waitsMs?: number[]
  pollLimitMs?: number
}

const STOP = new Set(['auth', 'credits', 'plan', 'cancelled', 'network'])

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })
}

/** Credits spent this month, kept with the app's settings (never in backups). */
export async function apolloCreditsThisMonth(now = new Date()): Promise<number> {
  const month = now.toISOString().slice(0, 7)
  const row = (await appDb.settings.get('apolloUsage'))?.value as { month: string; credits: number } | undefined
  return row?.month === month ? row.credits : 0
}

async function addCredits(n: number) {
  if (!n) return
  const month = new Date().toISOString().slice(0, 7)
  await appDb.settings.put({ key: 'apolloUsage', value: { month, credits: (await apolloCreditsThisMonth()) + n } })
}

function batches<T>(items: T[], size = APOLLO_BATCH): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function withRetry<T>(fn: () => Promise<T>, opts: RunOptions, progress: () => ApolloProgress): Promise<T> {
  const waits = opts.waitsMs ?? RATE_WAITS_MS
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof ApolloError) || err.kind !== 'rate' || attempt >= waits.length || opts.signal.aborted)
        throw err
      opts.onProgress({
        ...progress(),
        waiting: `Apollo is rate-limiting — waiting ${Math.round(waits[attempt] / 1000)}s…`,
      })
      await pause(waits[attempt], opts.signal)
      if (opts.signal.aborted) throw new ApolloError('Stopped.', 'cancelled')
    }
  }
}

/** Saves fresh copies so edits made meanwhile (notes, status) aren't overwritten. */
async function update(ids: string[], change: (c: Contact) => Contact) {
  await db.transaction('rw', db.contacts, async () => {
    const current = await db.contacts.bulkGet(ids)
    await db.contacts.bulkPut(current.filter((c): c is Contact => !!c).map(change))
  })
}

/**
 * One Apollo match per person (1 credit when Apollo has data): work email and its status, person
 * location, and the company's HQ, domain, industry, size and technologies — all columns at once.
 */
export async function runApolloMatch(opts: RunOptions): Promise<ApolloSummary> {
  const summary: ApolloSummary = {
    done: 0,
    total: opts.people.length,
    credits: 0,
    matched: 0,
    notMatched: 0,
    failed: 0,
  }
  opts.onProgress({ ...summary })

  for (const group of batches(opts.people)) {
    if (opts.signal.aborted) {
      summary.stopped = 'Stopped. Everything found so far is saved.'
      break
    }
    try {
      const res = await withRetry(
        () => bulkMatch(opts.key, group.map(matchDetails), { signal: opts.signal }),
        opts,
        () => summary,
      )
      const now = new Date().toISOString()
      const caches = new Map(group.map((c, i) => [c.id, toApolloCache(res.matches[i], now)]))
      await update([...caches.keys()], (c) => applyApollo(c, caches.get(c.id)!, now))
      await addCredits(res.credits)
      summary.credits += res.credits
      for (const cache of caches.values()) {
        if (cache.matched) summary.matched++
        else summary.notMatched++
      }
    } catch (err) {
      const e = err instanceof ApolloError ? err : new ApolloError('Unexpected error talking to Apollo.', 'other')
      if (STOP.has(e.kind)) {
        summary.stopped = e.kind === 'cancelled' ? 'Stopped. Everything found so far is saved.' : e.message
        break
      }
      summary.failed += group.length
      const at = new Date().toISOString()
      await update(
        group.map((c) => c.id),
        (c) => ({ ...c, apolloError: { message: e.message.slice(0, 300), at } }),
      )
    }
    summary.done += group.length
    opts.onProgress({ ...summary })
  }
  return summary
}

/**
 * Mobile and direct phone numbers. Apollo matches the person (saved like a normal match), then
 * delivers phones a few minutes later; this keeps checking until they arrive or 10 minutes pass.
 * Unfinished requests stay "pending" and can be checked again later with resumePhones.
 */
export async function runApolloPhones(opts: RunOptions): Promise<ApolloSummary> {
  const summary: ApolloSummary = {
    done: 0,
    total: opts.people.length,
    credits: 0,
    matched: 0,
    notMatched: 0,
    failed: 0,
    phonesFound: 0,
    phonesPending: 0,
  }
  opts.onProgress({ ...summary })
  const requests: Array<{ requestId: string; apolloIds: Map<string, string> }> = []

  for (const group of batches(opts.people)) {
    if (opts.signal.aborted) {
      summary.stopped = 'Stopped. Requests already sent will still be checked later.'
      break
    }
    try {
      const res = await withRetry(
        () => bulkMatch(opts.key, group.map(matchDetails), { phones: true, signal: opts.signal }),
        opts,
        () => summary,
      )
      const now = new Date().toISOString()
      const caches = new Map(group.map((c, i) => [c.id, toApolloCache(res.matches[i], now)]))
      const apolloIds = new Map<string, string>()
      await update([...caches.keys()], (c) => {
        const cache = caches.get(c.id)!
        const next = applyApollo(c, cache, now)
        if (!cache.matched || !cache.id || !res.requestId) {
          summary.notMatched++
          return { ...next, phone: { status: 'not_found', note: 'Apollo found no one to look up.', at: now } }
        }
        summary.matched++
        apolloIds.set(cache.id, c.id)
        return { ...next, phone: { status: 'pending', requestId: res.requestId, at: now } }
      })
      if (res.requestId && apolloIds.size) requests.push({ requestId: res.requestId, apolloIds })
      await addCredits(res.credits)
      summary.credits += res.credits
    } catch (err) {
      const e = err instanceof ApolloError ? err : new ApolloError('Unexpected error talking to Apollo.', 'other')
      if (STOP.has(e.kind)) {
        summary.stopped = e.kind === 'cancelled' ? 'Stopped.' : e.message
        break
      }
      summary.failed += group.length
      const at = new Date().toISOString()
      await update(
        group.map((c) => c.id),
        (c) => ({ ...c, phone: { status: 'error', note: e.message.slice(0, 300), at } }),
      )
    }
    summary.done += group.length
    opts.onProgress({ ...summary })
  }

  const left = await waitForPhones(requests, opts, summary)
  summary.phonesPending = left
  return summary
}

/** Checks pending phone requests (e.g. after a reload) until they finish or the time limit passes. */
export async function resumePhones(opts: RunOptions): Promise<ApolloSummary> {
  const byRequest = new Map<string, Map<string, string>>()
  for (const c of opts.people) {
    if (c.phone?.status !== 'pending' || !c.phone.requestId || !c.apollo?.id) continue
    const m = byRequest.get(c.phone.requestId) ?? new Map<string, string>()
    m.set(c.apollo.id, c.id)
    byRequest.set(c.phone.requestId, m)
  }
  const summary: ApolloSummary = {
    done: 0,
    total: opts.people.length,
    credits: 0,
    matched: 0,
    notMatched: 0,
    failed: 0,
    phonesFound: 0,
  }
  summary.phonesPending = await waitForPhones(
    [...byRequest].map(([requestId, apolloIds]) => ({ requestId, apolloIds })),
    opts,
    summary,
  )
  return summary
}

async function waitForPhones(
  requests: Array<{ requestId: string; apolloIds: Map<string, string> }>,
  opts: RunOptions,
  summary: ApolloSummary,
): Promise<number> {
  const deadline = Date.now() + (opts.pollLimitMs ?? PHONE_POLL_LIMIT_MS)
  let open = [...requests]
  while (open.length && !opts.signal.aborted && Date.now() < deadline) {
    const still: typeof open = []
    let wait = 15
    for (const r of open) {
      try {
        const res = await pollPhones(opts.key, r.requestId, opts.signal)
        if (res.state === 'pending') {
          still.push(r)
          wait = Math.min(wait, res.retryAfterSeconds)
          continue
        }
        const now = new Date().toISOString()
        const numbersById = new Map(
          res.state === 'done' ? res.people.map((p) => [String(p.id), toPhoneNumbers(p.phone_numbers)]) : [],
        )
        await update([...r.apolloIds.values()], (c) => {
          if (res.state === 'gone') return { ...c, phone: { status: 'error', note: res.message, at: now } }
          const numbers = numbersById.get(c.apollo?.id ?? '') ?? []
          if (numbers.length) summary.phonesFound = (summary.phonesFound ?? 0) + 1
          return {
            ...c,
            phone: numbers.length
              ? { status: 'found', numbers, at: now }
              : { status: 'not_found', note: 'Apollo has no phone number for this person.', at: now },
          }
        })
      } catch (err) {
        if (err instanceof ApolloError && STOP.has(err.kind)) {
          summary.stopped =
            err.kind === 'cancelled' ? 'Stopped. Pending phones can be checked again later.' : err.message
          return open.reduce((n, o) => n + o.apolloIds.size, 0)
        }
        still.push(r) // a temporary problem: try again next round
      }
    }
    open = still
    if (open.length) {
      opts.onProgress({
        ...summary,
        waiting: `Waiting for Apollo to send ${open.reduce((n, o) => n + o.apolloIds.size, 0)} phone results…`,
      })
      await pause(wait * 1000, opts.signal)
    }
  }
  return open.reduce((n, o) => n + o.apolloIds.size, 0)
}
