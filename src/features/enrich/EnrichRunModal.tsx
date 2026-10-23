import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Flex, Modal, Progress, Radio, Result, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { MailOutlined, PhoneOutlined } from '../../components/icons'
import type { Contact } from '../../lib/schemas'
import {
  apolloCreditsThisMonth,
  CREDITS_PER_MATCH,
  CREDITS_PER_PHONE,
  resumePhones,
  runApolloMatch,
  runApolloPhones,
  type ApolloProgress,
  type ApolloSummary,
} from '../../lib/apollo/run'
import { ApolloKeyForm, useApolloKey } from './apolloKey'

export const MAX_PER_RUN = 1000
/** Runs that could cost more than this need an explicit tick first. */
export const CONFIRM_ABOVE_CREDITS = 200

interface Props {
  kind: 'apollo' | 'phone'
  shown: Contact[]
  selected: Contact[]
  onClose: () => void
}

const TITLE = {
  apollo: { icon: <MailOutlined />, title: 'Find work email, location & company details' },
  phone: { icon: <PhoneOutlined />, title: 'Find phone numbers' },
}

/** Runs an Apollo enrichment column after showing who's included and what it may cost. */
export function EnrichRunModal({ kind, shown, selected, onClose }: Props) {
  const { status, key } = useApolloKey()
  const credits = useLiveQuery(() => apolloCreditsThisMonth(), [], 0)
  const [scope, setScope] = useState<'shown' | 'selected'>(selected.length ? 'selected' : 'shown')
  const [skipDone, setSkipDone] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [progress, setProgress] = useState<ApolloProgress>()
  const [summary, setSummary] = useState<ApolloSummary>()
  const [error, setError] = useState<string>()
  const abort = useRef<AbortController | null>(null)

  const pool = scope === 'selected' && selected.length ? selected : shown
  const isDone = (c: Contact) =>
    kind === 'apollo' ? !!c.apollo : c.phone?.status === 'found' || c.phone?.status === 'not_found'
  const { toRun, pending, alreadyDone } = useMemo(() => {
    const pendingPhones = kind === 'phone' ? pool.filter((c) => c.phone?.status === 'pending') : []
    const rest = pool.filter((c) => !pendingPhones.includes(c))
    const done = rest.filter(isDone)
    return {
      toRun: (skipDone ? rest.filter((c) => !isDone(c)) : rest).slice(0, MAX_PER_RUN),
      pending: pendingPhones,
      alreadyDone: done.length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, skipDone, kind])
  const perPerson = kind === 'apollo' ? CREDITS_PER_MATCH : CREDITS_PER_PHONE
  const maxCredits = toRun.length * perPerson
  const nothing = toRun.length === 0 && pending.length === 0
  const needsConfirm = maxCredits > CONFIRM_ABOVE_CREDITS

  const start = async () => {
    if (!key) return
    setError(undefined)
    abort.current = new AbortController()
    setPhase('running')
    const opts = { key, signal: abort.current.signal, onProgress: setProgress }
    try {
      let result: ApolloSummary | undefined
      if (toRun.length)
        result = await (kind === 'apollo' ? runApolloMatch : runApolloPhones)({ ...opts, people: toRun })
      if (pending.length && !abort.current.signal.aborted && !result?.stopped) {
        const resumed = await resumePhones({ ...opts, people: pending })
        result = result
          ? {
              ...result,
              phonesFound: (result.phonesFound ?? 0) + (resumed.phonesFound ?? 0),
              phonesPending: (result.phonesPending ?? 0) + (resumed.phonesPending ?? 0),
              stopped: result.stopped ?? resumed.stopped,
            }
          : resumed
      }
      setSummary(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
    setPhase('done')
  }

  const running = phase === 'running'
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      open
      title={
        <Flex align="center" gap={8}>
          {TITLE[kind].icon} {TITLE[kind].title}
        </Flex>
      }
      width={560}
      maskClosable={!running}
      closable={!running}
      keyboard={!running}
      onCancel={onClose}
      footer={
        phase === 'setup' ? (
          <Flex justify="flex-end" gap={8}>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              type="primary"
              disabled={status !== 'ready' || nothing || (needsConfirm && !confirmed)}
              onClick={() => void start()}
            >
              {toRun.length
                ? `Run for ${toRun.length.toLocaleString()} ${toRun.length === 1 ? 'person' : 'people'}`
                : `Check ${pending.length.toLocaleString()} pending`}
            </Button>
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
            {kind === 'apollo'
              ? 'One Apollo lookup per person fills Work email, Email check, Location, Company HQ, Technologies — and website, industry and size when they’re empty. Things you typed are never replaced.'
              : 'Apollo looks up mobile and direct numbers. They arrive a few minutes after the request; this window keeps checking, or press ▶ on a waiting cell later.'}
          </Typography.Text>

          {status !== 'ready' && (
            <div className="panel" style={{ padding: 16 }}>
              <ApolloKeyForm />
            </div>
          )}

          <Flex vertical gap={6}>
            <Typography.Text strong>Who</Typography.Text>
            <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
              <Flex vertical gap={4}>
                <Radio value="shown">Everyone in this list ({shown.length.toLocaleString()})</Radio>
                <Radio value="selected" disabled={!selected.length}>
                  Only selected ({selected.length.toLocaleString()})
                </Radio>
              </Flex>
            </Radio.Group>
            {alreadyDone > 0 && (
              <Checkbox checked={skipDone} onChange={(e) => setSkipDone(e.target.checked)}>
                Skip {alreadyDone.toLocaleString()} already looked up
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
            {nothing ? (
              <span>Everyone here has already been looked up.</span>
            ) : (
              <>
                <Flex justify="space-between" wrap gap={8}>
                  <span>
                    <b>{toRun.length.toLocaleString()}</b> {toRun.length === 1 ? 'person' : 'people'}
                    {pending.length > 0 && ` · ${pending.length.toLocaleString()} waiting phones to check`}
                  </span>
                  {toRun.length > 0 && (
                    <span>
                      Up to <b>{maxCredits.toLocaleString()}</b> Apollo credits
                    </span>
                  )}
                </Flex>
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                  {kind === 'apollo'
                    ? '1 credit per person Apollo has data for; nothing when it finds no one.'
                    : 'Up to 9 credits per person (1 for details + 8 when a mobile is returned); nothing when it finds no one.'}{' '}
                  Sent to Apollo: LinkedIn URL, name and company. Used this month: {credits.toLocaleString()} credits.
                </Typography.Text>
              </>
            )}
          </div>
          {needsConfirm && (
            <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>
              I understand this can use up to <b>{maxCredits.toLocaleString()}</b> Apollo credits. Tip: select only your
              shortlist first.
            </Checkbox>
          )}
          {error && <Alert type="error" showIcon title={error} />}
        </Flex>
      )}

      {running && progress && (
        <Flex vertical gap={10} style={{ padding: '16px 0 4px' }}>
          <Typography.Text>
            {progress.waiting ?? `Looking up ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}…`}
          </Typography.Text>
          <Progress percent={pct} status="active" />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {progress.credits.toLocaleString()} credits used. Results appear in the table as each batch of 10 finishes.
          </Typography.Text>
        </Flex>
      )}

      {phase === 'done' && (
        <Result
          status={error || (summary?.stopped && !summary.matched) ? 'warning' : 'success'}
          title={
            error
              ? 'The run stopped'
              : kind === 'phone'
                ? `${(summary?.phonesFound ?? 0).toLocaleString()} phone numbers found`
                : `${(summary?.matched ?? 0).toLocaleString()} of ${(summary?.total ?? 0).toLocaleString()} found in Apollo`
          }
          subTitle={
            <Flex vertical gap={4}>
              {error && <span>{error}</span>}
              {summary?.stopped && <span>{summary.stopped}</span>}
              {!!summary?.notMatched && <span>{summary.notMatched.toLocaleString()} not in Apollo.</span>}
              {!!summary?.phonesPending && (
                <span>
                  {summary.phonesPending.toLocaleString()} still waiting — press ▶ on the Phone column later to check
                  again.
                </span>
              )}
              {!!summary?.failed && <span>{summary.failed.toLocaleString()} failed — run again to retry them.</span>}
              {summary && <span>Credits used: {summary.credits.toLocaleString()}</span>}
            </Flex>
          }
          style={{ padding: '16px 0 0' }}
        />
      )}
    </Modal>
  )
}
