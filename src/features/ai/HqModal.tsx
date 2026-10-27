import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Flex, Modal, Progress, Radio, Result, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { EnvironmentOutlined } from '../../components/icons'
import type { Contact } from '../../lib/schemas'
import { planHqLookup } from '../../lib/company-hq'
import { clearAiHq } from '../../lib/company-hq-store'
import { formatUsd, modelById, priceKnown, PROVIDERS } from '../../lib/ai/models'
import { spendThisMonth } from '../../lib/ai/settings'
import { estimateHqCost, HQ_BATCH_SIZE, HQ_EFFORT, HQ_MAX_PER_RUN } from '../../lib/ai/company-hq'
import { runHqLookup, type HqProgress, type HqSummary } from '../../lib/ai/run-company-hq'
import { checkBudget, useAi } from './store'
import { UnlockForm } from './UnlockForm'
import { ModelPicker } from './ModelPicker'
import { KeyForm } from '../settings/AiSection'

interface Props {
  shown: Contact[]
  selected: Contact[]
  /** Everyone, so an HQ found for one person is reused for colleagues. */
  all: Contact[]
  onClose: () => void
}

/** "Find company HQ": one AI lookup per company, copied to everyone who works there. */
export function HqModal({ shown, selected, all, onClose }: Props) {
  const navigate = useNavigate()
  const { status, key, settings } = useAi()
  const companyNeedsCode = useAi((s) => s.companyNeedsCode)
  const spent = useLiveQuery(() => spendThisMonth(), [], 0)

  const [scope, setScope] = useState<'shown' | 'selected'>(selected.length ? 'selected' : 'shown')
  const [redo, setRedo] = useState(false)
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [progress, setProgress] = useState<HqProgress>()
  const [summary, setSummary] = useState<HqSummary>()
  const [error, setError] = useState<string>()
  const abort = useRef<AbortController | null>(null)

  const pool = scope === 'selected' && selected.length ? selected : shown
  const plan = useMemo(() => planHqLookup(pool, all, redo), [pool, all, redo])
  const companies = plan.lookup.slice(0, HQ_MAX_PER_RUN)
  const peopleToLookUp = companies.reduce((n, g) => n + g.people.length, 0)
  const copied = plan.copy.reduce((n, c) => n + c.ids.length, 0)
  const aiDone = pool.filter((c) => c.companyHq?.origin === 'ai')
  const nothingToDo = companies.length === 0 && copied === 0
  const estimate = estimateHqCost(settings.model, companies)
  const limit = settings.softLimitUsd
  const mayExceed = limit !== null && spent + estimate.high > limit

  const start = async () => {
    if (!key) return
    setError(undefined)
    abort.current = new AbortController()
    setPhase('running')
    // Old answers go first, so nothing from an earlier, less careful run is left behind.
    if (redo) await clearAiHq(aiDone.map((c) => c.id))
    const result = await runHqLookup({
      apiKey: key,
      model: settings.model,
      effort: HQ_EFFORT,
      plan: { ...plan, lookup: companies },
      signal: abort.current.signal,
      onProgress: setProgress,
      beforeBatch: checkBudget,
    })
    setSummary(result)
    setPhase('done')
  }

  const running = phase === 'running'
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const needsAi = companies.length > 0

  return (
    <Modal
      open
      title={
        <Flex align="center" gap={8}>
          <EnvironmentOutlined /> Find company HQ
        </Flex>
      }
      width={580}
      maskClosable={!running}
      closable={!running}
      keyboard={!running}
      onCancel={onClose}
      footer={
        phase === 'setup' ? (
          <Flex justify="space-between" align="center">
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {needsAi ? `${modelById(settings.model).label} on ${PROVIDERS[settings.provider].label}` : ''}
            </Typography.Text>
            <Flex gap={8}>
              <Button onClick={onClose}>Cancel</Button>
              <Button
                type="primary"
                disabled={nothingToDo || (needsAi && status !== 'ready')}
                onClick={() => void start().catch((e) => setError(e instanceof Error ? e.message : 'Could not start.'))}
              >
                {needsAi
                  ? `Look up ${companies.length.toLocaleString()} ${companies.length === 1 ? 'company' : 'companies'}`
                  : `Fill in ${copied.toLocaleString()} ${copied === 1 ? 'person' : 'people'}`}
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
            Finds where each company is headquartered, so you can filter by region with “Location or company HQ”. It’s
            the company’s HQ — not proof of where the person works. The AI thinks carefully (high effort), is asked
            twice, and an HQ is kept only when both answers match; otherwise it stays unknown.
          </Typography.Text>

          {needsAi && (
            <Flex vertical gap={6}>
              <Typography.Text strong>AI model</Typography.Text>
              <Flex align="center" gap={10} wrap>
                <ModelPicker width={320} />
                <Typography.Link style={{ fontSize: 12 }} onClick={() => navigate('/ai')}>
                  AI settings
                </Typography.Link>
              </Flex>
            </Flex>
          )}

          {needsAi && status === 'none' && (
            <div className="panel" style={{ padding: 16 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
                {companyNeedsCode ? (
                  'Connect to the company GPT key'
                ) : (
                  <>Add your {PROVIDERS[settings.provider].label} API key</>
                )}{' '}
                to look up companies
              </Typography.Text>
              <KeyForm />
            </div>
          )}
          {needsAi && status === 'locked' && <UnlockForm />}

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
            {aiDone.length > 0 && (
              <Checkbox checked={redo} onChange={(e) => setRedo(e.target.checked)}>
                Remove the AI’s answers for {aiDone.length.toLocaleString()} {aiDone.length === 1 ? 'person' : 'people'}{' '}
                and look them up again
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
            {nothingToDo ? (
              <span>Everyone here already has a company HQ, or no company name to look up.</span>
            ) : (
              <>
                <Flex justify="space-between" wrap gap={8}>
                  <span>
                    <b>{companies.length.toLocaleString()}</b> {companies.length === 1 ? 'company' : 'companies'} for{' '}
                    {peopleToLookUp.toLocaleString()} people
                    {companies.length > 0 &&
                      ` · ${Math.ceil(companies.length / HQ_BATCH_SIZE)} ${Math.ceil(companies.length / HQ_BATCH_SIZE) === 1 ? 'batch' : 'batches'}`}
                  </span>
                  {needsAi && (
                    <span>
                      Estimated cost{' '}
                      <b>
                        {priceKnown(settings.model)
                          ? `${formatUsd(estimate.low)}–${formatUsd(estimate.high)}`
                          : 'unknown for this model'}
                      </b>
                    </span>
                  )}
                </Flex>
                {copied > 0 && (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                    {copied.toLocaleString()} more {copied === 1 ? 'person gets' : 'people get'} an HQ already known for
                    their company, free.
                  </Typography.Text>
                )}
                {needsAi && (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                    Only company names and website domains are sent — never people’s names, titles, emails or notes.
                    {limit !== null && ` Used this month: ${formatUsd(spent)} of ${formatUsd(limit)}.`}
                  </Typography.Text>
                )}
              </>
            )}
            {plan.lookup.length > HQ_MAX_PER_RUN && (
              <Typography.Text type="warning" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                Only the first {HQ_MAX_PER_RUN.toLocaleString()} companies are looked up per run. Run again for the
                rest.
              </Typography.Text>
            )}
            {plan.noCompany > 0 && (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                {plan.noCompany.toLocaleString()} {plan.noCompany === 1 ? 'person has' : 'people have'} no company and
                {plan.noCompany === 1 ? ' is' : ' are'} skipped.
              </Typography.Text>
            )}
            {mayExceed && needsAi && (
              <Typography.Text type="warning" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                This may reach your monthly limit; the lookup stops if it does.
              </Typography.Text>
            )}
          </div>
          {error && <Alert type="error" showIcon title={error} />}
        </Flex>
      )}

      {running && progress && (
        <Flex vertical gap={10} style={{ padding: '16px 0 4px' }}>
          <Typography.Text>
            {progress.waitingSeconds
              ? `${PROVIDERS[settings.provider].label} is rate-limiting — waiting ${progress.waitingSeconds}s, then retrying batch ${progress.batch}…`
              : progress.batches
                ? `Looking up batch ${progress.batch} of ${progress.batches}…`
                : 'Filling in known companies…'}
          </Typography.Text>
          <Progress percent={pct} status="active" />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()} companies ·{' '}
            {formatUsd(progress.costUsd)} so far. Results appear in the table as each batch finishes.
          </Typography.Text>
        </Flex>
      )}

      {phase === 'done' && summary && (
        <Result
          status={summary.stopped && summary.done === 0 && summary.copied === 0 ? 'warning' : 'success'}
          title={
            summary.total
              ? `HQ found for ${summary.found.toLocaleString()} of ${summary.total.toLocaleString()} companies`
              : `${summary.copied.toLocaleString()} ${summary.copied === 1 ? 'person' : 'people'} filled in`
          }
          subTitle={
            <Flex vertical gap={4}>
              {summary.stopped && <span>{summary.stopped}</span>}
              {summary.unknown > 0 && (
                <span>
                  {summary.unknown.toLocaleString()} marked unknown — the AI wasn’t sure. Type the HQ in the lead panel
                  if you know it.
                </span>
              )}
              {summary.rejected > 0 && (
                <span>
                  {summary.rejected.toLocaleString()} {summary.rejected === 1 ? 'answer was' : 'answers were'} dropped
                  because the AI named a different place when asked twice.
                </span>
              )}
              {summary.copied > 0 && summary.total > 0 && (
                <span>{summary.copied.toLocaleString()} people got an HQ already known for their company.</span>
              )}
              {summary.total > 0 && <span>Cost: {formatUsd(summary.costUsd)}</span>}
              {summary.failed > 0 && <span>{summary.failed} couldn’t be looked up. Run again to retry them.</span>}
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
