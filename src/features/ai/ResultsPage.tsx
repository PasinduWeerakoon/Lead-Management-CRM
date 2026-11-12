import { useMemo, useState } from 'react'
import { App, Button, Empty, Flex, Input, Segmented, Tag, Typography } from 'antd'
import Papa from 'papaparse'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { DeleteOutlined, DownloadOutlined, SearchOutlined } from '../../components/icons'
import { PageHeader } from '../../components/PageHeader'
import { db } from '../../lib/db'
import { formatDate, relativeTime } from '../../lib/format'
import { downloadFile } from '../../lib/files'
import { neutralizeFormula, safeFileName } from '../../lib/export/rows'
import type { Contact, ScoreRun } from '../../lib/schemas'
import { OpportunityDetail, promptTerms } from './opportunities'
import { IssueList } from './PromptIssues'
import { ActivityLog } from './ActivityLog'
import { WhyPanel } from './WhyPanel'
import { ResultCard } from './ResultCard'

type Show = 'shortlist' | 'new' | 'partial' | 'low' | 'all'

/** Not shortlisted, but met at least one condition. */
const partlyMatched = (p: Person) => !onShortlist(p) && !!p.checks?.some((c) => c.status === 'met')
type Person = ScoreRun['people'][number]

/** One saved search: every run of the same prompt, newest first. */
interface Search {
  key: string
  name: string
  prompt: string
  runs: ScoreRun[]
}

export const onShortlist = (p: Person) => p.priority === 'High' || p.priority === 'Medium'
const PAGE = 20

/** Runs grouped by the prompt they used, so each prompt keeps its own history. */
export function groupSearches(runs: ScoreRun[]): Search[] {
  const map = new Map<string, Search>()
  for (const r of [...runs].sort((a, b) => b.at.localeCompare(a.at))) {
    const key = `${r.briefId}\u0000${r.briefText}`
    const s = map.get(key) ?? { key, name: r.briefName, prompt: r.briefText, runs: [] }
    s.runs.push(r)
    map.set(key, s)
  }
  return [...map.values()]
}

/** People on this run's shortlist who weren't on the previous run's. */
export function newSince(run: ScoreRun, previous?: ScoreRun): Set<string> {
  const before = new Set((previous?.people ?? []).filter(onShortlist).map((p) => p.id))
  return new Set(run.people.filter((p) => onShortlist(p) && !before.has(p.id)).map((p) => p.id))
}

/**
 * Searches: each prompt with its saved runs. A run shows the prompt's conditions and any problems
 * with it, why there are few results, and a card per person with every condition checked, the
 * reasoning and the matching opportunities. Running again adds a run; older runs are kept.
 */
export function ResultsPage() {
  const { modal } = App.useApp()
  const navigate = useNavigate()
  const runs = useLiveQuery(() => db.scoreRuns.toArray(), [], [] as ScoreRun[])
  const searches = useMemo(() => groupSearches(runs), [runs])
  const [openKey, setOpenKey] = useState<string>()
  const [runId, setRunId] = useState<string>()
  const [show, setShow] = useState<Show>('shortlist')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const search = searches.find((s) => s.key === openKey) ?? searches[0]
  const runIndex = Math.max(0, search?.runs.findIndex((r) => r.id === runId) ?? 0)
  const run = search?.runs[runIndex]
  const fresh = useMemo(
    () => (run ? newSince(run, search?.runs[runIndex + 1]) : new Set<string>()),
    [run, search, runIndex],
  )
  const ids = useMemo(() => run?.people.map((p) => p.id) ?? [], [run])
  const people = useLiveQuery(
    async () => new Map((await db.contacts.bulkGet(ids)).filter((c): c is Contact => !!c).map((c) => [c.id, c])),
    [ids],
    new Map<string, Contact>(),
  )
  const terms = useMemo(() => promptTerms(search?.prompt ?? ''), [search])

  const shortlist = run ? run.people.filter(onShortlist).length : 0
  const rows = useMemo(() => {
    if (!run) return []
    const needle = q.trim().toLowerCase()
    return run.people
      .filter((p) =>
        show === 'shortlist'
          ? onShortlist(p)
          : show === 'new'
            ? fresh.has(p.id)
            : show === 'partial'
              ? partlyMatched(p)
              : show === 'low'
                ? !onShortlist(p)
                : true,
      )
      .filter((p) => !needle || `${p.name} ${p.position ?? ''} ${p.company ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.score - a.score)
  }, [run, show, q, fresh])

  const exportCsv = () => {
    if (!run) return
    const data = rows.map((p) =>
      [
        p.name,
        p.position ?? '',
        p.company ?? '',
        String(p.score),
        p.reason,
        (p.checks ?? []).map((c) => `${c.criterion}: ${c.status}`).join(' | '),
        p.missing ?? '',
      ].map(neutralizeFormula),
    )
    const csv = Papa.unparse({
      fields: ['Name', 'Title', 'Company', 'AI score', 'AI reasoning', 'Conditions', 'Missing data'],
      data,
    })
    downloadFile('﻿' + csv, `${safeFileName(`${run.briefName} ${run.at.slice(0, 10)}`)}.csv`, 'text/csv;charset=utf-8')
  }

  const removeRun = (r: ScoreRun) =>
    modal.confirm({
      title: 'Delete this run?',
      content: `The ${formatDate(r.at)} run of “${r.briefName}” is removed. Other runs, your connections and web data stay.`,
      okText: 'Delete run',
      okButtonProps: { danger: true },
      onOk: async () => {
        await db.scoreRuns.delete(r.id)
        setRunId(undefined)
      },
    })

  const pick = (key: string) => {
    setOpenKey(key)
    setRunId(undefined)
    setShow('shortlist')
    setLimit(PAGE)
  }

  return (
    <div className="screen">
      <div className="screen-body">
        <Flex vertical gap={20} style={{ maxWidth: 1240, margin: '0 auto' }}>
          <Flex justify="space-between" align="flex-start" gap={12} wrap>
            <PageHeader
              title="Searches"
              description="Each prompt keeps every run. Open a run to see who matched, why, and what openings their company has."
            />
            <Button type="primary" onClick={() => navigate('/results/new')}>
              New search
            </Button>
          </Flex>

          {!search || !run ? (
            <div className="panel" style={{ padding: 40 }}>
              <Empty description="No searches yet. Collect web data first, then start a new search." />
            </div>
          ) : (
            <Flex gap={20} align="flex-start" wrap>
              <nav
                aria-label="Saved searches"
                className="panel"
                style={{ flex: '1 1 240px', maxWidth: 300, minWidth: 0 }}
              >
                {searches.map((s, i) => {
                  const active = s.key === search.key
                  const latest = s.runs[0]
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => pick(s.key)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        width: '100%',
                        textAlign: 'left',
                        padding: '12px 16px',
                        border: 0,
                        borderTop: i ? '1px solid var(--border-subtle)' : undefined,
                        background: active ? 'var(--primary-soft)' : 'transparent',
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'inherit',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        {latest.people.filter(onShortlist).length} shortlisted · {s.runs.length}{' '}
                        {s.runs.length === 1 ? 'run' : 'runs'} · {relativeTime(latest.at)}
                      </span>
                    </button>
                  )
                })}
              </nav>

              <section style={{ flex: '3 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 1. What was asked */}
                <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Flex justify="space-between" align="flex-start" gap={12} wrap>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{search.name}</h2>
                    <Flex gap={8}>
                      <Button onClick={() => navigate(`/results/new?search=${run.briefId}`)}>Edit and run again</Button>
                      <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>
                        Export
                      </Button>
                      <Button icon={<DeleteOutlined />} onClick={() => removeRun(run)} aria-label="Delete this run" />
                    </Flex>
                  </Flex>
                  <Typography.Paragraph
                    ellipsis={{ rows: 3, expandable: true, symbol: 'Show all' }}
                    style={{ margin: 0, whiteSpace: 'pre-line', color: 'var(--text-2)' }}
                  >
                    {search.prompt}
                  </Typography.Paragraph>
                  {!!run.criteria?.length && (
                    <Flex vertical gap={6}>
                      <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Conditions checked for each person</span>
                      {run.criteria.map((c, i) => (
                        <Flex key={i} gap={8} align="baseline">
                          <Tag style={{ margin: 0 }}>{i + 1}</Tag>
                          <span style={{ fontSize: 13.5 }}>{c}</span>
                        </Flex>
                      ))}
                    </Flex>
                  )}
                  {!!run.promptIssues?.length && <IssueList issues={run.promptIssues} />}
                  <Flex gap={6} align="center" wrap>
                    <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Runs</span>
                    {search.runs.map((r) => (
                      <Tag.CheckableTag
                        key={r.id}
                        checked={r.id === run.id}
                        onChange={() => {
                          setRunId(r.id)
                          setShow('shortlist')
                          setLimit(PAGE)
                        }}
                      >
                        {formatDate(r.at)} · {r.people.filter(onShortlist).length}
                      </Tag.CheckableTag>
                    ))}
                    {run.refreshed && (
                      <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                        · Web data refreshed for {run.refreshed.companies} companies and {run.refreshed.people} people
                        before this run
                      </span>
                    )}
                  </Flex>
                </div>

                {!!run.log?.length && (
                  <div className="panel" style={{ padding: '14px 18px' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 6 }}>How this search ran</div>
                    <ActivityLog key={run.id} steps={run.log} />
                  </div>
                )}

                {/* 2. Why the results look like this */}
                <WhyPanel run={run} people={people} shortlist={shortlist} />

                {/* 3. Who matched */}
                <Flex gap={8} wrap align="center">
                  <Segmented<Show>
                    value={show}
                    onChange={(v) => {
                      setShow(v)
                      setLimit(PAGE)
                    }}
                    options={[
                      { value: 'shortlist', label: `Shortlisted ${shortlist}` },
                      { value: 'new', label: `New ${fresh.size}` },
                      { value: 'partial', label: `Partly matched ${run.people.filter(partlyMatched).length}` },
                      {
                        value: 'low',
                        label: `Not a match ${run.people.filter((p) => !onShortlist(p)).length}`,
                      },
                      { value: 'all', label: `All ${run.people.length}` },
                    ]}
                  />
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="Search name, title or company"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    style={{ maxWidth: 280 }}
                  />
                </Flex>

                {rows.length === 0 ? (
                  <div className="panel" style={{ padding: 24, color: 'var(--text-3)' }}>
                    {show === 'shortlist'
                      ? 'Nobody matched this prompt in this run. See “Why so few results” above for the reasons.'
                      : 'Nobody in this group.'}
                  </div>
                ) : (
                  rows
                    .slice(0, limit)
                    .map((p) => (
                      <ResultCard
                        key={p.id}
                        person={p}
                        contact={people.get(p.id)}
                        isNew={fresh.has(p.id)}
                        opportunities={<OpportunityDetail c={people.get(p.id)} terms={terms} />}
                      />
                    ))
                )}
                {rows.length > limit && (
                  <Button onClick={() => setLimit((l) => l + PAGE)} style={{ alignSelf: 'center' }}>
                    Show {Math.min(PAGE, rows.length - limit)} more
                  </Button>
                )}
              </section>
            </Flex>
          )}
        </Flex>
      </div>
    </div>
  )
}
