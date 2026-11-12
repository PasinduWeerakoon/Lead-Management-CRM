import { useEffect, useState } from 'react'
import { Flex, Progress, Tag } from 'antd'
import type { Contact, ScoreRun } from '../../lib/schemas'
import { CORESIGNAL_ONLY } from '../../lib/research/coresignal'

interface Props {
  run: ScoreRun
  people: Map<string, Contact>
  shortlist: number
}

/** Per condition: how many people met it, failed it, or couldn't be checked for missing data. */
export function criterionCounts(run: ScoreRun) {
  return (run.criteria ?? []).map((criterion, i) => {
    let met = 0
    let notMet = 0
    let unknown = 0
    for (const p of run.people) {
      const ch = p.checks?.[i]
      if (!ch || ch.status === 'unknown') unknown++
      else if (ch.status === 'met') met++
      else notMet++
    }
    return { criterion, met, notMet, unknown }
  })
}

/** The most common "missing data" notes, so the gaps behind the results are visible. */
function topMissing(run: ScoreRun, n = 4) {
  const counts = new Map<string, number>()
  for (const p of run.people) if (p.missing) counts.set(p.missing, (counts.get(p.missing) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

function Bar({ met, notMet, unknown }: { met: number; notMet: number; unknown: number }) {
  const total = met + notMet + unknown || 1
  const w = (n: number) => `${(n / total) * 100}%`
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-hover)' }}>
      <span style={{ width: w(met), background: 'var(--success)' }} />
      <span style={{ width: w(notMet), background: '#d93025' }} />
      <span style={{ width: w(unknown), background: 'var(--warning)', opacity: 0.6 }} />
    </div>
  )
}

/**
 * Explains the results: how each condition came out across everyone, and which data was missing.
 * Titled "Why so few results" when the shortlist is small, because that's the question people ask.
 */
export function WhyPanel({ run, people, shortlist }: Props) {
  const counts = criterionCounts(run)
  const contacts = run.people.map((p) => people.get(p.id)).filter((c): c is Contact => !!c)
  const noProfile = contacts.filter((c) => c.web?.status !== 'found').length
  const noCompany = contacts.filter((c) => c.research?.status !== 'found').length
  const missing = topMissing(run)
  const few = shortlist < 5
  const [keyed, setKeyed] = useState<{ adzuna: boolean; hunter: boolean }>()
  useEffect(() => {
    void fetch('/api/sources?op=status')
      .then((r) => (r.ok ? r.json() : undefined))
      .then(setKeyed)
      .catch(() => undefined)
  }, [])
  // Coresignal mode has one source; the lists after it are the earlier sources, kept for switching back.
  const personSources = CORESIGNAL_ONLY
    ? ['Coresignal (licensed profiles, matched by LinkedIn URL)']
    : [
        'Company team and leadership pages',
        'News and press releases',
        'Conference, talk and podcast pages',
        'University and alumni pages',
        'GitHub',
        'Google Scholar and ORCID',
        'Patents',
        'Personal sites and blogs',
        'Public LinkedIn profiles (via search)',
        ...(keyed?.hunter ? ['Hunter.io (work email)'] : []),
      ]
  const companySources = CORESIGNAL_ONLY
    ? [
        'Coresignal (licensed company records and job posts)',
        'Company websites and careers pages (with their linked job boards)',
      ]
    : [
        'Company website',
        'Job boards (Greenhouse, Lever, Workable, Ashby, Workday)',
        'Web search (news, Crunchbase, partner directories)',
        'LinkedIn company pages and job posts (via search)',
        'SEC EDGAR',
        'Wikidata',
        ...(keyed?.adzuna ? ['Adzuna jobs'] : []),
      ]
  const notScored = Math.max(0, run.total - run.people.length)

  return (
    <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Flex justify="space-between" align="baseline" gap={12} wrap>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
          {few ? 'Why so few results' : 'How people were checked'}
        </h3>
        <span className="num" style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {shortlist} shortlisted of {run.people.length} checked
          {notScored ? ` · ${notScored} not scored` : ''}
        </span>
      </Flex>

      {counts.length > 0 && (
        <Flex vertical gap={10}>
          {counts.map((c, i) => (
            <Flex key={i} vertical gap={4}>
              <Flex justify="space-between" gap={12} wrap style={{ fontSize: 13.5 }}>
                <span style={{ flex: '1 1 300px' }}>
                  {i + 1}. {c.criterion}
                </span>
                <span className="num" style={{ fontSize: 12.5 }}>
                  <span style={{ color: 'var(--success)' }}>{c.met} met</span>
                  {' · '}
                  <span style={{ color: '#d93025' }}>{c.notMet} not met</span>
                  {' · '}
                  <span style={{ color: 'var(--warning)' }}>{c.unknown} unknown</span>
                </span>
              </Flex>
              <Bar met={c.met} notMet={c.notMet} unknown={c.unknown} />
            </Flex>
          ))}
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            “Unknown” means the data needed for that condition wasn’t found, not that the person failed it.
          </span>
        </Flex>
      )}

      <Flex gap={16} wrap>
        <Gap
          label="No web profile found"
          value={noProfile}
          total={contacts.length}
          note="Work history, degrees and projects can’t be checked for them."
          sources={personSources}
        />
        <Gap
          label="No company data found"
          value={noCompany}
          total={contacts.length}
          note="Jobs and technologies at their company can’t be checked."
          sources={companySources}
        />
      </Flex>

      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
        {CORESIGNAL_ONLY
          ? 'People data comes from Coresignal, company data from Coresignal plus each company’s own website. People without a LinkedIn URL in the export can’t be looked up.'
          : 'Public LinkedIn pages are included when the web search returns them. Never used: Indeed and Glassdoor.'}
      </span>

      {missing.length > 0 && (
        <Flex vertical gap={6}>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Most common reasons given by the AI</span>
          {missing.map(([text, n]) => (
            <Flex key={text} gap={10} style={{ fontSize: 13.5 }}>
              <span className="num" style={{ color: 'var(--text-3)', minWidth: 34 }}>
                {n}×
              </span>
              <span>{text}</span>
            </Flex>
          ))}
        </Flex>
      )}
    </div>
  )
}

function Gap(props: { label: string; value: number; total: number; note: string; sources: string[] }) {
  const { label, value, total, note, sources } = props
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Flex justify="space-between" style={{ fontSize: 13.5 }}>
        <span>{label}</span>
        <span className="num" style={{ color: pct > 50 ? 'var(--warning)' : 'var(--text-2)' }}>
          {value} of {total}
        </span>
      </Flex>
      <Progress percent={pct} showInfo={false} size="small" status={pct > 50 ? 'exception' : 'normal'} />
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{note}</span>
      <span style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Sources searched</span>
      <Flex gap={4} wrap>
        {sources.map((x) => (
          <Tag key={x} style={{ margin: 0, fontSize: 12 }}>
            {x}
          </Tag>
        ))}
      </Flex>
    </div>
  )
}
