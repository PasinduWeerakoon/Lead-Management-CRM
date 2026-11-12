import { Flex, Tag } from 'antd'
import type { Contact } from '../../lib/schemas'
import { techIn } from '../contacts/PersonPanel'

type Job = NonNullable<NonNullable<Contact['research']>['hiring']>[number]

/** The technologies and job kinds the prompt asks about, e.g. AWS, Azure, Testing / QA. */
export const promptTerms = (prompt: string) => new Set(techIn(prompt))

const jobTech = (j: Job) => [...new Set([...(j.skills ?? []), ...techIn(j.title), ...techIn(j.summary ?? '')])]
const matches = (names: string[], terms: Set<string>) =>
  names.filter((n) => terms.has(n) || [...terms].some((t) => techIn(n).includes(t)))

/** Open jobs at the person's company that touch what the prompt asks for, best matches first. */
export function opportunities(c: Contact | undefined, terms: Set<string>) {
  const r = c?.research?.status === 'found' ? c.research : undefined
  const jobs = (r?.hiring ?? [])
    .map((j) => ({ job: j, tech: jobTech(j), hit: matches(jobTech(j), terms) }))
    .filter((x) => (terms.size ? x.hit.length > 0 : x.tech.length > 0))
    .sort((a, b) => b.hit.length - a.hit.length)
  const companyTech = (r?.technologies ?? []).map((t) => t.name)
  return { jobs, companyTech, companyHits: matches(companyTech, terms), collected: !!c?.research }
}

/** Tags with the ones the prompt asked about highlighted. */
export function HighlightTags({ names, hits }: { names: string[]; hits: string[] }) {
  const on = new Set(hits)
  return (
    <Flex gap={4} wrap>
      {[...names]
        .sort((a, b) => Number(on.has(b)) - Number(on.has(a)))
        .map((n) => (
          <Tag key={n} color={on.has(n) ? 'green' : undefined} style={{ margin: 0, fontWeight: on.has(n) ? 600 : 400 }}>
            {n}
          </Tag>
        ))}
    </Flex>
  )
}

/** Short summary for the table: how many matching jobs and the first one. */
export function OpportunityCell({ c, terms }: { c?: Contact; terms: Set<string> }) {
  const o = opportunities(c, terms)
  if (!o.collected) return <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Company data not collected</span>
  if (!o.jobs.length && !o.companyHits.length)
    return <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No matching openings found</span>
  const hits = [...new Set([...o.jobs.flatMap((j) => j.hit), ...o.companyHits])]
  return (
    <Flex vertical gap={6}>
      {o.jobs.length > 0 && (
        <span style={{ fontSize: 13 }}>
          <b style={{ color: 'var(--success)' }}>
            {o.jobs.length} matching {o.jobs.length === 1 ? 'job' : 'jobs'}
          </b>
          <span style={{ color: 'var(--text-2)' }}> · {o.jobs[0].job.title}</span>
        </span>
      )}
      {hits.length > 0 && <HighlightTags names={hits} hits={hits} />}
    </Flex>
  )
}

/** Full list shown when a row is opened: each matching job and the company's technologies. */
export function OpportunityDetail({ c, terms }: { c?: Contact; terms: Set<string> }) {
  const o = opportunities(c, terms)
  return (
    <Flex vertical gap={14} style={{ padding: '4px 4px 8px' }}>
      <div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 6 }}>
          Matching open jobs at {c?.company ?? 'their company'}
        </div>
        {o.jobs.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {o.jobs.map(({ job: j, tech, hit }, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: 'var(--bg-header)',
                }}
              >
                <b style={{ color: 'var(--ink)' }}>{j.title}</b>
                {(j.level || j.type || j.location) && (
                  <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                    {[j.level, j.type, j.location].filter(Boolean).join(' · ')}
                  </span>
                )}
                {j.salary && <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>{j.salary}</span>}
                {j.summary && <span style={{ fontSize: 13 }}>{j.summary}</span>}
                {tech.length > 0 && <HighlightTags names={tech} hits={hit} />}
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {[j.source, j.postedAt && `posted ${j.postedAt}`].filter(Boolean).join(', ')}
                  {j.url && (
                    <>
                      {' · '}
                      <a href={j.url} target="_blank" rel="noreferrer">
                        Open job ad
                      </a>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {o.collected ? 'No open jobs match this prompt.' : 'Company data not collected yet.'}
          </span>
        )}
      </div>
      {o.companyTech.length > 0 && (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 6 }}>Technologies the company uses</div>
          <HighlightTags names={o.companyTech} hits={o.companyHits} />
        </div>
      )}
    </Flex>
  )
}
