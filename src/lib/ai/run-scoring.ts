import { db } from '../db'
import type { AiAssessment, Brief, Contact } from '../schemas'
import { AiError, scoreBatch } from './provider'
import type { Effort } from './models'
import { recordUsage } from './settings'
import { batches, buildScoringSystemPrompt, MAX_PER_RUN, toScoringRow, validateBatch } from './scoring'

export interface ScoringProgress {
  scored: number
  total: number
  batch: number
  batches: number
  costUsd: number
}

export interface ScoringSummary extends ScoringProgress {
  /** People the AI couldn't score (after one retry). */
  failed: number
  droppedClaims: number
  /** Set when the run ended early: cancelled, budget reached, bad key… */
  stopped?: string
  /** Problems that didn't stop the run, e.g. one batch was declined. */
  warnings: string[]
}

interface RunOptions {
  apiKey: string
  model: string
  effort: Effort
  brief: Brief
  people: Contact[]
  signal: AbortSignal
  onProgress: (p: ScoringProgress) => void
  /** Called before every request; throw (e.g. budget reached) to stop. */
  beforeBatch?: () => Promise<void>
}

const STOP_KINDS = new Set(['cancelled', 'auth', 'permission', 'model', 'limit', 'network'])

/** Scores people batch by batch. Results are saved as each batch finishes, so stopping keeps what's done. */
export async function runScoring(opts: RunOptions): Promise<ScoringSummary> {
  const people = opts.people.slice(0, MAX_PER_RUN)
  const system = buildScoringSystemPrompt(opts.brief)
  const groups = batches(people)
  const summary: ScoringSummary = {
    scored: 0,
    total: people.length,
    batch: 0,
    batches: groups.length,
    costUsd: 0,
    failed: 0,
    droppedClaims: 0,
    warnings: [],
  }
  opts.onProgress({ ...summary })

  const scoreGroup = async (group: Contact[]): Promise<Contact[]> => {
    await opts.beforeBatch?.()
    const entries = group.map((contact, i) => ({ ref: `r${i + 1}`, contact, row: toScoringRow(contact, `r${i + 1}`) }))
    const res = await scoreBatch({
      apiKey: opts.apiKey,
      model: opts.model,
      effort: opts.effort,
      system,
      rows: entries.map((e) => e.row),
      signal: opts.signal,
    })
    const usage = await recordUsage(res.servedBy, 'scoring', res.usage)
    summary.costUsd += usage.costUsd

    const checked = validateBatch(res.output, entries, opts.brief, res.servedBy)
    summary.droppedClaims += checked.droppedClaims
    await saveAssessments(checked.results)
    summary.scored += checked.results.size
    return entries.filter((e) => checked.missing.includes(e.ref)).map((e) => e.contact)
  }

  for (const [i, group] of groups.entries()) {
    if (opts.signal.aborted) {
      summary.stopped = 'Stopped. Everything scored so far is saved.'
      break
    }
    summary.batch = i + 1
    opts.onProgress({ ...summary })
    try {
      let missing = await scoreGroup(group)
      if (missing.length && !opts.signal.aborted) missing = await scoreGroup(missing) // one retry for skipped people
      summary.failed += missing.length
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('Unexpected error while scoring.', 'other')
      if (STOP_KINDS.has(e.kind)) {
        summary.stopped = e.kind === 'cancelled' ? 'Stopped. Everything scored so far is saved.' : e.message
        break
      }
      summary.failed += group.length
      summary.warnings.push(`Batch ${i + 1}: ${e.message}`)
    }
    opts.onProgress({ ...summary })
  }
  return summary
}

async function saveAssessments(results: Map<string, AiAssessment>) {
  if (results.size === 0) return
  await db.contacts
    .where('id')
    .anyOf([...results.keys()])
    .modify((c) => {
      c.ai = results.get(c.id)
    })
}
