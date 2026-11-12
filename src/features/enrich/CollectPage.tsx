import { useMemo, useState } from 'react'
import { Alert, Button, Empty, Flex, Progress } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { db } from '../../lib/db'
import type { Contact } from '../../lib/schemas'
import { ResearchModal } from './ResearchModal'
import { PersonWebModal } from './PersonWebModal'
import { CORESIGNAL_ONLY } from '../../lib/research/coresignal'

/** Per-stage counts of what has been collected so far. */
export function collectStats(contacts: Contact[]) {
  const companies = new Map<string, Contact['research']>()
  for (const c of contacts) {
    const key = c.company?.trim().toLowerCase()
    if (!key) continue
    if (!companies.has(key) || (c.research && !companies.get(key))) companies.set(key, c.research)
  }
  const research = [...companies.values()]
  const found = research.filter((r) => r?.status === 'found')
  return {
    companies: companies.size,
    sitesChecked: research.filter(Boolean).length,
    sitesFound: found.length,
    noSite: research.filter((r) => r?.status === 'no_site').length,
    hiring: found.filter((r) => (r?.hiring?.length ?? 0) > 0).length,
    jobs: found.reduce((n, r) => n + (r?.hiring?.length ?? 0), 0),
    tech: found.filter((r) => (r?.technologies?.length ?? 0) > 0).length,
    people: contacts.length,
    peopleChecked: contacts.filter((c) => !!c.web).length,
    profilesFound: contacts.filter((c) => c.web?.status === 'found').length,
    liCompaniesChecked: research.filter((r) => !!r?.linkedinAt).length,
    liJobs: found.reduce((n, r) => n + (r?.hiring?.filter((j) => j.source === 'LinkedIn').length ?? 0), 0),
    liPeopleChecked: contacts.filter((c) => !!c.web?.linkedinAt).length,
    liProfiles: contacts.filter(
      (c) => c.web?.status === 'found' && (c.web.sources ?? []).some((u) => /linkedin\.com/.test(u)),
    ).length,
    pastJobsFound: contacts.filter((c) => (c.web?.career?.length ?? 0) > 0).length,
  }
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

function Stage(props: { title: string; note: string; done: number; total: number; result: string }) {
  const p = pct(props.done, props.total)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(120px, 1.2fr) minmax(0, 1.2fr)',
        gap: 16,
        alignItems: 'center',
        padding: '14px 20px',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <span style={{ minWidth: 0 }}>
        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{props.title}</b>
        <span style={{ display: 'block', fontSize: 13, color: 'var(--text-3)' }}>{props.note}</span>
      </span>
      <Progress percent={p} size="small" status={p === 100 ? 'success' : 'normal'} />
      <span className="num" style={{ fontSize: 13 }}>
        {props.result}
      </span>
    </div>
  )
}

/**
 * Step 2. Collects company websites, open jobs, technologies and people's past jobs from the public
 * web. Searches only read what is collected here, so this comes before searching.
 */
export function CollectPage() {
  const navigate = useNavigate()
  const loaded = useLiveQuery(() => db.contacts.toArray())
  const contacts = useMemo(() => loaded ?? [], [loaded])
  const s = useMemo(() => collectStats(contacts), [contacts])
  const [params, setParams] = useSearchParams()
  // "Collect everything" runs companies first, then people.
  const [thenPeople, setThenPeople] = useState(() => params.get('start') === '1')
  const [running, setRunning] = useState<'companies' | 'people' | undefined>(() =>
    params.get('start') === '1' ? 'companies' : undefined,
  )
  // After an import, or "Collect everything": no extra clicks, each step starts and hands over by itself.
  const [auto, setAuto] = useState(() => params.get('start') === '1')

  const overall = pct(s.sitesChecked + s.peopleChecked, s.companies + s.people)

  return (
    <div className="screen">
      <div className="screen-body">
        <Flex vertical gap={20} style={{ maxWidth: 1040, margin: '0 auto' }}>
          <Flex justify="space-between" align="flex-start" gap={12} wrap>
            <PageHeader
              title="Collect web data"
              description="Searches only use what is collected here. Do this after every import, before searching."
            />
            <Flex gap={8} wrap>
              <Button onClick={() => setRunning('companies')} disabled={!contacts.length}>
                Companies only
              </Button>
              <Button onClick={() => setRunning('people')} disabled={!contacts.length}>
                People only
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  setThenPeople(true)
                  setAuto(true)
                  setRunning('companies')
                }}
                disabled={!contacts.length}
              >
                Collect everything
              </Button>
            </Flex>
          </Flex>

          {!loaded ? null : !contacts.length ? (
            <div className="panel" style={{ padding: 40 }}>
              <Empty description="Import your connections first.">
                <Button type="primary" onClick={() => navigate('/import')}>
                  Go to Import
                </Button>
              </Empty>
            </div>
          ) : (
            <>
              <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Flex justify="space-between" align="baseline" gap={12} wrap>
                  <b className="num" style={{ fontSize: 24, color: 'var(--ink)' }}>
                    {overall}% collected
                  </b>
                  <span style={{ color: 'var(--text-3)' }}>
                    {s.companies.toLocaleString()} companies · {s.people.toLocaleString()} people
                  </span>
                </Flex>
                <Progress percent={overall} showInfo={false} />
                {overall < 100 && (
                  <Alert
                    type="warning"
                    showIcon
                    title="Keep this tab open while collecting. A search run before this finishes only checks people who already have data."
                  />
                )}
              </div>

              <div className="panel" style={{ padding: 0 }}>
                <div style={{ padding: '14px 20px' }} className="section-title">
                  What has been collected
                </div>
                <Stage
                  title={CORESIGNAL_ONLY ? 'Company records' : 'Company websites'}
                  note={
                    CORESIGNAL_ONLY
                      ? 'Coresignal records, each company’s own site and careers pages, SEC EDGAR and Wikidata'
                      : "Find and confirm each company's site"
                  }
                  done={s.sitesChecked}
                  total={s.companies}
                  result={`${s.sitesFound.toLocaleString()} found of ${s.companies.toLocaleString()}`}
                />
                <Stage
                  title="Open jobs"
                  note={
                    CORESIGNAL_ONLY
                      ? 'Open job posts from Coresignal'
                      : 'Careers pages, Greenhouse, Lever, Workable, Ashby'
                  }
                  done={s.sitesFound}
                  total={s.companies}
                  result={`${s.jobs.toLocaleString()} jobs at ${s.hiring.toLocaleString()} companies`}
                />
                <Stage
                  title="Technologies"
                  note={
                    CORESIGNAL_ONLY
                      ? 'Technologies each company uses, from Coresignal'
                      : 'From company sites and job ads'
                  }
                  done={s.sitesFound}
                  total={s.companies}
                  result={`${s.tech.toLocaleString()} companies`}
                />
                {/* Off in Coresignal mode: its data already includes LinkedIn-sourced profiles and job posts. */}
                {!CORESIGNAL_ONLY && (
                  <>
                    <Stage
                      title="LinkedIn job posts"
                      note="Public job posts and company pages, found by web search"
                      done={s.liCompaniesChecked}
                      total={s.companies}
                      result={`${s.liJobs.toLocaleString()} job posts`}
                    />
                    <Stage
                      title="LinkedIn profiles"
                      note="Public profiles, found by web search (never logs in)"
                      done={s.liPeopleChecked}
                      total={s.people}
                      result={`${s.liProfiles.toLocaleString()} profiles found`}
                    />
                  </>
                )}
                <Stage
                  title="People's profiles"
                  note={
                    CORESIGNAL_ONLY
                      ? 'Work history, degrees and campus, certifications, skills, from Coresignal by LinkedIn URL'
                      : 'Work experience, degrees and campus, projects, certifications, skills'
                  }
                  done={s.peopleChecked}
                  total={s.people}
                  result={`${s.pastJobsFound.toLocaleString()} people found`}
                />
              </div>

              <div className="panel" style={{ padding: 0 }}>
                <div style={{ padding: '14px 20px' }} className="section-title">
                  Needs your help
                </div>
                <Flex
                  justify="space-between"
                  align="center"
                  gap={12}
                  wrap
                  style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)' }}
                >
                  <span>
                    <b className="num">{s.noSite.toLocaleString()}</b> companies have no website we could confirm
                  </span>
                  <Button onClick={() => navigate('/enrich/csv')}>Add data from a CSV</Button>
                </Flex>
              </div>

              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
                {CORESIGNAL_ONLY
                  ? 'People and company data comes from Coresignal, a licensed data provider. The app also reads each employer’s own website, careers pages and linked job boards, and checks SEC EDGAR and Wikidata. It runs no web or LinkedIn searches.'
                  : 'Every fact is saved with the page it came from. Public LinkedIn pages are used when a web search finds them. Indeed and Glassdoor are never read.'}
              </p>
            </>
          )}
        </Flex>
      </div>

      {running === 'companies' && loaded && (
        <ResearchModal
          shown={contacts}
          selected={[]}
          autoStart={auto}
          autoClose={auto && thenPeople}
          onClose={() => {
            setRunning(thenPeople ? 'people' : undefined)
            setThenPeople(false)
            setParams({}, { replace: true })
          }}
        />
      )}
      {running === 'people' && (
        <PersonWebModal
          shown={contacts}
          selected={[]}
          autoStart={auto}
          onClose={() => {
            setRunning(undefined)
            setAuto(false)
          }}
        />
      )}
    </div>
  )
}
