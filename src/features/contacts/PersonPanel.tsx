import { useState } from 'react'
import { Button, Flex, Input, Select, Tabs, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { updateContact } from '../../lib/contacts'
import { STATUSES, type Contact, type LeadStatus, type ScoreRun } from '../../lib/schemas'
import { STATUS_META } from '../../components/tags'
import { formatDate } from '../../lib/format'
import { PersonWebModal } from '../enrich/PersonWebModal'
import { ResearchModal } from '../enrich/ResearchModal'
import { IconBriefcase, IconBuildingOff, IconBuildingSkyscraper, IconSearch, IconWorldOff } from '@tabler/icons-react'

/** Technologies we recognise in a job title, e.g. "Software Engineer - NET Azure" gives .NET and Azure. */
const TECH: Array<[string, RegExp]> = [
  ['AWS', /\b(aws|amazon web services)\b/i],
  ['Azure', /\bazure\b/i],
  ['GCP', /\b(gcp|google cloud)\b/i],
  ['.NET', /(\.net\b|\bnet core\b|\bdotnet\b|\bnet azure\b|\b c#|\bc#)/i],
  ['Java', /\bjava\b/i],
  ['Python', /\bpython\b/i],
  ['JavaScript', /\b(javascript|js)\b/i],
  ['TypeScript', /\btypescript\b/i],
  ['React', /\breact\b/i],
  ['Angular', /\bangular\b/i],
  ['Node.js', /\bnode(\.js|js)?\b/i],
  ['PHP', /\bphp\b/i],
  ['Go', /\bgolang\b/i],
  ['Kotlin', /\bkotlin\b/i],
  ['Swift', /\bswift\b/i],
  ['Flutter', /\bflutter\b/i],
  ['SQL', /\b(sql|mysql|postgres(ql)?|oracle db)\b/i],
  ['Salesforce', /\bsalesforce\b/i],
  ['SAP', /\bsap\b/i],
  ['Dynamics 365', /\bdynamics\b/i],
  ['DevOps', /\bdevops\b/i],
  ['Kubernetes', /\b(kubernetes|k8s)\b/i],
  ['Docker', /\bdocker\b/i],
  ['Data', /\b(data engineer|data scientist|data analyst|big data)\b/i],
  ['AI / ML', /\b(ai|ml|machine learning|artificial intelligence|genai|llm)\b/i],
  ['Testing / QA', /\b(qa|quality assurance|test(ing)?|sdet)\b/i],
  ['Automation', /\bautomation\b/i],
  ['Full-stack', /\bfull[- ]?stack\b/i],
  [
    'Software development',
    /\b(software (development|engineer(ing)?|developer)|developer|programmer|frontend|front-end|backend|back-end)\b/i,
  ],
  ['Cyber security', /\b(cyber ?security|security engineer|infosec)\b/i],
]
export const techIn = (title: string) => TECH.filter(([, re]) => re.test(title)).map(([name]) => name)

function TechChips({ names }: { names: string[] }) {
  return (
    <Flex gap={4} wrap>
      {names.map((n) => (
        <Tag key={n} color="blue" style={{ margin: 0 }}>
          {n}
        </Tag>
      ))}
    </Flex>
  )
}

/** Names that each link to the page stating them. */
function LinkChips({ items }: { items: { name: string; url: string }[] }) {
  return (
    <Flex gap={6} wrap>
      {items.map((x) => (
        <a key={x.name + x.url} href={x.url} target="_blank" rel="noreferrer">
          <Tag style={{ margin: 0, cursor: 'pointer' }}>{x.name}</Tag>
        </a>
      ))}
    </Flex>
  )
}

function ContactRow(props: { label: string; value?: string; href?: string; source?: string; sourceUrl?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13.5 }}>
      <span style={{ width: 52, flex: 'none', color: 'var(--text-3)' }}>{props.label}</span>
      {props.value ? (
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <a href={props.href} style={{ wordBreak: 'break-all' }}>
            {props.value}
          </a>
          {props.source &&
            (props.sourceUrl ? (
              <a href={props.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                Source: {props.source}
              </a>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Source: {props.source}</span>
            ))}
        </span>
      ) : (
        <span style={{ color: 'var(--text-3)' }}>Not published</span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--text-3)' }}>{title}</h3>
      {children}
    </div>
  )
}

function Fact({ text, href, source }: { text: React.ReactNode; href?: string; source: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ color: 'var(--ink)' }}>{text}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
          {source}
        </a>
      ) : (
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{source}</span>
      )}
    </div>
  )
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return 'source'
  }
}

/** Summaries sometimes carry pasted quotes and links; show plain sentences. */
const cleanSummary = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '')
    .replace(/\(?https?:\/\/\S+\)?/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()

/** A centred icon, title, one line of help and an optional action, for tabs with no data. */
function EmptyState(props: {
  icon: React.ReactNode
  title: string
  text: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 10,
        padding: '48px 16px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--primary-soft)',
          color: 'var(--primary)',
          marginBottom: 4,
        }}
      >
        {props.icon}
      </span>
      <b style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 600 }}>{props.title}</b>
      <span style={{ fontSize: 13.5, color: 'var(--text-3)', maxWidth: 300, lineHeight: 1.5 }}>{props.text}</span>
      {props.action && (
        <Button type="primary" onClick={props.action.onClick} style={{ marginTop: 6 }}>
          {props.action.label}
        </Button>
      )}
    </div>
  )
}

/** Shown when a section has nothing, so people can see what is missing rather than assume. */
function Missing({ collected, what }: { collected: boolean; what: string }) {
  return (
    <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
      {collected ? `No ${what} found on public pages.` : 'Not collected yet.'}
    </span>
  )
}

/** A key/value row for overview blocks. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: 10, fontSize: 13.5 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ minWidth: 0, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

const dash = <span style={{ color: 'var(--text-3)' }}>Not found</span>

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '12px 14px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
}

function PersonTab({ c, onCollect }: { c: Contact; onCollect: () => void }) {
  const w = c.web?.status === 'found' ? c.web : undefined
  const done = !!c.web
  const career = w?.career ?? []
  const here = (c.company ?? '').toLowerCase().trim()
  const isCurrent = (company: string) => !!here && company.toLowerCase().includes(here.split(/\s+/)[0])
  return (
    <Flex vertical gap={20}>
      <Section title="Profile">
        <Row label="Name">{c.fullName}</Row>
        <Row label="Current role">{c.position || dash}</Row>
        <Row label="Company">{c.company || dash}</Row>
        <Row label="Based in">{c.location?.value || w?.location || dash}</Row>
        <Row label="Connected">{c.connectedOn ? formatDate(c.connectedOn) : dash}</Row>
        {w?.match && (
          <Row label="Match">{w.match === 'confident' ? 'Confident it is this person' : 'Likely this person'}</Row>
        )}
        {w?.summary && <span style={{ fontSize: 13.5, marginTop: 4 }}>{cleanSummary(w.summary)}</span>}
        {(!w || c.web?.status !== 'found') && (
          <Flex vertical gap={6} align="flex-start" style={{ marginTop: 4 }}>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
              {c.web?.status === 'not_found'
                ? 'Nothing public found about this person.'
                : c.web?.status === 'error'
                  ? 'The last search failed.'
                  : 'Web profile not collected yet.'}
            </span>
            <Button size="small" onClick={onCollect}>
              {c.web ? 'Search again' : 'Collect this profile now'}
            </Button>
          </Flex>
        )}
      </Section>

      <Section title="Contact details">
        <ContactRow
          label="Email"
          value={w?.email?.value ?? c.email}
          href={w?.email?.value || c.email ? `mailto:${w?.email?.value ?? c.email}` : undefined}
          source={w?.email ? (w.email.basis ?? hostOf(w.email.url)) : c.email ? 'LinkedIn export' : undefined}
          sourceUrl={w?.email?.url}
        />
        <ContactRow
          label="Phone"
          value={w?.phone?.value}
          href={w?.phone ? `tel:${w.phone.value.replace(/[^\d+]/g, '')}` : undefined}
          source={w?.phone ? hostOf(w.phone.url) : undefined}
          sourceUrl={w?.phone?.url}
        />
        {c.profileUrl && (
          <Row label="LinkedIn">
            <a href={c.profileUrl} target="_blank" rel="noreferrer">
              Open profile
            </a>
          </Row>
        )}
      </Section>

      <Section title={`Work experience${career.length ? ` (${career.length})` : ''}`}>
        {career.length ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              borderLeft: '2px solid var(--border)',
              paddingLeft: 14,
            }}
          >
            {career.map((j, i) => (
              <div key={i} style={{ position: 'relative', paddingBottom: 12 }}>
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: -20,
                    top: 6,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: isCurrent(j.company) ? 'var(--primary)' : 'var(--border)',
                  }}
                />
                <Fact
                  text={
                    <>
                      <b style={{ fontWeight: 500 }}>{j.role || 'Role not stated'}</b>
                      <span style={{ display: 'block', fontSize: 13, color: 'var(--text-2)' }}>
                        {[j.company, j.years].filter(Boolean).join(' · ')}
                      </span>
                    </>
                  }
                  href={j.url}
                  source={`Source: ${hostOf(j.url)}`}
                />
              </div>
            ))}
          </div>
        ) : (
          <Missing collected={done} what="work history" />
        )}
      </Section>

      <Section title="Degrees and education">
        {w?.education?.length ? (
          w.education.map((e, i) => (
            <div key={i} style={card}>
              <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{e.degree || 'Degree not stated'}</b>
              <span style={{ fontSize: 13 }}>{[e.school, e.years].filter(Boolean).join(' · ')}</span>
              <a href={e.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                Source: {hostOf(e.url)}
              </a>
            </div>
          ))
        ) : (
          <Missing collected={done} what="degrees" />
        )}
      </Section>

      <Section title="Certifications">
        {w?.certifications?.length ? (
          <LinkChips items={w.certifications} />
        ) : (
          <Missing collected={done} what="certifications" />
        )}
      </Section>

      <Section title={`Projects${w?.projects?.length ? ` (${w.projects.length})` : ''}`}>
        {w?.projects?.length ? (
          w.projects.map((x, i) => (
            <div key={i} style={card}>
              <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{x.name}</b>
              {(x.role || x.company) && (
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {[x.role, x.company].filter(Boolean).join(' · ')}
                </span>
              )}
              {x.summary && <span style={{ fontSize: 13 }}>{x.summary}</span>}
              <a href={x.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                Source: {hostOf(x.url)}
              </a>
            </div>
          ))
        ) : (
          <Missing collected={done} what="projects" />
        )}
      </Section>

      <Section title="Skills and topics">
        {w?.keywords?.length ? <TechChips names={w.keywords} /> : <Missing collected={done} what="skills" />}
      </Section>

      {w?.githubProfile && (
        <Section title="GitHub">
          <Row label="Profile">
            <a href={`https://github.com/${w.github}`} target="_blank" rel="noreferrer">
              github.com/{w.github}
            </a>
          </Row>
          <Row label="Activity">
            {w.githubProfile.publicRepos ?? 0} public repos · {w.githubProfile.followers ?? 0} followers
          </Row>
          {w.githubProfile.bio && <Row label="Bio">{w.githubProfile.bio}</Row>}
          {!!w.githubProfile.languages?.length && <TechChips names={w.githubProfile.languages} />}
          {w.githubProfile.repos?.slice(0, 6).map((r) => (
            <div key={r.url} style={card}>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ fontWeight: 500 }}>
                {r.name}
              </a>
              {r.description && <span style={{ fontSize: 13 }}>{r.description}</span>}
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {[r.language, r.stars ? `${r.stars} stars` : ''].filter(Boolean).join(' · ')}
              </span>
            </div>
          ))}
        </Section>
      )}

      <Section title="Talks, articles and achievements">
        {w?.facts?.length ? (
          w.facts.map((f, i) => <Fact key={i} text={f.text} href={f.url} source={`Source: ${hostOf(f.url)}`} />)
        ) : (
          <Missing collected={done} what="public activity" />
        )}
      </Section>
    </Flex>
  )
}

function CompanyTab({ c, onCollect }: { c: Contact; onCollect?: () => void }) {
  const r = c.research?.status === 'found' ? c.research : undefined
  const done = !!c.research
  if (!r)
    return c.research?.status === 'no_site' ? (
      <EmptyState
        icon={<IconWorldOff size={30} stroke={1.6} />}
        title="No website found"
        text={`We couldn’t confirm a website for ${c.company ?? 'this company'}. Add it from a CSV, or try again.`}
        action={onCollect && { label: 'Try again', onClick: onCollect }}
      />
    ) : done ? (
      <EmptyState
        icon={<IconBuildingOff size={30} stroke={1.6} />}
        title="Nothing found about this company"
        text="Public pages didn’t give anything we could back up with a source."
        action={onCollect && { label: 'Search again', onClick: onCollect }}
      />
    ) : !c.company ? (
      <EmptyState
        icon={<IconBuildingOff size={30} stroke={1.6} />}
        title="No company listed"
        text="This person’s LinkedIn export has no current company, so there’s nothing to look up."
      />
    ) : (
      <EmptyState
        icon={<IconBuildingSkyscraper size={30} stroke={1.6} />}
        title="Company data not collected yet"
        text={`Collect ${c.company}’s website, services, clients, technologies and open jobs.`}
        action={onCollect && { label: 'Collect company data now', onClick: onCollect }}
      />
    )
  return (
    <Flex vertical gap={20}>
      <Section title="Overview">
        <Row label="Company">{c.company || dash}</Row>
        <Row label="Website">
          {r.domain ? (
            <a href={r.siteUrl ?? `https://${r.domain}`} target="_blank" rel="noreferrer">
              {r.domain}
            </a>
          ) : (
            dash
          )}
        </Row>
        <Row label="Industry">{r.industry?.value || dash}</Row>
        <Row label="Size">{r.size?.value || dash}</Row>
        <Row label="Head office">{r.hq?.value || dash}</Row>
        <Row label="Founded">{r.founded?.value || dash}</Row>
        <Row label="Open jobs">{Math.max(r.jobsTotal ?? 0, r.hiring?.length ?? 0)}</Row>
        {r.summary && <span style={{ fontSize: 13.5, marginTop: 4 }}>{cleanSummary(r.summary)}</span>}
      </Section>
      {r.registry && (
        <Section title="Official record (SEC EDGAR)">
          <Row label="Legal name">{r.registry.name}</Row>
          {r.registry.ticker && (
            <Row label="Stock">{[r.registry.exchange, r.registry.ticker].filter(Boolean).join(': ')}</Row>
          )}
          {r.registry.industry && <Row label="Industry">{r.registry.industry}</Row>}
          {r.registry.address && <Row label="Address">{r.registry.address}</Row>}
          {r.registry.phone && <Row label="Phone">{r.registry.phone}</Row>}
          {!!r.registry.formerNames?.length && <Row label="Former names">{r.registry.formerNames.join(', ')}</Row>}
          <a href={r.registry.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>
            Source: sec.gov
          </a>
        </Section>
      )}
      <Section title="Technologies the company uses">
        {r.technologies?.length ? (
          <Flex gap={6} wrap>
            {r.technologies.map((t) => (
              <a key={t.name} href={t.url} target="_blank" rel="noreferrer" title={t.quote}>
                <Tag color="purple" style={{ margin: 0, cursor: 'pointer' }}>
                  {t.name}
                </Tag>
              </a>
            ))}
          </Flex>
        ) : (
          <Missing collected={done} what="technologies" />
        )}
      </Section>
      <Section title="What the company sells">
        {r.services?.length ? <LinkChips items={r.services} /> : <Missing collected={done} what="services" />}
      </Section>
      <Section title="Clients">
        {r.clients?.length ? <LinkChips items={r.clients} /> : <Missing collected={done} what="named clients" />}
      </Section>
      <Section title="Partnerships and certifications">
        {r.partners?.length || r.certifications?.length ? (
          <LinkChips items={[...(r.partners ?? []), ...(r.certifications ?? [])]} />
        ) : (
          <Missing collected={done} what="partnerships" />
        )}
      </Section>
      <Section title="Offices">
        {r.offices?.length ? <LinkChips items={r.offices} /> : <Missing collected={done} what="offices" />}
      </Section>
      <Section title="Leadership">
        {r.leaders?.length ? (
          r.leaders.map((l, i) => (
            <Fact key={i} text={`${l.name}, ${l.title}`} href={l.url} source={`Source: ${hostOf(l.url)}`} />
          ))
        ) : (
          <Missing collected={done} what="leaders" />
        )}
      </Section>
      <Section title="Recent news">
        {r.news?.length ? (
          r.news.map((n, i) => (
            <Fact key={i} text={n.text} href={n.url} source={[n.date, hostOf(n.url)].filter(Boolean).join(', ')} />
          ))
        ) : (
          <Missing collected={done} what="news" />
        )}
      </Section>
      {!!r.sources?.length && (
        <Section title={`Pages read (${r.sources.length})`}>
          {r.sources.slice(0, 12).map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>
              {u}
            </a>
          ))}
        </Section>
      )}
    </Flex>
  )
}

function JobsTab({ c, onCollect }: { c: Contact; onCollect?: () => void }) {
  const r = c.research?.status === 'found' ? c.research : undefined
  const jobs = r?.hiring ?? []
  const allTech = [...new Set(jobs.flatMap((j) => (j.skills?.length ? j.skills : techIn(j.title))))]
  if (!jobs.length)
    return c.research ? (
      <EmptyState
        icon={<IconSearch size={30} stroke={1.6} />}
        title="No open jobs found"
        text={`We checked ${c.company ?? 'the company'}’s careers pages and job feeds and found no current openings.`}
        action={onCollect && { label: 'Check again', onClick: onCollect }}
      />
    ) : (
      <EmptyState
        icon={<IconBriefcase size={30} stroke={1.6} />}
        title="Jobs not collected yet"
        text="Collect this company’s data to see its open jobs, the skills they ask for and when they were posted."
        action={onCollect && c.company ? { label: 'Collect company data now', onClick: onCollect } : undefined}
      />
    )
  return (
    <Flex vertical gap={12}>
      {allTech.length > 0 && (
        <Section title="Skills these jobs ask for">
          <TechChips names={allTech} />
        </Section>
      )}
      <Section
        title={`Open jobs (${jobs.length}${r?.jobsTotal && r.jobsTotal > jobs.length ? ` of ${r.jobsTotal}` : ''})`}
      >
        {jobs.map((j, i) => {
          const tech = j.skills?.length ? j.skills : techIn(j.title)
          return (
            <div key={i} style={card}>
              <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{j.title}</b>
              {(j.level || j.type || j.team || j.location) && (
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {[j.level, j.type, j.team, j.location].filter(Boolean).join(' · ')}
                </span>
              )}
              {j.salary && <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>{j.salary}</span>}
              {j.summary && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{j.summary}</span>}
              {tech.length > 0 && <TechChips names={tech} />}
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                {[j.source, j.postedAt && `posted ${j.postedAt}`].filter(Boolean).join(', ') || 'Job ad'}
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
          )
        })}
      </Section>
    </Flex>
  )
}

function NotesTab({ c, runs }: { c: Contact; runs: ScoreRun[] }) {
  const navigate = useNavigate()
  const [notes, setNotes] = useState(c.notes ?? '')
  const [tag, setTag] = useState('')
  const shortlisted = runs.filter((run) =>
    run.people.some((p) => p.id === c.id && (p.priority === 'High' || p.priority === 'Medium')),
  )
  return (
    <Flex vertical gap={20}>
      <Section title="Status">
        <Select<LeadStatus>
          aria-label="Status"
          value={c.status}
          onChange={(status) => void updateContact(c.id, { status })}
          options={STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))}
        />
      </Section>
      <Section title="Tags">
        <Flex gap={6} wrap>
          {c.tags.map((t) => (
            <Tag key={t} closable onClose={() => void updateContact(c.id, { tags: c.tags.filter((x) => x !== t) })}>
              {t}
            </Tag>
          ))}
          <Input
            size="small"
            aria-label="Add tag"
            placeholder="Add tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onPressEnter={() => {
              if (tag.trim()) void updateContact(c.id, { tags: [...c.tags, tag] })
              setTag('')
            }}
            style={{ width: 110 }}
          />
        </Flex>
      </Section>
      <Section title="Notes">
        <Input.TextArea
          aria-label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (c.notes ?? '') && void updateContact(c.id, { notes })}
          autoSize={{ minRows: 3, maxRows: 10 }}
          placeholder="Notes"
        />
      </Section>
      <Section title="Shortlisted in">
        {shortlisted.length ? (
          shortlisted.map((run) => (
            <Button
              key={run.id}
              type="link"
              onClick={() => navigate('/results')}
              style={{ padding: 0, height: 'auto', textAlign: 'left' }}
            >
              {run.briefName} · score {run.people.find((p) => p.id === c.id)?.score}
            </Button>
          ))
        ) : (
          <span style={{ color: 'var(--text-3)', fontSize: 13 }}>Not on any shortlist yet.</span>
        )}
      </Section>
    </Flex>
  )
}

/** Everything collected about one person, in four tabs: Person, Company, Jobs, Notes. */
export function PersonPanel({ c, runs }: { c: Contact; runs: ScoreRun[] }) {
  const [collecting, setCollecting] = useState(false)
  const [collectingCompany, setCollectingCompany] = useState(false)
  const jobs = c.research?.status === 'found' ? (c.research.hiring?.length ?? 0) : 0
  return (
    <aside
      aria-label={`${c.fullName} details`}
      style={{
        flex: '1 1 380px',
        maxWidth: 480,
        minWidth: 0,
        height: '100%',
        overflowY: 'auto',
        borderLeft: '1px solid var(--border-subtle)',
        background: 'var(--bg-header)',
        padding: '22px 22px 32px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{c.fullName}</h2>
      <span style={{ color: 'var(--text-3)', fontSize: 13.5 }}>
        {[c.position, c.company].filter(Boolean).join(' at ')}
      </span>
      <Tabs
        style={{ marginTop: 8 }}
        items={[
          { key: 'person', label: 'Person', children: <PersonTab c={c} onCollect={() => setCollecting(true)} /> },
          {
            key: 'company',
            label: 'Company',
            children: <CompanyTab c={c} onCollect={c.company ? () => setCollectingCompany(true) : undefined} />,
          },
          {
            key: 'jobs',
            label: `Jobs${jobs ? ` (${jobs})` : ''}`,
            children: <JobsTab c={c} onCollect={c.company ? () => setCollectingCompany(true) : undefined} />,
          },
          { key: 'notes', label: 'Notes', children: <NotesTab c={c} runs={runs} /> },
        ]}
      />
      {collectingCompany && <ResearchModal shown={[c]} selected={[c]} onClose={() => setCollectingCompany(false)} />}
      {collecting && <PersonWebModal shown={[c]} selected={[c]} onClose={() => setCollecting(false)} />}
    </aside>
  )
}
