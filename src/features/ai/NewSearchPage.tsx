import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Flex, Input, Progress, Radio, Tag } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { db } from '../../lib/db'
import type { Brief, Contact, LogStep, PromptIssue } from '../../lib/schemas'
import { runScoring } from '../../lib/ai/run-scoring'
import { checkPrompt } from '../../lib/ai/prompt-check'
import { PLACEHOLDER_COMPANY, planResearch, runResearch } from '../../lib/research/run'
import { planWeb, runWeb } from '../../lib/research/run-person'
import { planLinkedIn, runLinkedInStep } from '../../lib/research/linkedin-step'
import { CORESIGNAL_ONLY } from '../../lib/research/coresignal'
import { AiError } from '../../lib/ai/provider'
import { collectStats } from '../enrich/CollectPage'
import { checkBudget, useAi } from './store'
import { IssueList } from './PromptIssues'
import { ActivityLog, kindOf } from './ActivityLog'

type Who = 'all' | 'with-data'

const DAY = 86_400_000
const hasWebData = (c: Contact) => c.research?.status === 'found' || c.web?.status === 'found'
const older = (at: string | undefined, days: number) => !at || Date.now() - Date.parse(at) > days * DAY
/** Company data older than a week (jobs change fast) or people data older than a month is re-collected. */
export const staleCompany = (c: Contact) =>
  !!c.company && !PLACEHOLDER_COMPANY.test(c.company) && (!c.research || older(c.research.at, 7))
export const stalePerson = (c: Contact) => !c.web || c.web.status === 'error' || older(c.web.at, 30)

interface Status {
  step: 'check' | 'companies' | 'people' | 'linkedin' | 'scoring'
  done: number
  total: number
  note?: string
}

const STEP_LABEL: Record<Status['step'], string> = {
  check: 'Checking the prompt',
  companies: 'Refreshing company data, jobs and technologies',
  linkedin: 'Searching LinkedIn for job posts and profiles',
  people: 'Refreshing people’s profiles',
  scoring: 'Scoring people against each condition',
}

/**
 * Step 4a. The prompt is checked and split into conditions, web data for the people in scope is
 * refreshed, then everyone is scored against each condition. The run is saved under this search.
 */
export function NewSearchPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { key, settings, status } = useAi()
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], [] as Contact[])
  const existing = useLiveQuery(() => {
    const id = params.get('search')
    return id ? db.briefs.get(id) : undefined
  }, [params])

  const [name, setName] = useState<string>()
  const [prompt, setPrompt] = useState<string>()
  const [who, setWho] = useState<Who>('all')
  const [refresh, setRefresh] = useState(true)
  const [checked, setChecked] = useState<{
    prompt: string
    criteria: string[]
    issues: PromptIssue[]
    suggestedPrompt?: string
  }>()
  const [running, setRunning] = useState<Status>()
  const [error, setError] = useState<string>()
  const abort = useRef<AbortController | null>(null)
  // Every step of the run, shown live and saved with it.
  const logRef = useRef<LogStep[]>([])
  const [log, setLog] = useState<LogStep[]>([])
  const step = (kind: LogStep['kind'], text?: string) => {
    if (!text || logRef.current.at(-1)?.text === text) return
    logRef.current = [
      ...logRef.current,
      { at: new Date().toISOString(), kind: kindOf(text, kind), text: text.slice(0, 300) },
    ].slice(-400)
    setLog(logRef.current)
  }

  const nameValue = name ?? existing?.name ?? ''
  const promptValue = prompt ?? existing?.text ?? ''
  const stats = useMemo(() => collectStats(contacts), [contacts])
  const people = who === 'all' ? contacts : contacts.filter(hasWebData)
  const staleCo = new Set(people.filter(staleCompany).map((c) => c.company!.trim().toLowerCase())).size
  const stalePeople = people.filter(stalePerson).length
  const upToDate = checked?.prompt === promptValue.trim()
  const blocked = !!checked?.issues.some((i) => i.severity === 'error') && upToDate

  /** Checks the prompt and returns the result, or undefined when the check couldn't run. */
  const runCheck = async (keepRunning = false) => {
    if (!key) return undefined
    setError(undefined)
    setRunning({ step: 'check', done: 0, total: 1 })
    if (!keepRunning) logRef.current = []
    step('check', 'Reading the prompt and splitting it into conditions')
    try {
      const res = await checkPrompt({
        apiKey: key,
        model: settings.model,
        effort: settings.effort,
        prompt: promptValue,
      })
      const result = {
        prompt: promptValue.trim(),
        criteria: res.criteria,
        issues: res.issues,
        suggestedPrompt: res.suggestedPrompt,
      }
      setChecked(result)
      step(
        'check',
        res.criteria.length
          ? `Will check ${res.criteria.length} ${res.criteria.length === 1 ? 'condition' : 'conditions'}: ${res.criteria.join('; ')}`
          : 'No checkable conditions found',
      )
      if (res.issues.length)
        step('check', `${res.issues.length} note${res.issues.length === 1 ? '' : 's'} on the prompt`)
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t check the prompt.')
      return undefined
    } finally {
      if (!keepRunning) setRunning(undefined)
    }
  }

  const run = async () => {
    if (!key) return
    logRef.current = []
    setLog([])
    // A new or edited prompt is checked first, automatically. Only a real error stops the run.
    const check = upToDate && checked ? checked : await runCheck(true)
    if (!check) {
      setRunning(undefined)
      return
    }
    if (check.issues.some((i) => i.severity === 'error')) {
      setRunning(undefined)
      setError('The prompt needs fixing before it can run. See the problems listed above.')
      return
    }
    setError(undefined)
    abort.current = new AbortController()
    const signal = abort.current.signal
    const refreshed = { companies: 0, people: 0 }
    try {
      if (refresh) {
        const { companies } = planResearch(people.filter(staleCompany), true)
        step(
          'registry',
          `${companies.length} companies and ${people.filter(stalePerson).length} people need fresh web data`,
        )
        if (companies.length) {
          setRunning({ step: 'companies', done: 0, total: companies.length })
          const r = await runResearch({
            apiKey: key,
            model: settings.model,
            effort: settings.effort,
            companies,
            signal,
            beforeCall: checkBudget,
            onProgress: (p) => {
              setRunning({ step: 'companies', done: p.done, total: p.total, note: p.step })
              step('company', p.step)
            },
            ...(!CORESIGNAL_ONLY && settings.provider === 'openai' ? { web: { provider: settings.provider } } : {}),
          })
          refreshed.companies = r.done
          if (r.stopped) throw new AiError(r.stopped, 'other')
        }
        const toSearch = planWeb(people.filter(stalePerson), true)
        if (toSearch.length && (CORESIGNAL_ONLY || settings.provider === 'openai')) {
          setRunning({ step: 'people', done: 0, total: toSearch.length })
          const w = await runWeb({
            apiKey: key,
            provider: settings.provider,
            people: toSearch,
            signal,
            beforeEach: checkBudget,
            onProgress: (p) => {
              setRunning({ step: 'people', done: p.done, total: p.total })
              step('person', p.step)
            },
          })
          refreshed.people = w.done
          if (w.stopped) throw new AiError(w.stopped, 'other')
        }
      }

      // LinkedIn, every time: public job posts for each company and public profiles for each person,
      // found by web search. Skips what was searched recently. Off in Coresignal mode, which already
      // has LinkedIn-sourced profiles and job posts under licence.
      if (!CORESIGNAL_ONLY && settings.provider === 'openai') {
        const fresh0 = (await db.contacts.bulkGet(people.map((c) => c.id))).filter((c): c is Contact => !!c)
        const plan = planLinkedIn(fresh0)
        const total = plan.companies.length + plan.people.length
        step(
          'linkedin',
          total
            ? `Searching public LinkedIn job posts for ${plan.companies.length} ${plan.companies.length === 1 ? 'company' : 'companies'} and profiles for ${plan.people.length} ${plan.people.length === 1 ? 'person' : 'people'}`
            : 'LinkedIn already searched recently for everyone in this search',
        )
        let done = 0
        if (total) {
          setRunning({ step: 'linkedin', done: 0, total })
          await runLinkedInStep({
            apiKey: key,
            provider: settings.provider,
            plan,
            signal,
            beforeEach: checkBudget,
            onStep: (text) => {
              done++
              setRunning({ step: 'linkedin', done, total })
              step('linkedin', text)
            },
          })
        }
      }

      const now = new Date().toISOString()
      const brief: Brief =
        existing && existing.text === promptValue.trim()
          ? { ...existing, name: nameValue.trim() || existing.name, updatedAt: now }
          : {
              id: crypto.randomUUID(),
              name: nameValue.trim() || promptValue.trim().slice(0, 60),
              text: promptValue.trim(),
              createdAt: now,
              updatedAt: now,
            }
      await db.briefs.put(brief)
      // Score with the data just collected.
      const fresh = (await db.contacts.bulkGet(people.map((c) => c.id))).filter((c): c is Contact => !!c)
      setRunning({ step: 'scoring', done: 0, total: fresh.length })
      step('score', `Scoring ${fresh.length} people against each condition`)
      const result = await runScoring({
        apiKey: key,
        model: settings.model,
        effort: settings.effort,
        brief,
        criteria: check.criteria,
        promptIssues: check.issues,
        refreshed: refresh ? refreshed : undefined,
        people: fresh,
        signal,
        onProgress: (p) => {
          setRunning({ step: 'scoring', done: p.scored, total: p.total })
          // Progress arrives at the start and end of each batch; one line per new total is enough.
          if (p.scored) step('score', `Scored ${p.scored} of ${p.total} people`)
        },
        log: logRef.current,
        beforeBatch: checkBudget,
      })
      if (result.stopped && result.scored === 0) throw new AiError(result.stopped, 'other')
      step('done', `Done: ${result.scored} people scored${result.stopped ? ` (${result.stopped})` : ''}`)
      // Save the final steps with the run that was just made.
      const latest = (await db.scoreRuns.where('briefId').equals(brief.id).toArray()).sort((a, b) =>
        b.at.localeCompare(a.at),
      )[0]
      if (latest) await db.scoreRuns.update(latest.id, { log: logRef.current })
      navigate('/results')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The search stopped.')
      setRunning(undefined)
    }
  }

  const pct = running?.total ? Math.round((running.done / running.total) * 100) : 0

  return (
    <div className="screen">
      <div className="screen-body">
        <Flex vertical gap={20} style={{ maxWidth: 860, margin: '0 auto' }}>
          <div>
            <Button type="link" onClick={() => navigate('/results')} style={{ padding: 0 }}>
              Back to searches
            </Button>
            <PageHeader
              title={existing ? 'Run search again' : 'New search'}
              description="Write who you want. The prompt is checked first, web data is refreshed, then every person is scored against each condition."
            />
          </div>

          <Flex vertical gap={6}>
            <label htmlFor="search-name" style={{ fontSize: 13, color: 'var(--text-2)' }}>
              Name
            </label>
            <Input
              id="search-name"
              value={nameValue}
              onChange={(e) => setName(e.target.value)}
              placeholder="For example: Sysco LABS alumni at hiring companies"
              maxLength={80}
              disabled={!!running}
            />
          </Flex>
          <Flex vertical gap={6}>
            <label htmlFor="search-prompt" style={{ fontSize: 13, color: 'var(--text-2)' }}>
              Prompt
            </label>
            <Input.TextArea
              id="search-prompt"
              value={promptValue}
              onChange={(e) => setPrompt(e.target.value)}
              autoSize={{ minRows: 4, maxRows: 10 }}
              maxLength={4000}
              disabled={!!running}
              placeholder="For example: People who worked at Sysco LABS Sri Lanka and whose current company is hiring AWS, Azure or testing engineers."
            />
            <Flex justify="flex-end">
              <Button onClick={() => void runCheck()} disabled={status !== 'ready' || !promptValue.trim() || !!running}>
                {upToDate ? 'Check again' : 'Check prompt'}
              </Button>
            </Flex>
          </Flex>

          {checked && upToDate && (
            <div className="panel" style={{ padding: 0 }}>
              <div className="section-title" style={{ padding: '14px 20px' }}>
                What will be checked for each person
              </div>
              {checked.criteria.length ? (
                checked.criteria.map((c, i) => (
                  <Flex key={i} gap={10} style={{ padding: '10px 20px', borderTop: '1px solid var(--border-subtle)' }}>
                    <Tag style={{ margin: 0 }}>{i + 1}</Tag>
                    <span>{c}</span>
                  </Flex>
                ))
              ) : (
                <div style={{ padding: '10px 20px', color: 'var(--text-3)' }}>No clear conditions found.</div>
              )}
              {checked.issues.length > 0 && (
                <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)' }}>
                  <IssueList issues={checked.issues} />
                </div>
              )}
              {checked.suggestedPrompt && (
                <div
                  style={{
                    padding: '14px 20px',
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                    A version of your prompt that can be checked
                  </span>
                  <span style={{ background: 'var(--bg-hover)', borderRadius: 8, padding: '10px 12px' }}>
                    {checked.suggestedPrompt}
                  </span>
                  <Button
                    style={{ alignSelf: 'flex-start' }}
                    onClick={() => {
                      setPrompt(checked.suggestedPrompt)
                      setChecked(undefined)
                    }}
                  >
                    Use this prompt
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="panel" style={{ padding: 0 }}>
            <div className="section-title" style={{ padding: '14px 20px' }}>
              Data available now
            </div>
            <Flex
              justify="space-between"
              gap={16}
              wrap
              style={{ padding: '10px 20px', borderTop: '1px solid var(--border-subtle)' }}
            >
              <span>People with a web profile</span>
              <span className="num">
                {stats.profilesFound.toLocaleString()} of {stats.people.toLocaleString()}
              </span>
            </Flex>
            <Flex
              justify="space-between"
              gap={16}
              wrap
              style={{ padding: '10px 20px', borderTop: '1px solid var(--border-subtle)' }}
            >
              <span>Companies with jobs and details</span>
              <span className="num">
                {stats.sitesFound.toLocaleString()} of {stats.companies.toLocaleString()}
              </span>
            </Flex>
          </div>

          <Flex vertical gap={10}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Who to check</span>
            <Radio.Group value={who} onChange={(e) => setWho(e.target.value as Who)} disabled={!!running}>
              <Radio value="all">All connections ({contacts.length.toLocaleString()})</Radio>
              <Radio value="with-data">
                Only people with web data ({contacts.filter(hasWebData).length.toLocaleString()})
              </Radio>
            </Radio.Group>
            <Checkbox checked={refresh} onChange={(e) => setRefresh(e.target.checked)} disabled={!!running}>
              Search the web again first: {staleCo.toLocaleString()} companies and {stalePeople.toLocaleString()} people
              have missing or old data
            </Checkbox>
            {refresh && staleCo + stalePeople > 200 && (
              <Alert
                type="warning"
                showIcon
                title="That’s a lot of web searches. It can take a while and use much of today’s AI limit. Work already collected is kept if it stops."
              />
            )}
          </Flex>

          {status !== 'ready' && (
            <Alert type="warning" showIcon title="AI isn’t set up on the server yet, so searches can’t run." />
          )}
          {error && <Alert type="error" showIcon title={error} />}
          {running && (
            <div className="panel" style={{ padding: 16 }}>
              <div style={{ marginBottom: 6 }}>
                {STEP_LABEL[running.step]}: {running.done.toLocaleString()} of {running.total.toLocaleString()}
                {running.note && <span style={{ color: 'var(--text-3)' }}> · {running.note}</span>}
              </div>
              <Progress percent={pct} />
              <div style={{ marginTop: 10 }}>
                <ActivityLog steps={log} live />
              </div>
            </div>
          )}

          <Flex justify="flex-end" gap={10}>
            {running ? (
              <Button onClick={() => abort.current?.abort()}>Stop</Button>
            ) : (
              <Button onClick={() => navigate('/results')}>Cancel</Button>
            )}
            <Button
              type="primary"
              onClick={() => void run()}
              loading={!!running}
              disabled={status !== 'ready' || blocked || !promptValue.trim() || !people.length || !!running}
            >
              Save and run
            </Button>
          </Flex>
        </Flex>
      </div>
    </div>
  )
}
