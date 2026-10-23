import type { CompanyGroup, CompanyHq, HqPlan } from '../company-hq'
import { saveHq } from '../company-hq-store'
import { batches } from './scoring'
import { HQ_BATCH_SIZE, HQ_MAX_PER_RUN, toHqRow, validateHqBatch } from './company-hq'
import type { Effort } from './models'
import { AiError, hqBatch } from './provider'
import { recordUsage } from './settings'

export interface HqProgress {
  /** Companies looked up so far. */
  done: number
  total: number
  batch: number
  batches: number
  costUsd: number
  /** Set while pausing because the provider is rate-limiting. */
  waitingSeconds?: number
}

export interface HqSummary extends HqProgress {
  found: number
  unknown: number
  /** People who got an HQ already known for their company. */
  copied: number
  /** Companies the AI skipped (after one retry) or whose batch failed. */
  failed: number
  /** Answers dropped because asking again gave a different place. */
  rejected: number
  stopped?: string
  warnings: string[]
}

interface RunOptions {
  apiKey: string
  model: string
  effort: Effort
  plan: HqPlan
  signal: AbortSignal
  onProgress: (p: HqProgress) => void
  /** Called before every request; throw (e.g. budget reached) to stop. */
  beforeBatch?: () => Promise<void>
  /** Overridable in tests. */
  rateWaitsMs?: number[]
}

const STOP_KINDS = new Set(['cancelled', 'auth', 'permission', 'model', 'limit', 'network'])
/** Waits before retrying a rate-limited batch: big lists hit per-minute token limits on free tiers. */
const RATE_WAITS_MS = [15_000, 30_000, 60_000, 60_000, 90_000]

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })
}

const STOPPED = 'Stopped. Every HQ found so far is saved.'

/**
 * Copies HQs already known for a company, then looks up the rest batch by batch. Each answer is
 * saved for everyone at that company as soon as its batch finishes, so stopping keeps what's done.
 */
export async function runHqLookup(opts: RunOptions): Promise<HqSummary> {
  for (const { ids, hq } of opts.plan.copy) await saveHq(ids, hq)
  const companies = opts.plan.lookup.slice(0, HQ_MAX_PER_RUN)
  const groups = batches(companies, HQ_BATCH_SIZE)
  const summary: HqSummary = {
    done: 0,
    total: companies.length,
    batch: 0,
    batches: groups.length,
    costUsd: 0,
    found: 0,
    unknown: 0,
    copied: opts.plan.copy.reduce((n, c) => n + c.ids.length, 0),
    failed: 0,
    rejected: 0,
    warnings: [],
  }
  opts.onProgress({ ...summary })

  const waits = opts.rateWaitsMs ?? RATE_WAITS_MS
  const ask = async (group: CompanyGroup[], attempt = 0): Promise<Map<CompanyGroup, CompanyHq>> => {
    try {
      return await askOnce(group)
    } catch (err) {
      if (!(err instanceof AiError) || err.kind !== 'rate' || attempt >= waits.length || opts.signal.aborted) throw err
      opts.onProgress({ ...summary, waitingSeconds: Math.round(waits[attempt] / 1000) })
      await pause(waits[attempt], opts.signal)
      if (opts.signal.aborted) throw new AiError('Stopped.', 'cancelled')
      return ask(group, attempt + 1)
    }
  }

  const askOnce = async (group: CompanyGroup[]): Promise<Map<CompanyGroup, CompanyHq>> => {
    await opts.beforeBatch?.()
    const entries = group.map((g, i) => ({ ref: `c${i + 1}`, group: g }))
    const res = await hqBatch({
      apiKey: opts.apiKey,
      model: opts.model,
      effort: opts.effort,
      rows: entries.map((e) => toHqRow(e.group, e.ref)),
      signal: opts.signal,
    })
    const usage = await recordUsage(res.servedBy, 'hq', res.usage)
    summary.costUsd += usage.costUsd
    const checked = validateHqBatch(
      res.output,
      entries.map((e) => e.ref),
      res.servedBy,
    )
    return new Map(entries.flatMap((e) => (checked.results.has(e.ref) ? [[e.group, checked.results.get(e.ref)!]] : [])))
  }

  const save = async (g: CompanyGroup, hq: CompanyHq) => {
    await saveHq(
      g.people.map((p) => p.id),
      hq,
    )
    summary.done++
    if (hq.status === 'found') summary.found++
    else summary.unknown++
  }

  /**
   * Looks up one batch, then asks again about every place it found and keeps only answers that
   * agree — the model's guesses about lesser-known companies change between runs (even when it
   * says "high" confidence), and a wrong city is worse than "unknown".
   */
  const lookup = async (group: CompanyGroup[]): Promise<number> => {
    const answers = await ask(group)
    const skipped = group.filter((g) => !answers.has(g))
    if (skipped.length && !opts.signal.aborted) for (const [g, hq] of await ask(skipped)) answers.set(g, hq) // one retry

    const unsure = [...answers].filter(([, hq]) => hq.status === 'found')
    for (const [g, hq] of answers) if (!unsure.some(([u]) => u === g)) await save(g, hq)
    if (unsure.length) {
      let second: Map<CompanyGroup, CompanyHq>
      try {
        second = await ask(unsure.map(([g]) => g))
      } catch (err) {
        if (err instanceof AiError && STOP_KINDS.has(err.kind)) throw err
        return group.length - answers.size + unsure.length
      }
      for (const [g, hq] of unsure) {
        if (sameHq(hq, second.get(g))) await save(g, hq)
        else {
          summary.rejected++
          await save(g, { status: 'unknown', origin: 'ai', model: hq.model, at: hq.at })
        }
      }
    }
    return group.length - answers.size
  }

  for (const [i, group] of groups.entries()) {
    if (opts.signal.aborted) {
      summary.stopped = STOPPED
      break
    }
    summary.batch = i + 1
    opts.onProgress({ ...summary })
    try {
      summary.failed += await lookup(group)
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('Unexpected error while looking up companies.', 'other')
      if (STOP_KINDS.has(e.kind)) {
        summary.stopped = e.kind === 'cancelled' ? STOPPED : e.message
        break
      }
      summary.failed += group.length
      summary.warnings.push(`Batch ${i + 1}: ${e.message}`)
    }
    opts.onProgress({ ...summary })
  }
  return summary
}

const placeKey = (hq?: CompanyHq) => {
  const parts = (hq?.status === 'found' ? (hq.value ?? '') : '')
    .toLowerCase()
    .split(',')
    .map((p) => p.trim())
  return parts.length > 1 ? `${parts[0]}|${parts[parts.length - 1]}` : parts[0]
}

/** Two answers agree when city and country match. */
export const sameHq = (a?: CompanyHq, b?: CompanyHq) => !!placeKey(a) && placeKey(a) === placeKey(b)
