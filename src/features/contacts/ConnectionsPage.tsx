import { useDeferredValue, useMemo, useState } from 'react'
import { App, Button, Checkbox, Empty, Flex, Input, Select } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { SearchOutlined } from '../../components/icons'
import { db } from '../../lib/db'
import { bulkUpdate } from '../../lib/contacts'
import { STATUSES, type Contact, type LeadStatus, type ScoreRun } from '../../lib/schemas'
import { STATUS_META } from '../../components/tags'
import { PersonPanel } from './PersonPanel'

type WebFilter = 'any' | 'hiring' | 'past' | 'none'
const PAGE = 100

const hiringCount = (c: Contact) => (c.research?.status === 'found' ? (c.research.hiring?.length ?? 0) : 0)
const pastJobs = (c: Contact) => c.web?.career ?? []
const initials = (c: Contact) =>
  ((c.firstName?.[0] ?? '') + (c.lastName?.[0] ?? c.fullName.split(' ')[1]?.[0] ?? '')).toUpperCase() || '?'

/** One short line saying what web data exists for this person. */
function dataLine(c: Contact): { text: string; tone: 'ok' | 'warn' | 'idle' } {
  const parts: string[] = []
  if (hiringCount(c)) parts.push(`Hiring ${hiringCount(c)}`)
  if (pastJobs(c).length) parts.push('Past jobs found')
  if (parts.length) return { text: parts.join(' · '), tone: 'ok' }
  if (c.research?.status === 'found' || c.web?.status === 'found') return { text: 'Web data found', tone: 'ok' }
  if (c.research?.status === 'no_site') return { text: 'No website found', tone: 'warn' }
  if (c.research || c.web) return { text: 'Nothing found', tone: 'idle' }
  return { text: 'Not collected yet', tone: 'idle' }
}

/** Step 3. A plain list of people with what was collected about each one. */
export function ConnectionsPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const loaded = useLiveQuery(() => db.contacts.toArray())
  const runs = useLiveQuery(() => db.scoreRuns.toArray(), [], [] as ScoreRun[])
  const contacts = useMemo(() => loaded ?? [], [loaded])
  const [q, setQ] = useState('')
  const query = useDeferredValue(q.trim().toLowerCase())
  const [status, setStatus] = useState<LeadStatus | 'any'>('any')
  const [web, setWeb] = useState<WebFilter>('any')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState<string[]>([])
  const openId = params.get('open') ?? undefined

  const rows = useMemo(
    () =>
      contacts
        .filter((c) => status === 'any' || c.status === status)
        .filter((c) =>
          web === 'hiring'
            ? hiringCount(c) > 0
            : web === 'past'
              ? pastJobs(c).length > 0
              : web === 'none'
                ? !c.research && !c.web
                : true,
        )
        .filter((c) => !query || `${c.fullName} ${c.position ?? ''} ${c.company ?? ''}`.toLowerCase().includes(query))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [contacts, status, web, query],
  )
  const open = contacts.find((c) => c.id === openId) ?? rows[0]

  const bulk = async (s: LeadStatus) => {
    const n = await bulkUpdate(selected, { kind: 'status', status: s })
    message.success(`${n} ${n === 1 ? 'person' : 'people'} set to ${STATUS_META[s].label}.`)
    setSelected([])
  }

  return (
    <div className="screen">
      <div className="connections-layout">
        <section
          style={{
            flex: '999 1 460px',
            minWidth: 0,
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflowY: 'auto',
            height: '100%',
          }}
        >
          <Flex justify="space-between" align="center" gap={12} wrap>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>Connections</h1>
            <Button onClick={() => navigate('/table')}>Table view and export</Button>
          </Flex>
          <Flex gap={8} wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search name, title or company"
              aria-label="Search connections"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setLimit(PAGE)
              }}
              style={{ flex: '1 1 220px', maxWidth: 360 }}
            />
            <Select
              aria-label="Status"
              value={status}
              onChange={setStatus}
              style={{ width: 150 }}
              options={[
                { value: 'any', label: 'Any status' },
                ...STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })),
              ]}
            />
            <Select<WebFilter>
              aria-label="Web data"
              value={web}
              onChange={setWeb}
              style={{ width: 180 }}
              options={[
                { value: 'any', label: 'Any web data' },
                { value: 'hiring', label: 'Company is hiring' },
                { value: 'past', label: 'Past jobs found' },
                { value: 'none', label: 'Not collected yet' },
              ]}
            />
          </Flex>

          {selected.length > 0 && (
            <Flex
              gap={8}
              align="center"
              wrap
              style={{
                padding: '8px 12px',
                borderRadius: 9,
                background: 'var(--ink)',
                color: 'var(--bg)',
                fontSize: 13.5,
              }}
            >
              <span>{selected.length} selected</span>
              {STATUSES.map((s) => (
                <Button key={s} size="small" ghost onClick={() => void bulk(s)}>
                  {STATUS_META[s].label}
                </Button>
              ))}
              <Button size="small" type="text" style={{ color: 'inherit' }} onClick={() => setSelected([])}>
                Clear
              </Button>
            </Flex>
          )}

          {!loaded ? null : !contacts.length ? (
            <div className="panel" style={{ padding: 40 }}>
              <Empty description="No connections yet.">
                <Button type="primary" onClick={() => navigate('/import')}>
                  Go to Import
                </Button>
              </Empty>
            </div>
          ) : (
            <div className="panel" style={{ padding: 0 }}>
              {rows.slice(0, limit).map((c, i) => {
                const line = dataLine(c)
                const active = open?.id === c.id
                return (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 16px',
                      borderTop: i ? '1px solid var(--border-subtle)' : undefined,
                      background: active ? 'var(--primary-soft)' : undefined,
                    }}
                  >
                    <Checkbox
                      aria-label={`Select ${c.fullName}`}
                      checked={selected.includes(c.id)}
                      onChange={(e) =>
                        setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setParams({ open: c.id }, { replace: true })}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        border: 0,
                        background: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          background: 'var(--bg-hover)',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 12.5,
                          fontWeight: 600,
                          flex: 'none',
                        }}
                      >
                        {initials(c)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{c.fullName}</b>
                        <span
                          style={{
                            fontSize: 13,
                            color: 'var(--text-3)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {[c.position, c.company].filter(Boolean).join(', ')}
                        </span>
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          maxWidth: '42%',
                          textAlign: 'right',
                          flex: 'none',
                          color:
                            line.tone === 'ok'
                              ? 'var(--success)'
                              : line.tone === 'warn'
                                ? 'var(--warning)'
                                : 'var(--text-3)',
                        }}
                      >
                        {line.text}
                      </span>
                    </button>
                  </div>
                )
              })}
              {!rows.length && <div style={{ padding: 20, color: 'var(--text-3)' }}>Nobody matches these filters.</div>}
            </div>
          )}
          {rows.length > 0 && (
            <Flex justify="space-between" align="center">
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                Showing {Math.min(limit, rows.length).toLocaleString()} of {rows.length.toLocaleString()}
              </span>
              {rows.length > limit && <Button onClick={() => setLimit((l) => l + PAGE)}>Show more</Button>}
            </Flex>
          )}
        </section>
        {open && <PersonPanel key={open.id} c={open} runs={runs} />}
      </div>
    </div>
  )
}
