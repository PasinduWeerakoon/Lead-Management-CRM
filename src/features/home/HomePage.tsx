import { useEffect, useMemo } from 'react'
import { Alert, Button, Flex, Progress } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { db } from '../../lib/db'
import { relativeTime } from '../../lib/format'
import type { Contact, ScoreRun } from '../../lib/schemas'
import { groupSearches } from '../ai/ResultsPage'
import { useAi } from '../ai/store'

/** How much web data exists: companies looked up, and people whose past jobs were searched. */
export function coverage(contacts: Contact[]) {
  const companies = new Map<string, boolean>()
  for (const c of contacts) {
    const key = c.company?.trim().toLowerCase()
    if (key) companies.set(key, companies.get(key) || !!c.research)
  }
  const companyDone = [...companies.values()].filter(Boolean).length
  const peopleDone = contacts.filter((c) => !!c.web).length
  const withData = contacts.filter((c) => c.research?.status === 'found' || c.web?.status === 'found').length
  const total = companies.size + contacts.length
  return {
    companies: companies.size,
    companyDone,
    peopleDone,
    withData,
    percent: total ? Math.round(((companyDone + peopleDone) / total) * 100) : 0,
  }
}

function StepTile(props: {
  step: string
  state: string
  tone: 'done' | 'run' | 'idle'
  value: string
  note: React.ReactNode
  onClick: () => void
}) {
  const bg =
    props.tone === 'done' ? 'rgba(22,163,74,.08)' : props.tone === 'run' ? 'var(--primary-soft)' : 'var(--bg-hover)'
  const fg = props.tone === 'done' ? 'var(--success)' : props.tone === 'run' ? 'var(--primary-text)' : 'var(--text-2)'
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        flex: '1 1 180px',
        minWidth: 0,
        textAlign: 'left',
        border: 0,
        borderRadius: 10,
        background: bg,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: 'pointer',
        font: 'inherit',
        color: 'var(--text-2)',
      }}
    >
      <span style={{ fontSize: 12.5, color: fg }}>
        {props.step} · {props.state}
      </span>
      <b className="num" style={{ fontSize: 22, color: 'var(--ink)', fontWeight: 600 }}>
        {props.value}
      </b>
      <span style={{ fontSize: 13 }}>{props.note}</span>
    </button>
  )
}

/** Where you are in the four steps, the latest searches, and today's AI spend. */
export function HomePage() {
  const navigate = useNavigate()
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], [] as Contact[])
  const runs = useLiveQuery(() => db.scoreRuns.toArray(), [], [] as ScoreRun[])
  const lastImport = useLiveQuery(() => db.imports.orderBy('at').last())
  const companyAi = useAi((s) => s.companyAi)
  useEffect(() => {
    void useAi.getState().refreshCompany()
  }, [])

  const cov = useMemo(() => coverage(contacts), [contacts])
  const searches = useMemo(() => groupSearches(runs), [runs])
  const shortlisted = searches.reduce(
    (n, s) => n + s.runs[0].people.filter((p) => p.priority === 'High' || p.priority === 'Medium').length,
    0,
  )
  const imported = contacts.length > 0
  const collecting = imported && cov.percent < 100

  return (
    <div className="screen">
      <div className="screen-body">
        <Flex vertical gap={20} style={{ maxWidth: 1040, margin: '0 auto' }}>
          <Flex justify="space-between" align="flex-start" gap={12} wrap>
            <PageHeader title="Home" description="Import, collect web data, then search. In that order." />
            <Button type="primary" onClick={() => navigate('/results/new')} disabled={!imported}>
              New search
            </Button>
          </Flex>

          <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="section-title">Where you are</div>
            <Flex gap={12} wrap>
              <StepTile
                step="1 Import"
                state={imported ? 'Done' : 'Start here'}
                tone={imported ? 'done' : 'run'}
                value={contacts.length.toLocaleString()}
                note={lastImport ? `connections, ${relativeTime(lastImport.at)}` : 'connections'}
                onClick={() => navigate('/import')}
              />
              <StepTile
                step="2 Collect web data"
                state={!imported ? 'Waiting' : collecting ? 'Not finished' : 'Done'}
                tone={!imported ? 'idle' : collecting ? 'run' : 'done'}
                value={`${cov.percent}%`}
                note={<Progress percent={cov.percent} showInfo={false} size="small" />}
                onClick={() => navigate('/enrich')}
              />
              <StepTile
                step="3 Connections"
                state="With web data"
                tone="idle"
                value={cov.withData.toLocaleString()}
                note={`of ${contacts.length.toLocaleString()} people`}
                onClick={() => navigate('/')}
              />
              <StepTile
                step="4 Searches"
                state="Saved"
                tone="idle"
                value={searches.length.toLocaleString()}
                note={`${shortlisted.toLocaleString()} shortlisted`}
                onClick={() => navigate('/results')}
              />
            </Flex>
            {collecting && (
              <Alert
                type="warning"
                showIcon
                title={`Web data is not complete. A search now can only use what was found for ${cov.withData.toLocaleString()} of ${contacts.length.toLocaleString()} people.`}
                action={
                  <Button size="small" onClick={() => navigate('/enrich')}>
                    Collect now
                  </Button>
                }
              />
            )}
          </div>

          <div className="panel" style={{ padding: 0 }}>
            <Flex
              justify="space-between"
              align="center"
              style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}
            >
              <div className="section-title">Recent searches</div>
              <Button type="link" onClick={() => navigate('/results')}>
                See all
              </Button>
            </Flex>
            {searches.length === 0 ? (
              <div style={{ padding: 20, color: 'var(--text-3)' }}>No searches yet.</div>
            ) : (
              searches.slice(0, 5).map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => navigate('/results')}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 16,
                    width: '100%',
                    padding: '14px 20px',
                    border: 0,
                    borderTop: i ? '1px solid var(--border-subtle)' : undefined,
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{s.name}</b>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--text-3)' }}>
                      Last run {relativeTime(s.runs[0].at)}
                    </span>
                  </span>
                  <span className="num" style={{ whiteSpace: 'nowrap' }}>
                    {s.runs[0].people.filter((p) => p.priority === 'High' || p.priority === 'Medium').length}{' '}
                    shortlisted
                  </span>
                </button>
              ))
            )}
          </div>

          {companyAi && (
            <div className="panel" style={{ padding: '16px 20px' }}>
              <Flex justify="space-between" align="center" gap={12} wrap>
                <span>
                  <b style={{ color: 'var(--ink)', fontWeight: 500 }}>AI spend today</b>
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--text-3)' }}>
                    Work pauses at the limit and continues tomorrow
                  </span>
                </span>
                <span className="num">
                  <b>${companyAi.spentUsd.toFixed(2)}</b> of ${companyAi.capUsd.toFixed(2)}
                </span>
              </Flex>
            </div>
          )}
        </Flex>
      </div>
    </div>
  )
}
