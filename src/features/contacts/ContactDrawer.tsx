import { useEffect, useRef, useState } from 'react'
import { Button, Descriptions, Divider, Drawer, Flex, Input, Segmented, Select, Tag, Tooltip, Typography } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  DownOutlined,
  LinkedinFilled,
  LoadingOutlined,
  MailOutlined,
  QuestionCircleOutlined,
  UpOutlined,
  WorldOutlined,
  HqOutlined,
} from '../../components/icons'
import { SparkIcon } from '../ai/AskAi'
import { saveManualEnrichment } from '../../lib/enrich'
import type { Contact, LeadStatus, Priority } from '../../lib/schemas'
import { STATUSES } from '../../lib/schemas'
import { updateContact } from '../../lib/contacts'
import { ContactAvatar } from '../../components/ContactAvatar'
import { Dot, PRIORITY_DOT, SeniorityText, STATUS_META } from '../../components/tags'
import { formatDate, relativeTime } from '../../lib/format'
import { modelById } from '../../lib/ai/models'
import { setManualHq } from '../../lib/company-hq-store'
import { CHECK_FIELDS, currentMark, setMark } from '../../lib/accuracy'

const SOURCE_LABEL: Record<Contact['source'], string> = {
  linkedin_export: 'LinkedIn export',
  manual: 'Added by hand',
  sales_nav: 'Sales Navigator',
  sample: 'Sample data',
}

const unknown = <Typography.Text type="secondary">Unknown</Typography.Text>

interface Props {
  contact?: Contact
  /** e.g. "3 of 44" within the current list. */
  position?: { index: number; total: number }
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
  tagOptions: string[]
}

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>{children}</span>
}

/** The AI's view, kept visibly separate from facts: quotes from the profile vs. guesses to verify. */
function AiAssessmentCard({ contact }: { contact: Contact }) {
  const ai = contact.ai!
  const differs = contact.priority !== ai.priority
  return (
    <Flex vertical gap={10} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '12px 14px' }}>
      <Flex justify="space-between" align="center" gap={8}>
        <Flex align="center" gap={8}>
          <SparkIcon />
          <span style={{ fontWeight: 500 }}>AI score {ai.score}</span>
          <span>
            <Dot color={PRIORITY_DOT[ai.priority]} />
            {ai.priority}
          </span>
        </Flex>
        {differs && (
          <Button size="small" onClick={() => updateContact(contact.id, { priority: ai.priority })}>
            Use as priority
          </Button>
        )}
      </Flex>
      <Typography.Text>{ai.reason}</Typography.Text>
      {ai.confirmed.length > 0 && (
        <Flex vertical gap={4}>
          <Label>From their profile</Label>
          {ai.confirmed.map((q) => (
            <span key={q}>
              <CheckOutlined style={{ color: 'var(--success)', marginRight: 8 }} />“{q}”
            </span>
          ))}
        </Flex>
      )}
      {ai.inferred.length > 0 && (
        <Flex vertical gap={4}>
          <Label>Inferred — check before relying on it</Label>
          {ai.inferred.map((q) => (
            <Typography.Text key={q} type="secondary">
              <QuestionCircleOutlined style={{ marginRight: 8 }} />
              {q}
            </Typography.Text>
          ))}
        </Flex>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Brief “{ai.briefName}” · {modelById(ai.model).label} · {relativeTime(ai.at)}
      </Typography.Text>
    </Flex>
  )
}

/** Website, industry and size: filled by "Company data" imports, editable here. Saved on blur. */
function CompanyEditor({ contact }: { contact: Contact }) {
  const e = contact.enrichment
  const [website, setWebsite] = useState(e?.website ?? '')
  const [industry, setIndustry] = useState(e?.industry ?? '')
  const [size, setSize] = useState(e?.companySize ?? '')
  const [error, setError] = useState<string>()

  const save = async (patch: { website?: string; industry?: string; companySize?: string }) => {
    setError(await saveManualEnrichment(contact, patch))
  }

  return (
    <Flex vertical gap={6}>
      <Flex justify="space-between" align="baseline">
        <Label>Company</Label>
        {e?.source && e.source !== 'manual' && (
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>From {e.source}</span>
        )}
      </Flex>
      <Input
        prefix={<WorldOutlined style={{ color: 'var(--text-3)' }} />}
        placeholder="Website, e.g. contoso.com"
        value={website}
        status={error ? 'error' : undefined}
        onChange={(ev) => setWebsite(ev.target.value)}
        onBlur={() => website !== (e?.website ?? '') && save({ website })}
        onPressEnter={(ev) => (ev.target as HTMLInputElement).blur()}
        maxLength={200}
      />
      {error && (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          {error}
        </Typography.Text>
      )}
      <Flex gap={8}>
        <Input
          placeholder="Industry"
          value={industry}
          onChange={(ev) => setIndustry(ev.target.value)}
          onBlur={() => industry !== (e?.industry ?? '') && save({ industry })}
          onPressEnter={(ev) => (ev.target as HTMLInputElement).blur()}
          maxLength={120}
        />
        <Input
          placeholder="Size, e.g. 201–500"
          value={size}
          onChange={(ev) => setSize(ev.target.value)}
          onBlur={() => size !== (e?.companySize ?? '') && save({ companySize: size })}
          onPressEnter={(ev) => (ev.target as HTMLInputElement).blur()}
          maxLength={60}
          style={{ maxWidth: 170 }}
        />
      </Flex>
    </Flex>
  )
}

type SaveState = 'idle' | 'saving' | 'saved'

/** Notes save themselves shortly after you stop typing, and when the drawer closes. */
function NotesEditor({ contact }: { contact: Contact }) {
  const [value, setValue] = useState(contact.notes ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const pending = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const id = contact.id
    return () => {
      clearTimeout(timer.current)
      if (pending.current !== undefined) void updateContact(id, { notes: pending.current })
    }
  }, [contact.id])

  const onChange = (next: string) => {
    setValue(next)
    pending.current = next
    setState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const toSave = pending.current
      pending.current = undefined
      if (toSave !== undefined) await updateContact(contact.id, { notes: toSave })
      setState('saved')
    }, 500)
  }

  return (
    <Flex vertical gap={6}>
      <Flex justify="space-between" align="center">
        <Label>Notes</Label>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {state === 'saving' && (
            <>
              <LoadingOutlined /> Saving…
            </>
          )}
          {state === 'saved' && (
            <>
              <CheckOutlined /> Saved
            </>
          )}
        </Typography.Text>
      </Flex>
      <Input.TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoSize={{ minRows: 3, maxRows: 10 }}
        maxLength={10_000}
        placeholder="How you know them, what they care about, next step…"
      />
    </Flex>
  )
}

/** ✓/✗ what the system decided for this person; feeds the Accuracy page. */
function CheckBlock({ contact }: { contact: Contact }) {
  const rows = CHECK_FIELDS.map((f) => ({ f, value: f.value(contact) })).filter((r) => r.value !== undefined)
  if (!rows.length) return null
  return (
    <Flex vertical gap={6}>
      <Flex justify="space-between" align="baseline">
        <Label>Check accuracy</Label>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Your marks build the Accuracy page</span>
      </Flex>
      <div className="check-list">
        {rows.map(({ f, value }) => {
          const mark = currentMark(contact, f.key)
          return (
            <div key={f.key} className="check-row">
              <span className="check-label">{f.label}</span>
              <span className="check-value" title={value}>
                {value}
              </span>
              <span className="check-buttons">
                <Tooltip title="Correct">
                  <button
                    type="button"
                    aria-label={`${f.label} is correct`}
                    aria-pressed={mark === true}
                    className={`check-btn ok${mark === true ? ' on' : ''}`}
                    onClick={() => void setMark(contact.id, f.key, mark === true ? undefined : true)}
                  >
                    <CheckOutlined />
                  </button>
                </Tooltip>
                <Tooltip title="Wrong">
                  <button
                    type="button"
                    aria-label={`${f.label} is wrong`}
                    aria-pressed={mark === false}
                    className={`check-btn bad${mark === false ? ' on' : ''}`}
                    onClick={() => void setMark(contact.id, f.key, mark === false ? undefined : false)}
                  >
                    <CloseOutlined />
                  </button>
                </Tooltip>
              </span>
            </div>
          )
        })}
      </div>
    </Flex>
  )
}

/** What company research found, each fact with a link to the page it was quoted from. */
function ResearchBlock({ contact }: { contact: Contact }) {
  const r = contact.research
  if (!r) return null
  const link = (url: string, label: string) => (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
      {label}
    </a>
  )
  const fact = (name: string, f?: { value: string; url: string; quote: string }) =>
    f && (
      <div style={{ fontSize: 13 }}>
        <span style={{ color: 'var(--text-2)' }}>{name}:</span> {f.value}{' '}
        <Tooltip title={`“${f.quote}”`}>{link(f.url, 'source')}</Tooltip>
      </div>
    )
  return (
    <Flex vertical gap={6}>
      <Flex justify="space-between" align="baseline">
        <Label>Company research</Label>
        <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{relativeTime(r.at)}</span>
      </Flex>
      {r.status !== 'found' ? (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {r.note ?? 'Nothing found.'}
        </Typography.Text>
      ) : (
        <>
          {r.summary && <Typography.Text style={{ fontSize: 13 }}>{r.summary}</Typography.Text>}
          {r.siteUrl && (
            <div style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)' }}>Website:</span> {link(r.siteUrl, r.domain ?? r.siteUrl)}
              {r.verified ? '' : ' (not confirmed)'}
            </div>
          )}
          {fact('HQ', r.hq)}
          {fact('Industry', r.industry)}
          {fact('Size', r.size)}
          {!!r.technologies?.length && (
            <div style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)' }}>Technologies:</span>{' '}
              {r.technologies.map((t, i) => (
                <span key={t.name}>
                  {i > 0 && ', '}
                  <Tooltip title={`“${t.quote}”`}>
                    <a href={t.url} target="_blank" rel="noopener noreferrer">
                      {t.name}
                    </a>
                  </Tooltip>
                </span>
              ))}
            </div>
          )}
          {(!!r.hiring?.length || !!r.jobsTotal) && (
            <div style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)' }}>Hiring{r.jobsTotal ? ` (${r.jobsTotal} open roles)` : ''}:</span>
              {r.hiring?.length ? (
                <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                  {r.hiring.map((h) => (
                    <li key={h.title}>
                      {h.url ? link(h.url, h.title) : h.title}
                      {h.location ? <span style={{ color: 'var(--text-3)' }}> · {h.location}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                ' none in technology, IT or business systems'
              )}
            </div>
          )}
          {r.note && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.note}
            </Typography.Text>
          )}
        </>
      )}
    </Flex>
  )
}

/** Company HQ: shown with where it came from; typing one applies it to everyone at the company. */
function HqEditor({ contact }: { contact: Contact }) {
  const hq = contact.companyHq
  const current = hq?.status === 'found' ? (hq.value ?? '') : ''
  const [value, setValue] = useState(current)
  const [note, setNote] = useState<string>()
  const save = async () => {
    if (value.trim() === current) return
    const n = await setManualHq(contact, value)
    const verb = value.trim() ? 'Saved' : 'Cleared'
    setNote(n > 1 ? `${verb} for all ${n} people at ${contact.company ?? 'this company'}.` : `${verb}.`)
  }
  const origin =
    hq?.origin === 'ai'
      ? hq.status === 'found'
        ? `AI-inferred · ${hq.confidence ?? 'low'} confidence${hq.metro ? ` · ${hq.metro}` : ''}`
        : 'AI lookup: unknown'
      : hq?.origin === 'web'
        ? `From the company's website`
        : hq?.origin === 'provider'
          ? `From ${hq.source ?? 'a data provider'}`
          : hq?.origin === 'import'
            ? `From ${hq.source ?? 'a Company data import'}`
            : hq?.origin === 'manual'
              ? 'Typed by you'
              : undefined

  return (
    <Flex vertical gap={6}>
      <Flex justify="space-between" align="baseline">
        <Label>Company HQ</Label>
        {origin && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{origin}</span>}
      </Flex>
      <Input
        prefix={<HqOutlined style={{ color: 'var(--text-3)' }} />}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
        maxLength={200}
        placeholder={contact.company ? `Where ${contact.company} is headquartered` : 'e.g. Boston, Massachusetts'}
        allowClear
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {note ?? 'Where the company is based — not necessarily where this person works.'}
      </Typography.Text>
    </Flex>
  )
}

function LocationEditor({ contact }: { contact: Contact }) {
  const [value, setValue] = useState(contact.location?.value ?? '')
  const save = () => {
    if (value.trim() !== (contact.location?.value ?? ''))
      void updateContact(contact.id, { location: { value, origin: 'manual' } })
  }
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
      maxLength={200}
      placeholder="e.g. Boston, MA"
      allowClear
    />
  )
}

export function ContactDrawer({ contact, position, onPrev, onNext, onClose, tagOptions }: Props) {
  return (
    <Drawer
      open={!!contact}
      onClose={onClose}
      size={520}
      destroyOnHidden
      title={
        position && (
          <Flex align="center" gap={8}>
            <Tooltip title="Previous (↑)">
              <Button
                size="small"
                icon={<UpOutlined />}
                onClick={onPrev}
                disabled={position.index === 0}
                aria-label="Previous lead"
              />
            </Tooltip>
            <Tooltip title="Next (↓)">
              <Button
                size="small"
                icon={<DownOutlined />}
                onClick={onNext}
                disabled={position.index >= position.total - 1}
                aria-label="Next lead"
              />
            </Tooltip>
            <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
              {position.index + 1} of {position.total.toLocaleString()}
            </Typography.Text>
          </Flex>
        )
      }
    >
      {contact && (
        // Keyed by contact so local edit state (notes, location) never leaks between people.
        <Flex key={contact.id} vertical gap={22} className="fade-in">
          <Flex gap={14} align="center">
            <ContactAvatar name={contact.fullName} company={contact.company} size={56} />
            <Flex vertical style={{ minWidth: 0 }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.015em' }}>
                {contact.fullName}
              </span>
              <Typography.Text type="secondary">
                {[contact.position, contact.company].filter(Boolean).join(' · ') || 'No title on record'}
              </Typography.Text>
            </Flex>
          </Flex>

          {(contact.profileUrl || contact.email) && (
            <Flex gap={8} wrap>
              {contact.profileUrl && (
                <Button
                  icon={<LinkedinFilled style={{ color: '#0a66c2' }} />}
                  href={contact.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  LinkedIn profile
                </Button>
              )}
              {contact.email && (
                <Button icon={<MailOutlined />} href={`mailto:${contact.email}`}>
                  Email
                </Button>
              )}
            </Flex>
          )}

          {contact.ai && <AiAssessmentCard contact={contact} />}

          <Flex vertical gap={6}>
            <Label>Status</Label>
            <Segmented<LeadStatus>
              block
              value={contact.status}
              onChange={(status) => updateContact(contact.id, { status })}
              options={STATUSES.map((s) => ({
                value: s,
                label: (
                  <span>
                    <Dot color={STATUS_META[s].dot} />
                    {STATUS_META[s].label}
                  </span>
                ),
              }))}
            />
          </Flex>

          <Flex vertical gap={6}>
            <Label>Priority</Label>
            <Segmented<Priority | 'none'>
              block
              value={contact.priority ?? 'none'}
              onChange={(p) => updateContact(contact.id, { priority: p === 'none' ? undefined : p })}
              options={[
                { value: 'none', label: 'Not set' },
                ...(['High', 'Medium', 'Low'] as const).map((p) => ({
                  value: p,
                  label: (
                    <span>
                      <Dot color={PRIORITY_DOT[p]} />
                      {p}
                    </span>
                  ),
                })),
              ]}
            />
          </Flex>

          <Flex vertical gap={6}>
            <Label>Tags</Label>
            <Select
              mode="tags"
              value={contact.tags}
              onChange={(tags: string[]) => updateContact(contact.id, { tags })}
              options={tagOptions.map((t) => ({ value: t, label: t }))}
              placeholder="Add tags, e.g. warm, event-2026"
              tokenSeparators={[',']}
              style={{ width: '100%' }}
            />
          </Flex>

          <Flex vertical gap={6}>
            <Label>Location</Label>
            <LocationEditor contact={contact} />
          </Flex>

          {/* Reset only when an AI lookup changes it, so "Saved for all N people" stays visible after typing. */}
          <HqEditor key={contact.companyHq?.origin === 'ai' ? contact.companyHq.at : 'typed'} contact={contact} />

          <CompanyEditor contact={contact} />

          <ResearchBlock contact={contact} />

          <CheckBlock contact={contact} />

          <NotesEditor contact={contact} />

          <Divider style={{ margin: 0 }} />

          <Flex vertical gap={8}>
            <Label>From LinkedIn</Label>
            <Descriptions
              colon={false}
              column={1}
              size="small"
              styles={{ label: { width: 120 } }}
              items={[
                { key: 'seniority', label: 'Seniority', children: <SeniorityText value={contact.seniority} /> },
                { key: 'function', label: 'Function', children: contact.function },
                {
                  key: 'roles',
                  label: 'Role tags',
                  children: contact.titleTags.length ? (
                    contact.titleTags.map((t) => <Tag key={t}>{t}</Tag>)
                  ) : (
                    <Typography.Text type="secondary">None detected</Typography.Text>
                  ),
                },
                { key: 'email', label: 'Email', children: contact.email ?? unknown },
                {
                  key: 'connected',
                  label: 'Connected',
                  children: contact.connectedOn ? formatDate(contact.connectedOn) : unknown,
                },
                { key: 'source', label: 'Source', children: SOURCE_LABEL[contact.source] },
              ]}
            />
          </Flex>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Changes save automatically. Seniority and function are worked out from the job title. Keys:{' '}
            <Typography.Text keyboard>↑</Typography.Text> <Typography.Text keyboard>↓</Typography.Text> move,{' '}
            <Typography.Text keyboard>S</Typography.Text> shortlist.
          </Typography.Text>
        </Flex>
      )}
    </Drawer>
  )
}
