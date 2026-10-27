import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Flex, Input, Modal, Progress, Radio, Result, Select, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import type { Brief, Contact } from '../../lib/schemas'
import { formatUsd, modelById, priceKnown, PROVIDERS } from '../../lib/ai/models'
import { spendThisMonth } from '../../lib/ai/settings'
import { BRIEF_TEMPLATE, estimateScoringCost, MAX_PER_RUN, BATCH_SIZE } from '../../lib/ai/scoring'
import { runScoring, type ScoringProgress, type ScoringSummary } from '../../lib/ai/run-scoring'
import { checkBudget, useAi } from './store'
import { UnlockForm } from './UnlockForm'
import { ModelPicker } from './ModelPicker'
import { KeyForm } from '../settings/AiSection'
import { SparkIcon } from './AskAi'

const LAST_BRIEF = 'leads.lastBrief'
const NEW = '__new'

const readLast = () => {
  try {
    return localStorage.getItem(LAST_BRIEF) ?? undefined
  } catch {
    return undefined
  }
}

interface Props {
  shown: Contact[]
  selected: Contact[]
  onClose: () => void
  /** Show the people the AI rated High priority. */
  onShowHigh: () => void
}

export function ScoreModal({ shown, selected, onClose, onShowHigh }: Props) {
  const navigate = useNavigate()
  const { status, key, settings } = useAi()
  const companyNeedsCode = useAi((s) => s.companyNeedsCode)
  const briefs = useLiveQuery(() => db.briefs.orderBy('updatedAt').reverse().toArray(), [], [] as Brief[])
  const spent = useLiveQuery(() => spendThisMonth(), [], 0)

  const [briefId, setBriefId] = useState<string | undefined>(readLast)
  const current = briefs.find((b) => b.id === briefId)
  const [name, setName] = useState<string>()
  const [text, setText] = useState<string>()
  const briefName = name ?? current?.name ?? 'Dynamics 365 decision-makers'
  const briefText = text ?? current?.text ?? BRIEF_TEMPLATE

  const [scope, setScope] = useState<'shown' | 'selected'>(selected.length ? 'selected' : 'shown')
  const [skipScored, setSkipScored] = useState(true)
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [progress, setProgress] = useState<ScoringProgress>()
  const [summary, setSummary] = useState<ScoringSummary>()
  const [error, setError] = useState<string>()
  const abort = useRef<AbortController | null>(null)

  const pool = scope === 'selected' && selected.length ? selected : shown
  const alreadyScored = pool.filter((c) => current && c.ai?.briefId === current.id).length
  const people = useMemo(() => {
    const list = skipScored && current ? pool.filter((c) => c.ai?.briefId !== current.id) : pool
    return list.slice(0, MAX_PER_RUN)
  }, [pool, skipScored, current])
  const overCap = (skipScored && current ? pool.length - alreadyScored : pool.length) > MAX_PER_RUN
  const estimate = estimateScoringCost(settings.model, people, { text: briefText })
  const limit = settings.softLimitUsd
  const mayExceed = limit !== null && spent + estimate.high > limit

  const pickBrief = (id: string) => {
    setBriefId(id === NEW ? undefined : id)
    setName(id === NEW ? '' : undefined)
    setText(id === NEW ? BRIEF_TEMPLATE : undefined)
  }

  const start = async () => {
    if (!key) return
    setError(undefined)
    const now = new Date().toISOString()
    // Save the brief first, so results always point at a brief that exists.
    const brief: Brief = current
      ? { ...current, name: briefName.trim() || current.name, text: briefText.trim(), updatedAt: now }
      : {
          id: crypto.randomUUID(),
          name: briefName.trim() || 'Untitled brief',
          text: briefText.trim(),
          createdAt: now,
          updatedAt: now,
        }
    await db.briefs.put(brief)
    setBriefId(brief.id)
    try {
      localStorage.setItem(LAST_BRIEF, brief.id)
    } catch {
      // non-critical
    }

    abort.current = new AbortController()
    setPhase('running')
    const result = await runScoring({
      apiKey: key,
      model: settings.model,
      effort: settings.effort,
      brief,
      people,
      signal: abort.current.signal,
      onProgress: setProgress,
      beforeBatch: checkBudget,
    })
    setSummary(result)
    setPhase('done')
  }

  const running = phase === 'running'
  const pct = progress && progress.total ? Math.round((progress.scored / progress.total) * 100) : 0

  return (
    <Modal
      open
      title={
        <Flex align="center" gap={8}>
          <SparkIcon /> Score with AI
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
              {modelById(settings.model).label} on {PROVIDERS[settings.provider].label}
            </Typography.Text>
            <Flex gap={8}>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="primary"
                disabled={status !== 'ready' || people.length === 0 || !briefText.trim()}
                onClick={() => void start().catch((e) => setError(e instanceof Error ? e.message : 'Could not start.'))}
              >
                Score {people.length.toLocaleString()} {people.length === 1 ? 'person' : 'people'}
              </Button>
            </Flex>
          </Flex>
        ) : running ? (
          <Button danger onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Flex justify="flex-end" gap={8}>
            <Button onClick={onClose}>Close</Button>
            {summary && summary.scored > 0 && (
              <Button
                type="primary"
                onClick={() => {
                  onShowHigh()
                  onClose()
                }}
              >
                Show High priority
              </Button>
            )}
          </Flex>
        )
      }
    >
      {phase === 'setup' && (
        <Flex vertical gap={16} style={{ marginTop: 8 }}>
          <Flex vertical gap={6}>
            <Typography.Text strong>AI model</Typography.Text>
            <Flex align="center" gap={10} wrap>
              <ModelPicker width={320} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {settings.effort} effort ·{' '}
                <Typography.Link style={{ fontSize: 12 }} onClick={() => navigate('/ai')}>
                  AI settings
                </Typography.Link>
              </Typography.Text>
            </Flex>
          </Flex>

          {status === 'none' && (
            <div className="panel" style={{ padding: 16 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
                {companyNeedsCode ? (
                  'Connect to the company GPT key'
                ) : (
                  <>Add your {PROVIDERS[settings.provider].label} API key</>
                )}{' '}
                to score leads
              </Typography.Text>
              <KeyForm />
            </div>
          )}
          {status === 'locked' && <UnlockForm />}

          <Flex vertical gap={6}>
            <Typography.Text strong>Brief</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Describe the offer and your ideal buyer. Each person is rated 0–100 against it.
            </Typography.Text>
            <Flex gap={8}>
              <Select
                value={current ? current.id : NEW}
                onChange={pickBrief}
                options={[
                  ...briefs.map((b) => ({ value: b.id, label: b.name })),
                  { value: NEW, label: briefs.length ? '+ New brief' : 'New brief' },
                ]}
                style={{ width: 220 }}
              />
              <Input
                value={briefName}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Brief name"
              />
            </Flex>
            <Input.TextArea
              value={briefText}
              onChange={(e) => setText(e.target.value)}
              autoSize={{ minRows: 5, maxRows: 10 }}
              maxLength={4000}
            />
          </Flex>

          <Flex vertical gap={6}>
            <Typography.Text strong>Who to score</Typography.Text>
            <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
              <Flex vertical gap={4}>
                <Radio value="shown">Everyone in this list ({shown.length.toLocaleString()})</Radio>
                <Radio value="selected" disabled={!selected.length}>
                  Only selected ({selected.length.toLocaleString()})
                </Radio>
              </Flex>
            </Radio.Group>
            {current && alreadyScored > 0 && (
              <Checkbox checked={skipScored} onChange={(e) => setSkipScored(e.target.checked)}>
                Skip {alreadyScored.toLocaleString()} already scored with this brief
              </Checkbox>
            )}
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
                <b>{people.length.toLocaleString()}</b> people in {Math.ceil(people.length / BATCH_SIZE)} batches of up
                to {BATCH_SIZE}
              </span>
              <span>
                Estimated cost{' '}
                <b>
                  {priceKnown(settings.model)
                    ? `${formatUsd(estimate.low)}–${formatUsd(estimate.high)}`
                    : 'unknown for this model'}
                </b>
              </span>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Billed to your {PROVIDERS[settings.provider].label} key. Only name, title, company, location, company HQ,
              industry, company size, company research findings, seniority, function and connection year are sent —
              never emails, notes or LinkedIn URLs.
              {limit !== null && ` Used this month: ${formatUsd(spent)} of ${formatUsd(limit)}.`}
            </Typography.Text>
            {overCap && (
              <Typography.Text type="warning" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                Only the first {MAX_PER_RUN} people are scored per run. Narrow the list or run again.
              </Typography.Text>
            )}
            {mayExceed && (
              <Typography.Text type="warning" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                This may reach your monthly limit; scoring stops if it does.
              </Typography.Text>
            )}
          </div>
          {error && <Alert type="error" showIcon title={error} />}
        </Flex>
      )}

      {running && progress && (
        <Flex vertical gap={10} style={{ padding: '16px 0 4px' }}>
          <Typography.Text>
            Scoring batch {progress.batch} of {progress.batches}…
          </Typography.Text>
          <Progress percent={pct} status="active" />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {progress.scored.toLocaleString()} of {progress.total.toLocaleString()} scored ·{' '}
            {formatUsd(progress.costUsd)} so far. Results appear in the table as each batch finishes.
          </Typography.Text>
        </Flex>
      )}

      {phase === 'done' && summary && (
        <Result
          status={summary.stopped && summary.scored === 0 ? 'warning' : 'success'}
          title={
            summary.scored
              ? `${summary.scored.toLocaleString()} ${summary.scored === 1 ? 'person' : 'people'} scored`
              : 'Nothing was scored'
          }
          subTitle={
            <Flex vertical gap={4}>
              {summary.stopped && <span>{summary.stopped}</span>}
              <span>Cost: {formatUsd(summary.costUsd)}</span>
              {summary.failed > 0 && <span>{summary.failed} couldn't be scored. Run again to retry them.</span>}
              {summary.droppedClaims > 0 && (
                <span>
                  {summary.droppedClaims} “confirmed” {summary.droppedClaims === 1 ? 'claim was' : 'claims were'}{' '}
                  removed because {summary.droppedClaims === 1 ? "it wasn't" : "they weren't"} in the person's data.
                </span>
              )}
              {summary.warnings.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </Flex>
          }
          style={{ padding: '16px 0 0' }}
        />
      )}
    </Modal>
  )
}
