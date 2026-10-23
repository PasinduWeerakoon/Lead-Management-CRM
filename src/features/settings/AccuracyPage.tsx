import { useState } from 'react'
import { Button, Empty, Flex, Progress, Tag, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { CheckCircleOutlined, FlagOutlined } from '../../components/icons'
import { TopBar } from '../../components/TopBar'
import { PageHeader } from '../../components/PageHeader'
import { db } from '../../lib/db'
import { accuracyStats, pickToCheck, type FieldStats } from '../../lib/accuracy'
import type { Contact } from '../../lib/schemas'

const TARGET = 0.9
/** Fewer checks than this and the percentage moves a lot with each mark. */
const ENOUGH = 30

const pct = (n?: number) => (n === undefined ? '—' : `${Math.round(n * 100)}%`)

function AccuracyBar({ s }: { s: FieldStats }) {
  if (s.accuracy === undefined) return <Typography.Text type="secondary">Not checked yet</Typography.Text>
  const good = s.accuracy >= TARGET
  return (
    <Flex align="center" gap={10} style={{ minWidth: 0 }}>
      <Progress
        percent={Math.round(s.accuracy * 100)}
        size="small"
        showInfo={false}
        strokeColor={good ? '#16a34a' : s.accuracy >= 0.7 ? '#d97706' : '#dc2626'}
        style={{ width: 120, margin: 0 }}
      />
      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(s.accuracy)}</b>
      {s.checked < ENOUGH && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          only {s.checked} checked — rough
        </Typography.Text>
      )}
    </Flex>
  )
}

/** How accurate the system is, measured from your ✓/✗ marks in the lead panel. */
export function AccuracyPage() {
  const navigate = useNavigate()
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], [] as Contact[])
  const [sample, setSample] = useState<Contact[]>()
  const stats = accuracyStats(contacts)
  const totalChecks = stats.reduce((n, s) => n + s.checked, 0)

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Setup' }, { label: 'Accuracy', icon: <CheckCircleOutlined /> }]} />
      <div className="screen-body">
        <div className="screen-narrow">
          <PageHeader
            title="Accuracy"
            description={`How often the system is right, from your own ✓/✗ checks (open a person → “Check accuracy”). Target: ${pct(TARGET)}+. Around ${ENOUGH} checks per item give a dependable number.`}
            actions={
              <Button type="primary" icon={<FlagOutlined />} onClick={() => setSample(pickToCheck(contacts, 10))}>
                Give me 10 to check
              </Button>
            }
          />

          {sample && (
            <div className="panel" style={{ padding: '14px 20px', marginBottom: 16 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                Check these {sample.length} — open each, then ✓ or ✗ every item under “Check accuracy”
              </Typography.Text>
              {sample.length ? (
                <Flex gap={6} wrap>
                  {sample.map((c) => (
                    <Button key={c.id} size="small" onClick={() => navigate(`/?open=${c.id}`)}>
                      {c.fullName}
                    </Button>
                  ))}
                </Flex>
              ) : (
                <Typography.Text type="secondary">Everything with a value has been checked.</Typography.Text>
              )}
            </div>
          )}

          {totalChecks === 0 && (
            <div className="panel" style={{ padding: 28, marginBottom: 16 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No checks yet. Click “Give me 10 to check”, open each person and mark what’s right or wrong."
              />
            </div>
          )}

          <div className="panel">
            <div className="acc-row acc-head">
              <span>Item</span>
              <span>Accuracy</span>
              <span style={{ textAlign: 'right' }}>Checked</span>
              <span style={{ textAlign: 'right' }}>Have a value</span>
            </div>
            {stats.map((s) => (
              <div key={s.key} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="acc-row">
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.label}</span>
                  <AccuracyBar s={s} />
                  <span className="num" style={{ textAlign: 'right' }}>
                    {s.correct}/{s.checked}
                  </span>
                  <span className="num" style={{ textAlign: 'right', color: 'var(--text-2)' }}>
                    {s.withValue.toLocaleString()}
                  </span>
                </div>
                {(s.bySource.length > 1 || s.wrong.length > 0) && (
                  <Flex vertical gap={6} style={{ padding: '0 20px 12px' }}>
                    {s.bySource.length > 1 && (
                      <Flex gap={6} wrap align="center">
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          By source:
                        </Typography.Text>
                        {s.bySource.map((b) => (
                          <Tag
                            key={b.source}
                            bordered={false}
                            color={b.accuracy >= TARGET ? 'success' : b.accuracy >= 0.7 ? 'warning' : 'error'}
                          >
                            {b.source}: {pct(b.accuracy)} ({b.correct}/{b.checked})
                          </Tag>
                        ))}
                      </Flex>
                    )}
                    {s.wrong.length > 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Marked wrong:{' '}
                        {s.wrong.slice(0, 8).map((w, i) => (
                          <span key={w.id}>
                            {i > 0 && ', '}
                            <Typography.Link style={{ fontSize: 12 }} onClick={() => navigate(`/?open=${w.id}`)}>
                              {w.name}
                            </Typography.Link>{' '}
                            ({w.value.slice(0, 40)})
                          </span>
                        ))}
                        {s.wrong.length > 8 && ` +${s.wrong.length - 8} more`}
                      </Typography.Text>
                    )}
                  </Flex>
                )}
              </div>
            ))}
          </div>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: 12 }}>
            A check counts only while the value you judged is unchanged — if research or Apollo replaces it, check it
            again. Marks are saved with each person.
          </Typography.Paragraph>
        </div>
      </div>
    </div>
  )
}
