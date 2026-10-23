import { companyTechnologies } from '../../lib/apollo/apply'
import type { ColumnsType } from 'antd/es/table'
import { CheckOutlined } from '../../components/icons'
import {
  AppstoreOutlined,
  BankOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  EnvironmentOutlined,
  ExportOutlined,
  FlagOutlined,
  FontSizeOutlined,
  LinkOutlined,
  MessageOutlined,
  RiseOutlined,
  StarOutlined,
  TagsOutlined,
  PersonCircleOutlined,
  WorldOutlined,
  BriefcaseOutlined,
  UsersGroupOutlined,
  TagOutlined,
  KeyOutlined,
  MailOutlined,
  InfoOutlined,
  HqOutlined,
  FoundFilled,
  NotFoundFilled,
  WarningOutlined,
  PendingOutlined,
  PlayFilled,
  PhoneOutlined,
  MailCheckOutlined,
  TechOutlined,
} from '../../components/icons'
import { Tooltip } from 'antd'
import type { Contact } from '../../lib/schemas'
import { Highlight } from '../../components/Highlight'
import { PRIORITY_DOT, STATUS_META } from '../../components/tags'
import { formatDate } from '../../lib/format'
import { initials } from '../../components/ContactAvatar'

/** Score chip tints: quiet backgrounds, readable text. */
const SCORE_STYLE: Record<'High' | 'Medium' | 'Low', React.CSSProperties> = {
  High: { background: 'color-mix(in srgb, #16a34a 12%, transparent)', color: '#15803d' },
  Medium: { background: 'color-mix(in srgb, #d97706 12%, transparent)', color: '#b45309' },
  Low: { background: 'var(--bg-hover)', color: 'var(--text-2)' },
}

export type ColumnKey =
  | 'name'
  | 'linkedin'
  | 'title'
  | 'company'
  | 'seniority'
  | 'function'
  | 'priority'
  | 'status'
  | 'location'
  | 'companyHq'
  | 'workEmail'
  | 'emailStatus'
  | 'phone'
  | 'technologies'
  | 'research'
  | 'hiring'
  | 'tags'
  | 'connected'
  | 'website'
  | 'industry'
  | 'companySize'
  | 'roleTags'
  | 'keywords'
  | 'email'
  | 'aiScore'
  | 'aiReason'

/** Enrichment a column can run: Apollo person match, Apollo phone, or the company HQ lookup. */
export type RunKind = 'apollo' | 'phone' | 'hq' | 'research'

/** Extra data cells may need: filter highlights, matched keywords, and how to run enrichments. */
export interface CellContext {
  highlight?: RegExp
  keywords: Map<string, string[]>
  /** Header ▶: run this column's enrichment. */
  onRun?: (kind: RunKind) => void
}

interface ColumnDef {
  key: ColumnKey
  title: string
  icon: React.ReactNode
  width: number
  /** Shown when hovering the header's info icon: what the column is and where its data comes from. */
  info: string
  /** Columns that can fill themselves get a ▶ in the header (runs for the rows shown or selected). */
  run?: RunKind
  /** Summary shown under the title: fill rate (meter) or a short count. */
  meta: (rows: Contact[], ctx: CellContext) => { pct: number } | { text: string }
  render: (c: Contact, ctx: CellContext) => React.ReactNode
}

const muted = (text = '—') => <span className="cell-muted">{text}</span>

/** Clay-style result: an icon for found / not found / problem / waiting, then the value. */
function status(kind: 'found' | 'none' | 'warn' | 'pending', text: React.ReactNode, title?: string) {
  const icon =
    kind === 'found' ? (
      <FoundFilled className="st st-found" />
    ) : kind === 'none' ? (
      <NotFoundFilled className="st st-none" />
    ) : kind === 'warn' ? (
      <WarningOutlined className="st st-warn" />
    ) : (
      <PendingOutlined className="st st-pending" />
    )
  return (
    <span className="st-cell" title={title}>
      {icon}
      <span className={`st-text${kind === 'found' ? '' : ' cell-muted'}`}>{text}</span>
    </span>
  )
}

/** The Apollo lookup failed, found no one, or hasn't run — shared by the Apollo columns. */
function apolloState(c: Contact): React.ReactNode | undefined {
  if (c.apolloError && (!c.apollo || c.apolloError.at > c.apollo.at))
    return status('warn', 'Error', c.apolloError.message)
  if (!c.apollo) return muted()
  if (!c.apollo.matched) return status('none', 'No match in Apollo')
  return undefined
}

const EMAIL_STATUS: Record<string, { kind: 'found' | 'warn' | 'none'; label: string }> = {
  verified: { kind: 'found', label: 'Verified' },
  likely_to_engage: { kind: 'found', label: 'Likely to engage' },
  guessed: { kind: 'warn', label: 'Guessed — verify first' },
  extrapolated: { kind: 'warn', label: 'Guessed — verify first' },
  unverified: { kind: 'warn', label: 'Unverified' },
  unavailable: { kind: 'none', label: 'Unavailable' },
  bounced: { kind: 'none', label: 'Bounced' },
}

/** "5y", "8mo", "2w" — how long you've been connected. */
export function connectedAge(iso: string, now = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000))
  if (days >= 365) return `${Math.floor(days / 365)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  if (days >= 7) return `${Math.floor(days / 7)}w`
  return days <= 1 ? 'new' : `${days}d`
}
const fill = (rows: Contact[], has: (c: Contact) => boolean) => ({
  pct: rows.length ? Math.round((rows.filter(has).length / rows.length) * 100) : 0,
})
const SENIOR = new Set(['C-level', 'VP', 'Head', 'Director'])

function hqCell(c: Contact): React.ReactNode {
  const hq = c.companyHq
  if (!hq) return muted()
  if (hq.status === 'unknown') return muted('Unknown')
  return (
    <span className="hq-cell" title={hq.metro ? `${hq.value} · ${hq.metro}` : hq.value}>
      <span className="hq-value">{hq.value}</span>
      <span className={`hq-origin${hq.origin === 'ai' ? ` conf-${hq.confidence ?? 'low'}` : ''}`}>
        {hq.origin === 'ai'
          ? `AI · ${hq.confidence ?? 'low'}`
          : hq.origin === 'import'
            ? 'Imported'
            : hq.origin === 'provider'
              ? (hq.source ?? 'Provider')
              : hq.origin === 'web'
                ? 'Website'
                : 'Yours'}
      </span>
    </span>
  )
}

export const COLUMN_DEFS: ColumnDef[] = [
  {
    key: 'name',
    title: 'Name',
    info: 'Full name, from your LinkedIn export.',
    icon: <PersonCircleOutlined />,
    width: 240,
    meta: (rows) => ({ text: `${rows.length.toLocaleString()} ${rows.length === 1 ? 'person' : 'people'}` }),
    render: (c) => (
      <span className="name-cell">
        <span className="avatar" aria-hidden>
          {initials(c.fullName)}
        </span>
        <span className="name">{c.fullName}</span>
      </span>
    ),
  },
  {
    key: 'linkedin',
    title: 'LinkedIn Profile',
    info: 'Their LinkedIn profile link, from your export. Opens in a new tab.',
    icon: <LinkOutlined />,
    width: 230,
    meta: (rows) => fill(rows, (c) => !!c.profileUrl),
    render: (c) =>
      c.profileUrl ? (
        <a
          className="cell-link"
          href={c.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <ExportOutlined style={{ color: 'var(--text-2)', flex: 'none' }} />
          <span className="url">{c.profileUrl.replace('https://www.', '')}</span>
        </a>
      ) : (
        muted()
      ),
  },
  {
    key: 'title',
    title: 'Job Title',
    info: 'Current job title, as they wrote it on LinkedIn. Highlights show words your filters look for.',
    icon: <FontSizeOutlined />,
    width: 300,
    meta: (rows) => fill(rows, (c) => !!c.position),
    render: (c, { highlight }) => (c.position ? <Highlight text={c.position} re={highlight} /> : muted()),
  },
  {
    key: 'company',
    title: 'Company',
    info: 'Current employer, from your LinkedIn export.',
    icon: <BankOutlined />,
    width: 220,
    meta: (rows) => fill(rows, (c) => !!c.company),
    render: (c, { highlight }) => (c.company ? <Highlight text={c.company} re={highlight} /> : muted()),
  },
  {
    key: 'location',
    title: 'Location',
    run: 'apollo',
    info: 'Where the person is. LinkedIn exports don’t include it — ▶ finds it with Apollo, or import or type it. When it’s unknown, the company HQ is shown in grey with an “HQ” tag.',
    icon: <EnvironmentOutlined />,
    width: 200,
    meta: (rows) => fill(rows, (c) => !!c.location?.value),
    render: (c) =>
      c.location?.value ? (
        c.location.value
      ) : c.companyHq?.status === 'found' && c.companyHq.value ? (
        <span className="hq-fallback" title="Company HQ — not necessarily where this person works">
          <span className="kw">HQ</span>
          <span className="cell-muted">{c.companyHq.value}</span>
        </span>
      ) : (
        muted()
      ),
  },
  {
    key: 'companyHq',
    title: 'Company HQ',
    info: 'Where the company is headquartered — not necessarily where the person works. From Apollo, “Find company HQ” (AI, with a confidence), imported with “Company data”, or typed in the lead panel.',
    run: 'hq',
    icon: <HqOutlined />,
    width: 250,
    meta: (rows) => fill(rows, (c) => c.companyHq?.status === 'found'),
    render: (c) => hqCell(c),
  },
  {
    key: 'research',
    title: 'Company research',
    run: 'research',
    info: 'From the company’s own website: what it does, HQ, industry and technologies — each fact quoted from a page that was read. LinkedIn is never read. Open a person to see the sources.',
    icon: <WorldOutlined />,
    width: 300,
    meta: (rows) => fill(rows, (c) => c.research?.status === 'found'),
    render: (c) => {
      const r = c.research
      if (!r) return muted()
      if (r.status === 'no_site') return status('none', 'No website found', r.note)
      if (r.status === 'error') return status('warn', 'Error', r.note)
      return status('found', r.summary ?? r.domain ?? 'Website read', [r.domain, r.summary].filter(Boolean).join('\n'))
    },
  },
  {
    key: 'hiring',
    title: 'Hiring',
    run: 'research',
    info: 'Open roles in technology, IT, data, ERP/CRM or digital transformation, from the company’s job board or careers page — a sign they’re investing. Filled by “Company research”.',
    icon: <BriefcaseOutlined />,
    width: 260,
    meta: (rows) => ({ text: `${rows.filter((c) => c.research?.hiring?.length).length.toLocaleString()} hiring` }),
    render: (c) => {
      const r = c.research
      if (!r) return muted()
      if (r.status !== 'found') return muted('—')
      const roles = r.hiring ?? []
      if (!roles.length)
        return status('none', r.jobsTotal ? `${r.jobsTotal} open roles, none relevant` : 'No relevant openings found')
      return status(
        'found',
        <>
          {roles[0].title}
          {roles.length > 1 && <span className="cell-muted"> +{roles.length - 1}</span>}
        </>,
        roles.map((h) => h.title).join('\n'),
      )
    },
  },
  {
    key: 'workEmail',
    title: 'Work email',
    run: 'apollo',
    info: 'Work email from Apollo (“Find work email”). One Apollo lookup per person also fills location, company HQ and technologies.',
    icon: <MailOutlined />,
    width: 250,
    meta: (rows) => fill(rows, (c) => !!c.apollo?.email),
    render: (c) =>
      apolloState(c) ??
      (c.apollo?.email ? (
        <a className="cell-link" href={`mailto:${c.apollo.email}`} onClick={(e) => e.stopPropagation()}>
          {status('found', c.apollo.email)}
        </a>
      ) : (
        status('none', 'No email found')
      )),
  },
  {
    key: 'emailStatus',
    title: 'Email check',
    run: 'apollo',
    info: 'Apollo’s own check of the work email: Verified, or Guessed (verify before sending). Runs only when an email was found.',
    icon: <MailCheckOutlined />,
    width: 190,
    meta: (rows) => ({
      text: `${rows.filter((c) => c.apollo?.emailStatus === 'verified').length.toLocaleString()} verified`,
    }),
    render: (c) => {
      const state = apolloState(c)
      if (state) return state
      if (!c.apollo?.email) return muted('Run condition not met')
      const st = EMAIL_STATUS[c.apollo.emailStatus ?? ''] ?? {
        kind: 'warn' as const,
        label: c.apollo.emailStatus ?? 'Unknown',
      }
      return status(st.kind, st.label)
    },
  },
  {
    key: 'phone',
    title: 'Phone',
    run: 'phone',
    info: 'Mobile or direct phone from Apollo (“Find phone”). Up to 9 Apollo credits per person found, and it arrives a few minutes after you run it.',
    icon: <PhoneOutlined />,
    width: 200,
    meta: (rows) => fill(rows, (c) => c.phone?.status === 'found'),
    render: (c) => {
      const p = c.phone
      const content = !p
        ? muted()
        : p.status === 'found' && p.numbers?.length
          ? status(
              'found',
              <>
                {p.numbers[0].number}
                {p.numbers.length > 1 && <span className="cell-muted"> +{p.numbers.length - 1}</span>}
              </>,
              p.numbers.map((n) => `${n.number}${n.type ? ` (${n.type})` : ''}`).join('\n'),
            )
          : p.status === 'pending'
            ? status(
                'pending',
                'Waiting for Apollo…',
                'Apollo sends phone numbers a few minutes later. ▶ checks again.',
              )
            : p.status === 'error'
              ? status('warn', 'Error', p.note)
              : status('none', 'No phone found', p.note)
      return content
    },
  },
  {
    key: 'technologies',
    title: 'Technologies',
    run: 'apollo',
    info: 'Software the company uses — from Apollo, and from the company’s own website (Company research). Filter with “Company technologies”.',
    icon: <TechOutlined />,
    width: 260,
    meta: (rows) => fill(rows, (c) => companyTechnologies(c).length > 0),
    render: (c) => {
      const tech = companyTechnologies(c)
      if (tech.length)
        return (
          <span className="chips" title={tech.join(', ')}>
            {tech.slice(0, 3).map((t) => (
              <span key={t} className="kw">
                {t}
              </span>
            ))}
            {tech.length > 3 && <span className="cell-muted">+{tech.length - 3}</span>}
          </span>
        )
      if (c.research?.status === 'found') return status('none', 'None named on the website')
      return apolloState(c) ?? status('none', 'None listed')
    },
  },
  {
    key: 'website',
    title: 'Company Website',
    info: 'Company website — from Company research (checked by visiting it), Apollo, a “Company data” import, or typed in the lead panel.',
    icon: <WorldOutlined />,
    width: 200,
    meta: (rows) => fill(rows, (c) => !!c.enrichment?.website),
    render: (c) =>
      c.enrichment?.website ? (
        <a
          className="cell-link"
          href={c.enrichment.website}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <ExportOutlined style={{ color: 'var(--text-3)', flex: 'none' }} />
          <span className="url">{c.enrichment.website.replace(/^https:\/\/(www\.)?/, '')}</span>
        </a>
      ) : (
        muted()
      ),
  },
  {
    key: 'industry',
    title: 'Industry',
    info: 'What the company does — quoted from its website by Company research, from Apollo, a “Company data” import, or typed in the lead panel.',
    icon: <BriefcaseOutlined />,
    width: 170,
    meta: (rows) => fill(rows, (c) => !!c.enrichment?.industry),
    render: (c) => c.enrichment?.industry ?? muted(),
  },
  {
    key: 'companySize',
    title: 'Company Size',
    info: 'Number of employees — from Apollo, the company’s website (when it says), a “Company data” import, or typed in the lead panel.',
    icon: <UsersGroupOutlined />,
    width: 140,
    meta: (rows) => fill(rows, (c) => !!c.enrichment?.companySize),
    render: (c) => (c.enrichment?.companySize ? <span className="num">{c.enrichment.companySize}</span> : muted()),
  },
  {
    key: 'seniority',
    title: 'Seniority',
    info: 'Worked out from the job title: C-level, VP, Head, Director, Manager or Individual. “Unknown” when there is no title.',
    icon: <RiseOutlined />,
    width: 140,
    meta: (rows) => ({ text: `${rows.filter((c) => SENIOR.has(c.seniority)).length.toLocaleString()} senior` }),
    render: (c) => (c.seniority === 'Unknown' ? muted('Unknown') : c.seniority === 'IC' ? 'Individual' : c.seniority),
  },
  {
    key: 'function',
    title: 'Function',
    info: 'Area of work, worked out from the job title — e.g. Technology, Digital, Operations, Sales, People.',
    icon: <AppstoreOutlined />,
    width: 140,
    meta: (rows) => fill(rows, (c) => c.function !== 'Other'),
    render: (c) => (c.function === 'Other' ? muted('Other') : c.function),
  },
  {
    key: 'roleTags',
    title: 'Role tags',
    info: 'Specific roles spotted in the job title, such as CEO, CIO or IT Director. Filter with “Role tags”.',
    icon: <TagOutlined />,
    width: 170,
    meta: (rows) => fill(rows, (c) => c.titleTags.length > 0),
    render: (c) =>
      c.titleTags.length ? (
        <span className="chips">
          {c.titleTags.slice(0, 3).map((t) => (
            <span key={t} className="kw">
              {t}
            </span>
          ))}
          {c.titleTags.length > 3 && <span className="cell-muted">+{c.titleTags.length - 3}</span>}
        </span>
      ) : (
        muted()
      ),
  },
  {
    key: 'keywords',
    title: 'Keywords',
    info: 'Keywords found as whole words in the title or company — the ones your filters look for, or all your keyword packs when no keyword filter is on.',
    icon: <KeyOutlined />,
    width: 230,
    meta: (rows, { keywords }) => {
      const n = rows.filter((c) => keywords.has(c.id)).length
      return { text: `${n.toLocaleString()} with matches` }
    },
    render: (c, { keywords }) => {
      const hits = keywords.get(c.id)
      return hits?.length ? (
        <span className="chips">
          {hits.slice(0, 3).map((t) => (
            <span key={t} className="kw kw-hit">
              {t}
            </span>
          ))}
          {hits.length > 3 && <span className="cell-muted">+{hits.length - 3}</span>}
        </span>
      ) : (
        muted()
      )
    },
  },
  {
    key: 'priority',
    title: 'Priority',
    info: 'Your own priority (High, Medium, Low). Set it in the lead panel or with bulk actions; the AI never changes it.',
    icon: <FlagOutlined />,
    width: 130,
    meta: (rows) => fill(rows, (c) => !!c.priority),
    render: (c) =>
      c.priority ? (
        <span>
          <span className="dot" style={{ background: PRIORITY_DOT[c.priority] }} />
          {c.priority}
        </span>
      ) : (
        muted()
      ),
  },
  {
    key: 'status',
    title: 'Status',
    info: 'Where the lead is in your workflow: New, Shortlisted, Contacted or Not a fit.',
    icon: <CheckCircleOutlined />,
    width: 140,
    meta: (rows) => ({ text: `${rows.filter((c) => c.status === 'shortlisted').length.toLocaleString()} shortlisted` }),
    render: (c) => (
      <span>
        <span className="dot" style={{ background: STATUS_META[c.status].dot }} />
        {STATUS_META[c.status].label}
      </span>
    ),
  },
  {
    key: 'email',
    title: 'Email',
    info: 'Email address. LinkedIn only exports it when the person allowed it, so most are empty.',
    icon: <MailOutlined />,
    width: 220,
    meta: (rows) => fill(rows, (c) => !!c.email),
    render: (c) =>
      c.email ? (
        <a className="cell-link" href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>
          <span className="url">{c.email}</span>
        </a>
      ) : (
        muted()
      ),
  },
  {
    key: 'tags',
    title: 'Tags',
    info: 'Your own labels, added in the lead panel or with bulk actions.',
    icon: <TagsOutlined />,
    width: 180,
    meta: (rows) => fill(rows, (c) => c.tags.length > 0),
    render: (c) => (c.tags.length ? c.tags.join(', ') : muted()),
  },
  {
    key: 'aiScore',
    title: 'AI score',
    info: 'Fit against your brief, 0–100, from “Score with AI”. 70+ High, 40–69 Medium, under 40 Low. A suggestion only.',
    icon: <StarOutlined />,
    width: 130,
    meta: (rows) => fill(rows, (c) => !!c.ai),
    render: (c) =>
      c.ai ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="score" style={SCORE_STYLE[c.ai.priority]}>
            {c.ai.score}
          </span>
          <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{c.ai.priority}</span>
        </span>
      ) : (
        muted('Not scored')
      ),
  },
  {
    key: 'aiReason',
    title: 'AI reason',
    info: 'The AI’s short explanation. Open the lead to see quotes from their profile versus inferred guesses.',
    icon: <MessageOutlined />,
    width: 360,
    meta: (rows) => {
      const briefs = new Set(rows.flatMap((c) => (c.ai ? [c.ai.briefName] : [])))
      return briefs.size === 1
        ? { text: `Brief: ${[...briefs][0]}` }
        : briefs.size > 1
          ? { text: `${briefs.size} briefs` }
          : { text: 'Not scored yet' }
    },
    render: (c) => (c.ai ? c.ai.reason : muted()),
  },
  {
    key: 'connected',
    title: 'Connected',
    info: 'When you connected on LinkedIn, and how long ago.',
    icon: <CalendarOutlined />,
    width: 180,
    meta: (rows) => fill(rows, (c) => !!c.connectedOn),
    render: (c) =>
      c.connectedOn ? (
        <span className="one-line" title={formatDate(c.connectedOn)}>
          {formatDate(c.connectedOn)} <span className="cell-muted">· {connectedAge(c.connectedOn)}</span>
        </span>
      ) : (
        muted()
      ),
  },
]

/**
 * Hidden until needed: email
 * is rarely in LinkedIn exports, and your own priority, status and tags start empty (AI score covers fit).
 * All of them stay one click away in the Columns menu.
 */
export const DEFAULT_HIDDEN: ColumnKey[] = ['email', 'priority', 'status', 'tags']

const RUN_LABEL: Record<RunKind, string> = {
  apollo: 'Run Apollo lookup: work email, location, company HQ and technologies',
  phone: 'Find phone numbers with Apollo',
  hq: 'Find company HQ',
  research: 'Research companies: website, job board, verified facts',
}

function ColumnHead({ def, rows, ctx }: { def: ColumnDef; rows: Contact[]; ctx: CellContext }) {
  const meta = def.meta(rows, ctx)
  return (
    <div className="col-head">
      <div className="col-head-title">
        {def.icon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.title}</span>
        {def.run && ctx.onRun && (
          <Tooltip title={RUN_LABEL[def.run]} placement="bottom" mouseEnterDelay={0.15}>
            <button
              type="button"
              className="col-run"
              aria-label={RUN_LABEL[def.run]}
              onClick={(e) => {
                e.stopPropagation()
                ctx.onRun?.(def.run!)
              }}
            >
              <PlayFilled />
            </button>
          </Tooltip>
        )}
        <Tooltip title={def.info} placement="bottom" mouseEnterDelay={0.15} styles={{ root: { maxWidth: 280 } }}>
          <span className="col-info" tabIndex={0} aria-label={`About ${def.title}: ${def.info}`}>
            <InfoOutlined />
          </span>
        </Tooltip>
      </div>
      <div className="col-head-meta">
        {'text' in meta ? (
          meta.text
        ) : meta.pct >= 100 ? (
          <CheckOutlined style={{ color: 'var(--success)' }} aria-label="Complete" />
        ) : (
          <>
            <span className="meter" aria-hidden>
              <span style={{ width: `${meta.pct}%` }} />
            </span>
            <span>{meta.pct}%</span>
          </>
        )}
      </div>
    </div>
  )
}

export function buildColumns(visible: ColumnKey[], rows: Contact[], ctx: CellContext): ColumnsType<Contact> {
  return COLUMN_DEFS.filter((d) => visible.includes(d.key)).map((def, i) => ({
    key: def.key,
    title: <ColumnHead def={def} rows={rows} ctx={ctx} />,
    width: def.width,
    fixed: i === 0 ? ('left' as const) : undefined,
    ellipsis: ['title', 'company', 'tags', 'aiReason', 'email', 'industry', 'companySize', 'research'].includes(def.key)
      ? { showTitle: true }
      : undefined,
    render: (_: unknown, c: Contact) => def.render(c, ctx),
  }))
}
