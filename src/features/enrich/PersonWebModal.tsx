import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Flex, Modal, Progress, Radio, Result, Select, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { SearchOutlined } from '../../components/icons'
import { db } from '../../lib/db'
import type { Brief, Contact } from '../../lib/schemas'
import { formatUsd, modelById } from '../../lib/ai/models'
import { estimateWebCost, WEB_MODEL } from '../../lib/research/person'
import { planWeb, runWeb, type WebProgress } from '../../lib/research/run-person'
import { runScoring, type ScoringSummary } from '../../lib/ai/run-scoring'
import { checkBudget, useAi } from '../ai/store'
import { UnlockForm } from '../ai/UnlockForm'
import { KeyForm } from '../settings/AiSection'

interface Props {
  shown: Contact[]
  selected: Contact[]
  onClose: () => void
}

/** "Search the web": find each person's public professional profile, then optionally score with a brief. */
export function PersonWebModal({ shown, selected, onClose }: Props) {
  const { status, key, settings } = useAi()
  const briefs = useLiveQuery(() => db.briefs.orderBy('updatedAt').reverse().toArray(), [], [] as Brief[])
  const [scope, setScope] = useState<'shown' | 'selected'>(selected.length ? 'selected' : 'shown')
  const [redo, setRedo] = useState(false)
  const [briefId, setBriefId] = useState<string>('none')
  const [phase, setPhase] = useState<'setup' | 'search' | 'scoring' | 'done'>('setup')
  const [progress, setProgress] = useState<WebProgress>()
  const [scored, setScored] = useState<ScoringSummary>()
  const [scoreProgress, setScoreProgress] = useState<{ scored: number; total: number }>()
  const [error, setError] = useState<string>()
  const abort = useRef<AbortController | null>(null)

  const pool = scope === 'selected' && selected.length ? selected : shown
  const people = useMemo(() => planWeb(pool, redo), [pool, redo])
  const alreadyDone = pool.filter((c) => c.web && c.web.status !== 'error').length
  const estimate = estimateWebCost(people.length)
  const isGpt = settings.provider === 'openai'

  const start = async () => {
    if (!key) return
    setError(undefined)
    abort.current = new AbortController()
    setPhase('search')
    const result = await runWeb({
      apiKey: key,
      provider: settings.provider,
      people,
      signal: abort.current.signal,
      onProgress: setProgress,
      beforeEach: checkBudget,
    })
    const brief = briefs.find((b) => b.id === briefId)
    if (brief && !result.stopped && !abort.current.signal.aborted) {
      setPhase('scoring')
      // Score everyone in the list, with what the search found.
      const fresh = (await db.contacts.bulkGet(pool.map((c) => c.id))).filter((c): c is Contact => !!c)
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
          people: fresh,
          signal: abort.current.signal,
          onProgress: (p) => setScoreProgress({ scored: p.scored, total: p.total }),
          beforeBatch: checkBudget,
        }),
      )
    }
    setPhase('done')
  }

  const running = phase === 'search' || phase === 'scoring'
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      open
      title={
        <Flex align="center" gap={8}>
          <SearchOutlined /> Search people on the web
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
              {modelById(WEB_MODEL).label} with web search
            </Typography.Text>
            <Flex gap={8}>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="primary"
                disabled={status !== 'ready' || !isGpt || people.length === 0}
                onClick={() =>
                  void start().catch(
                    (e) => (setError(e instanceof Error ? e.message : 'Could not start.'), setPhase('setup')),
                  )
                }
              >
                Search {people.length.toLocaleString()} {people.length === 1 ? 'person' : 'people'}
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
            Searches the public web for each person’s professional profile: company bios, talks, interviews, news and
            publications. It fills <b>Web research</b>, adds what they’re known for to <b>Keywords</b>, and fills{' '}
            <b>Location</b> when it’s empty. Every fact links to the page it came from. LinkedIn is never used, and
            personal details (contact details, family and so on) are never kept.
          </Typography.Text>

          {status === 'none' && (
            <div className="panel" style={{ padding: 16 }}>
              <KeyForm />
            </div>
          )}
          {status === 'locked' && <UnlockForm />}
          {status === 'ready' && !isGpt && (
            <Alert type="warning" showIcon title="Web search needs GPT. Choose OpenAI (GPT) under AI assistant." />
          )}

          <Flex vertical gap={6}>
            <Typography.Text strong>Who to search</Typography.Text>
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
                Search again for {alreadyDone.toLocaleString()} {alreadyDone === 1 ? 'person' : 'people'} already
                searched
              </Checkbox>
            )}
          </Flex>

          <Flex vertical gap={6}>
            <Typography.Text strong>Then score with AI</Typography.Text>
            <Select
              value={briefId}
              onChange={setBriefId}
              options={[
                { value: 'none', label: 'Don’t score — search only' },
                ...briefs.map((b) => ({ value: b.id, label: `Score with “${b.name}”` })),
              ]}
              style={{ maxWidth: 420 }}
            />
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
                <b>{people.length.toLocaleString()}</b> {people.length === 1 ? 'person' : 'people'}
              </span>
              <span>
                Estimated cost{' '}
                <b>
                  {formatUsd(estimate.low)}–{formatUsd(estimate.high)}
                </b>
                {briefId !== 'none' && ' + scoring'}
              </span>
            </Flex>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
              Each person takes one or two web searches (about 1–2 cents each) and 5–15 seconds; four run at a time.
              With the company key, searching stops when today’s limit is reached. Run it again tomorrow to continue:
              people already searched are skipped.
            </Typography.Text>
          </div>
          {error && <Alert type="error" showIcon title={error} />}
        </Flex>
      )}

      {phase === 'search' && progress && (
        <Flex vertical gap={10} style={{ padding: '16px 0 4px' }}>
          <Typography.Text>
            Searched {progress.done.toLocaleString()} of {progress.total.toLocaleString()} people
          </Typography.Text>
          <Progress percent={pct} status="active" />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {progress.found.toLocaleString()} found · {formatUsd(progress.costUsd)} so far. Findings appear in the table
            as each person finishes.
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

      {phase === 'done' && progress && (
        <Result
          status={progress.stopped && !progress.found ? 'warning' : 'success'}
          title={`Found ${progress.found.toLocaleString()} of ${progress.total.toLocaleString()} people on the web`}
          subTitle={
            <Flex vertical gap={4}>
              {progress.stopped && <span>{progress.stopped}</span>}
              {progress.warnings.map((w) => (
                <span key={w}>{w}</span>
              ))}
              <span>Search cost: {formatUsd(progress.costUsd)}</span>
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
