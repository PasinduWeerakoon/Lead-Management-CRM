import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Flex, Modal, Progress, Radio, Result, Select, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { WorldOutlined } from '../../components/icons'
import { db } from '../../lib/db'
import type { Brief, Contact } from '../../lib/schemas'
import { formatUsd, modelById, priceKnown, PROVIDERS } from '../../lib/ai/models'
import {
  MAX_COMPANIES_PER_RUN,
  planResearch,
  runResearch,
  type ResearchProgress,
  type ResearchSummary,
} from '../../lib/research/run'
import { runScoring, type ScoringSummary } from '../../lib/ai/run-scoring'
import { checkBudget, useAi } from '../ai/store'
import { ModelPicker } from '../ai/ModelPicker'
import { UnlockForm } from '../ai/UnlockForm'
import { KeyForm } from '../settings/AiSection'

interface Props {
  shown: Contact[]
  selected: Contact[]
  onClose: () => void
}

/** Rough tokens per company: one site read (~4k in, ~0.8k out) plus a share of the website-finding step. */
const IN_PER_COMPANY = 4500
const OUT_PER_COMPANY = 1200

/** "Company research": read each company's own website and job board, then optionally score with a brief. */
export function ResearchModal({ shown, selected, onClose }: Props) {
  const { status, key, settings } = useAi()
  const briefs = useLiveQuery(() => db.briefs.orderBy('updatedAt').reverse().toArray(), [], [] as Brief[])
  const [scope, setScope] = useState<'shown' | 'selected'>(selected.length ? 'selected' : 'shown')
  const [redo, setRedo] = useState(false)
  const [briefId, setBriefId] = useState<string>('none')
  const [phase, setPhase] = useState<'setup' | 'research' | 'scoring' | 'done'>('setup')
  const [progress, setProgress] = useState<ResearchProgress>()
  const [summary, setSummary] = useState<ResearchSummary>()
  const [scored, setScored] = useState<ScoringSummary>()
  const [scoreProgress, setScoreProgress] = useState<{ scored: number; total: number }>()
  const [error, setError] = useState<string>()
  const abort = useRef<AbortController | null>(null)

  const pool = scope === 'selected' && selected.length ? selected : shown
  const plan = useMemo(() => planResearch(pool, redo), [pool, redo])
  const companies = plan.companies.slice(0, MAX_COMPANIES_PER_RUN)
  const alreadyDone = pool.filter((c) => c.research).length
  const model = modelById(settings.model)
  const estimate =
    (companies.length * (IN_PER_COMPANY * model.inputPerM + OUT_PER_COMPANY * model.outputPerM)) / 1_000_000

  const start = async () => {
    if (!key) return
    setError(undefined)
    abort.current = new AbortController()
    setPhase('research')
    const result = await runResearch({
      apiKey: key,
      model: settings.model,
      effort: settings.effort,
      companies,
      signal: abort.current.signal,
      onProgress: setProgress,
      beforeCall: checkBudget,
    })
    setSummary(result)
    const brief = briefs.find((b) => b.id === briefId)
    if (brief && !result.stopped && !abort.current.signal.aborted) {
      setPhase('scoring')
      // Score everyone at the researched companies, with their fresh research.
      const ids = new Set(companies.flatMap((c) => c.people.map((p) => p.id)))
      const people = (await db.contacts.bulkGet([...ids])).filter((c): c is Contact => !!c)
      try {
        localStorage.setItem('leads.lastBrief', brief.id)
      } catch {
        // non-critical
      }
      setScored(
        await runScoring({
          apiKey: key,
          model: settings.model,
          effort: settings.effort,
          brief,
          people,
          signal: abort.current.signal,
          onProgress: (p) => setScoreProgress({ scored: p.scored, total: p.total }),
          beforeBatch: checkBudget,
        }),
      )
    }
    setPhase('done')
  }

  const running = phase === 'research' || phase === 'scoring'
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      open
      title={
        <Flex align="center" gap={8}>
          <WorldOutlined /> Company research
        </Flex>
      }
      width={600}
      maskClosable={!running}
      closable={!running}
      keyboard={!running}
      onCancel={onClose}
      footer={
        phase === 'setup' ? (
          <Flex justify="space-between" align="center">
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {model.label} on {PROVIDERS[settings.provider].label}
            </Typography.Text>
            <Flex gap={8}>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="primary"
                disabled={status !== 'ready' || companies.length === 0}
                onClick={() =>
                  void start().catch(
                    (e) => (setError(e instanceof Error ? e.message : 'Could not start.'), setPhase('setup')),
                  )
                }
              >
                Research {companies.length.toLocaleString()} {companies.length === 1 ? 'company' : 'companies'}
              </Button>
            </Flex>
          </Flex>
        ) : running ? (
          <Button danger onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button type="primary" onClick={onClose}>
            Done
          </Button>
        )
      }
    >
      {phase === 'setup' && (
        <Flex vertical gap={16} style={{ marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            For each company: find its official website (checked by finding the company’s name on it), read a few public
            pages and its job board, and keep only facts quoted from those pages — HQ, industry, technologies, relevant
            open roles and a short summary. Empty fields in the table are filled; nothing you entered is replaced.
            LinkedIn is never read.
          </Typography.Text>

          <Flex vertical gap={6}>
            <Typography.Text strong>AI model</Typography.Text>
            <ModelPicker width={320} />
          </Flex>
          {status === 'none' && (
            <div className="panel" style={{ padding: 16 }}>
              <KeyForm />
            </div>
          )}
          {status === 'locked' && <UnlockForm />}

          <Flex vertical gap={6}>
            <Typography.Text strong>Whose companies</Typography.Text>
            <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
              <Flex vertical gap={4}>
                <Radio value="shown">Everyone in this list ({shown.length.toLocaleString()})</Radio>
                <Radio value="selected" disabled={!selected.length}>
                  Only selected ({selected.length.toLocaleString()})
                </Radio>
              </Flex>
            </Radio.Group>
            {alreadyDone > 0 && (
              <Checkbox checked={redo} onChange={(e) => setRedo(e.target.checked)}>
                Research again for {alreadyDone.toLocaleString()} {alreadyDone === 1 ? 'person' : 'people'} already done
              </Checkbox>
            )}
          </Flex>

          <Flex vertical gap={6}>
            <Typography.Text strong>Then score with AI</Typography.Text>
            <Select
              value={briefId}
              onChange={setBriefId}
              options={[
                { value: 'none', label: 'Don’t score — research only' },
                ...briefs.map((b) => ({ value: b.id, label: `Score with “${b.name}”` })),
              ]}
              style={{ maxWidth: 420 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Scores everyone at the researched companies, using what was found as verified evidence.
            </Typography.Text>
          </Flex>

          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: '12px 14px',
              background: 'var(--bg-hover)',
            }}
          >
            <Flex justify="space-between" wrap gap={8}>
              <span>
                <b>{companies.length.toLocaleString()}</b> {companies.length === 1 ? 'company' : 'companies'} for{' '}
                {companies.reduce((n, c) => n + c.people.length, 0).toLocaleString()} people
              </span>
              <span>
                Estimated AI cost{' '}
                <b>{priceKnown(settings.model) ? `about ${formatUsd(estimate)}` : 'unknown for this model'}</b>
                {briefId !== 'none' && ' + scoring'}
              </span>
            </Flex>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
              Each company takes roughly 5,000 AI tokens and 10–20 seconds. On a free Groq key (8,000 tokens a minute,
              200,000 a day) that’s about 1–2 companies a minute and ~40 a day — research your shortlist first.
              {plan.companies.length > MAX_COMPANIES_PER_RUN &&
                ` Only the first ${MAX_COMPANIES_PER_RUN} companies run per go.`}
              {plan.noCompany > 0 && ` ${plan.noCompany.toLocaleString()} people have no company and are skipped.`}
            </Typography.Text>
          </div>
          {error && <Alert type="error" showIcon title={error} />}
        </Flex>
      )}

      {phase === 'research' && progress && (
        <Flex vertical gap={10} style={{ padding: '16px 0 4px' }}>
          <Typography.Text>
            {progress.step ?? `Researched ${progress.done} of ${progress.total} companies`}
          </Typography.Text>
          <Progress percent={pct} status="active" />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} companies ·{' '}
            {formatUsd(progress.costUsd)} so far. Findings appear in the table as each company finishes.
          </Typography.Text>
        </Flex>
      )}

      {phase === 'scoring' && (
        <Flex vertical gap={10} style={{ padding: '16px 0 4px' }}>
          <Typography.Text>Scoring with your brief…</Typography.Text>
          <Progress
            percent={scoreProgress?.total ? Math.round((scoreProgress.scored / scoreProgress.total) * 100) : 0}
            status="active"
          />
        </Flex>
      )}

      {phase === 'done' && summary && (
        <Result
          status={summary.stopped && !summary.found ? 'warning' : 'success'}
          title={`Researched ${summary.found.toLocaleString()} of ${summary.total.toLocaleString()} companies`}
          subTitle={
            <Flex vertical gap={4}>
              {summary.stopped && <span>{summary.stopped}</span>}
              {summary.noSite > 0 && (
                <span>{summary.noSite.toLocaleString()} without a website that clearly belongs to them.</span>
              )}
              {summary.failed > 0 && <span>{summary.failed.toLocaleString()} failed — run again to retry them.</span>}
              {summary.dropped > 0 && (
                <span>
                  {summary.dropped.toLocaleString()} {summary.dropped === 1 ? 'fact was' : 'facts were'} dropped because
                  the page didn’t back {summary.dropped === 1 ? 'it' : 'them'} up.
                </span>
              )}
              <span>Research cost: {formatUsd(summary.costUsd)}</span>
              {scored && (
                <span>
                  Then scored {scored.scored.toLocaleString()} people ({formatUsd(scored.costUsd)}).
                  {scored.stopped ? ` ${scored.stopped}` : ''}
                </span>
              )}
            </Flex>
          }
          style={{ padding: '16px 0 0' }}
        />
      )}
    </Modal>
  )
}
