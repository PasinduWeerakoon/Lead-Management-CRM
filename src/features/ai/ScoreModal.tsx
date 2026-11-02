import { useRef, useState } from 'react'
import { Alert, Button, Checkbox, Flex, Input, Modal, Progress, Radio, Result, Select, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import type { Brief, Contact } from '../../lib/schemas'
import { formatUsd, modelById, priceKnown, PROVIDERS } from '../../lib/ai/models'
import { spendThisMonth } from '../../lib/ai/settings'
import { BRIEF_TEMPLATE, estimateScoringCost, BATCH_SIZE } from '../../lib/ai/scoring'
import { runScoring, type ScoringProgress, type ScoringSummary } from '../../lib/ai/run-scoring'
import { estimateWebCost } from '../../lib/research/person'
import { planWeb, runWeb, type WebProgress } from '../../lib/research/run-person'
import { checkBudget, useAi } from './store'
import { UnlockForm } from './UnlockForm'
import { ModelPicker } from './ModelPicker'
import { KeyForm } from '../settings/AiSection'
import { SparkIcon } from './AskAi'

const LAST_BRIEF = 'leads.lastBrief'
const NEW = '__new'
/** Shorter than this can't describe anyone (".", "x"). */
const MIN_BRIEF = 3

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
  const company = useAi((s) => s.company)
  const briefs = useLiveQuery(() => db.briefs.orderBy('updatedAt').reverse().toArray(), [], [] as Brief[])
  const spent = useLiveQuery(() => spendThisMonth(), [], 0)

  const [briefId, setBriefId] = useState<string | undefined>(readLast)
  const current = briefs.find((b) => b.id === briefId)
  const [name, setName] = useState<string>()
  const [text, setText] = useState<string>()
  const briefName = name ?? current?.name ?? 'My brief'
  const briefText = text ?? current?.text ?? ''

  const [scope, setScope] = useState<'shown' | 'selected'>(selected.length ? 'selected' : 'shown')
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [progress, setProgress] = useState<ScoringProgress>()
  const [webFirst, setWebFirst] = useState(false)
  const [webProgress, setWebProgress] = useState<WebProgress>()
  const [summary, setSummary] = useState<ScoringSummary>()
  const [vague, setVague] = useState(false)
  const [error, setError] = useState<string>()
  const abort = useRef<AbortController | null>(null)

  const pool = scope === 'selected' && selected.length ? selected : shown
  // Everyone is scored every run; earlier results for the same people are replaced.
  const people = pool
  const canSearch = settings.provider === 'openai'
  const toSearch = webFirst && canSearch ? planWeb(people) : []
  const webEstimate = estimateWebCost(toSearch.length)
  const estimate = estimateScoringCost(settings.model, people, { text: briefText })
  const limit = settings.softLimitUsd
  const mayExceed = limit !== null && spent + estimate.high > limit

  const pickBrief = (id: string) => {
    setBriefId(id === NEW ? undefined : id)
    setName(id === NEW ? '' : undefined)
    setText(id === NEW ? '' : undefined)
  }

  const start = async () => {
    if (!key) return
    setError(undefined)
    setVague(false)
    const now = new Date().toISOString()
    // Save the brief first, so results always point at a brief that exists.
    // A new name means a new brief, so trying an idea never overwrites a saved one.
    const renamed = !!current && !!briefName.trim() && briefName.trim() !== current.name
    const brief: Brief =
      current && !renamed
        ? { ...current, text: briefText.trim(), updatedAt: now }
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
    let scorePeople = people
    if (toSearch.length) {
      const web = await runWeb({
        apiKey: key,
        provider: settings.provider,
        people: toSearch,
        signal: abort.current.signal,
        onProgress: setWebProgress,
        beforeEach: checkBudget,
      })
      if (web.stopped) {
        setSummary({
          scored: 0,
          total: people.length,
          batch: 0,
          batches: 0,
          costUsd: web.costUsd,
          failed: 0,
          droppedClaims: 0,
          warnings: [],
          stopped: `Web search: ${web.stopped}`,
        })
        setPhase('done')
        return
      }
      // Score with what the search just found.
      scorePeople = (await db.contacts.bulkGet(people.map((c) => c.id))).filter((c): c is Contact => !!c)
    }
    const result = await runScoring({
      apiKey: key,
      model: settings.model,
      effort: settings.effort,
      brief,
      people: scorePeople,
      signal: abort.current.signal,
      onProgress: setProgress,
      beforeBatch: checkBudget,
    })
    // Everyone at 0 almost always means the brief didn't say who to look for.
    if (result.scored >= 3) {
      const after = await db.contacts.bulkGet(scorePeople.map((c) => c.id))
      const scores = after.flatMap((c) => (c?.ai?.briefId === brief.id ? [c.ai.score] : []))
      setVague(scores.length > 0 && Math.max(...scores) <= 5)
    }
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
            {status !== 'ready' ? (
              <Typography.Text type="warning" style={{ fontSize: 13 }}>
                {companyNeedsCode
                  ? 'Enter the access code above and press Connect to start.'
                  : status === 'locked'
                    ? 'Unlock your key above to start.'
                    : 'Add an API key above to start.'}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {modelById(settings.model).label} on {PROVIDERS[settings.provider].label}
              </Typography.Text>
            )}
            <Flex gap={8}>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="primary"
                disabled={status !== 'ready' || people.length === 0 || briefText.trim().length < MIN_BRIEF}
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
              placeholder={BRIEF_TEMPLATE}
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
            {canSearch && (
              <Checkbox checked={webFirst} onChange={(e) => setWebFirst(e.target.checked)}>
                Search the web first for {toSearch.length || planWeb(people).length} people not searched yet (fills Web
                research, Keywords and Location)
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
                {toSearch.length > 0 && (
                  <>
                    {' '}
                    + web search{' '}
                    <b>
                      {formatUsd(webEstimate.low)}–{formatUsd(webEstimate.high)}
                    </b>
                  </>
                )}
              </span>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {company ? (
                'Uses the company GPT key (daily limit).'
              ) : (
                <>Billed to your {PROVIDERS[settings.provider].label} key.</>
              )}{' '}
              Only name, title, company, location, company HQ, industry, company size, company and web research
              findings, seniority, function and connection year are sent — never emails, notes or LinkedIn URLs.
              {limit !== null && ` Used this month: ${formatUsd(spent)} of ${formatUsd(limit)}.`}
            </Typography.Text>
            {mayExceed && (
              <Typography.Text type="warning" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                This may reach your monthly limit; scoring stops if it does.
              </Typography.Text>
            )}
          </div>
          {error && <Alert type="error" showIcon title={error} />}
        </Flex>
      )}

      {running && webProgress && !progress && (
        <Flex vertical gap={10} style={{ padding: '16px 0 4px' }}>
          <Typography.Text>
            Searching the web: {webProgress.done.toLocaleString()} of {webProgress.total.toLocaleString()} people…
          </Typography.Text>
          <Progress
            percent={webProgress.total ? Math.round((webProgress.done / webProgress.total) * 100) : 0}
            status="active"
          />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {webProgress.found.toLocaleString()} found · {formatUsd(webProgress.costUsd)} so far. Scoring starts when
            the search is done.
          </Typography.Text>
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
          status={(summary.stopped && summary.scored === 0) || vague ? 'warning' : 'success'}
          title={
            summary.scored
              ? `${summary.scored.toLocaleString()} ${summary.scored === 1 ? 'person' : 'people'} scored`
              : 'Nothing was scored'
          }
          subTitle={
            <Flex vertical gap={4}>
              {vague && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ textAlign: 'left', marginBottom: 8 }}
                  title="Everyone scored 0. Your brief may be too short or unclear."
                  description="Describe who you're looking for, e.g. “CEOs and founders of tech companies in Sri Lanka”, then score again."
                />
              )}
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
