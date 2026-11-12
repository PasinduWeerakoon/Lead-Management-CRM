import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Drawer, Flex, Input, Segmented, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PageHeader } from '../../components/PageHeader'
import { formatDate, relativeTime } from '../../lib/format'
import { useAuth } from '../auth/store'

interface Account {
  email: string
  username: string
  role: 'super_admin' | 'user'
  status: 'pending' | 'active' | 'disabled'
  createdAt: string
  lastSignInAt?: string
  approvedBy?: string
}

interface SearchRow {
  id: string
  profileId: string
  profileName: string
  by: string | null
  at: string
  name: string
  prompt: string
  criteria: string[]
  total: number
  scored: number
  shortlisted: number
  partly: number
}

interface FullSearch {
  briefName?: string
  briefText?: string
  at?: string
  criteria?: string[]
  trimmed?: boolean
  people?: Array<{
    id: string
    name: string
    position?: string
    company?: string
    score: number
    priority: string
    reason: string
    checks?: Array<{ criterion: string; status: string; evidence: string }>
  }>
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...init })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? 'Request failed.')
  return body
}

const STATUS_TAG: Record<Account['status'], { color: string; label: string }> = {
  pending: { color: 'gold', label: 'Waiting for approval' },
  active: { color: 'green', label: 'Active' },
  disabled: { color: 'default', label: 'Turned off' },
}

/** The super admin's view: every account (approve, turn off, roles) and every search with its results. */
export function AdminPage() {
  const { message } = App.useApp()
  const me = useAuth((s) => s.user)
  const [tab, setTab] = useState<'accounts' | 'searches'>('accounts')
  const [accounts, setAccounts] = useState<Account[]>()
  const [searches, setSearches] = useState<SearchRow[]>()
  const [error, setError] = useState<string>()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<{ row: SearchRow; full?: FullSearch }>()

  // Bumped to load again (after a change, or the Refresh button).
  const [tick, setTick] = useState(0)
  const reload = () => setTick((t) => t + 1)
  useEffect(() => {
    let live = true
    Promise.all([
      api<{ users: Account[] }>('/api/admin?op=users'),
      api<{ searches: SearchRow[] }>('/api/admin?op=searches'),
    ])
      .then(([a, s]) => {
        if (!live) return
        setError(undefined)
        setAccounts(a.users)
        setSearches(s.searches)
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Couldn’t load.'))
    return () => {
      live = false
    }
  }, [tick])

  const change = async (email: string, patch: Partial<Pick<Account, 'status' | 'role'>>) => {
    try {
      await api('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'set', email, ...patch }),
      })
      void message.success('Saved.')
      reload()
    } catch (e) {
      void message.error(e instanceof Error ? e.message : 'Couldn’t save.')
    }
  }

  const openSearch = async (row: SearchRow) => {
    setOpen({ row })
    try {
      const r = await api<{ search: FullSearch }>(
        `/api/admin?op=search&profileId=${encodeURIComponent(row.profileId)}&id=${encodeURIComponent(row.id)}`,
      )
      setOpen({ row, full: r.search })
    } catch (e) {
      void message.error(e instanceof Error ? e.message : 'Couldn’t open the search.')
    }
  }

  const needle = q.trim().toLowerCase()
  const shownAccounts = useMemo(
    () => (accounts ?? []).filter((a) => !needle || `${a.email} ${a.username}`.toLowerCase().includes(needle)),
    [accounts, needle],
  )
  const shownSearches = useMemo(
    () =>
      (searches ?? []).filter(
        (s) => !needle || `${s.by ?? ''} ${s.profileName} ${s.name} ${s.prompt}`.toLowerCase().includes(needle),
      ),
    [searches, needle],
  )
  const pending = (accounts ?? []).filter((a) => a.status === 'pending').length

  const accountColumns: ColumnsType<Account> = [
    {
      title: 'Account',
      key: 'who',
      render: (_, a) => (
        <Flex vertical>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{a.username}</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{a.email}</span>
        </Flex>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, a) => <Tag color={STATUS_TAG[a.status].color}>{STATUS_TAG[a.status].label}</Tag>,
    },
    { title: 'Role', key: 'role', render: (_, a) => (a.role === 'super_admin' ? 'Super admin' : 'User') },
    { title: 'Signed up', key: 'created', render: (_, a) => formatDate(a.createdAt) },
    { title: 'Last sign-in', key: 'last', render: (_, a) => (a.lastSignInAt ? relativeTime(a.lastSignInAt) : 'Never') },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_, a) =>
        a.email === me?.email ? (
          <Typography.Text type="secondary">You</Typography.Text>
        ) : (
          <Flex gap={6} justify="end" wrap>
            {a.status !== 'active' && (
              <Button size="small" type="primary" onClick={() => void change(a.email, { status: 'active' })}>
                {a.status === 'pending' ? 'Approve' : 'Turn on'}
              </Button>
            )}
            {a.status !== 'disabled' && (
              <Button size="small" onClick={() => void change(a.email, { status: 'disabled' })}>
                {a.status === 'pending' ? 'Refuse' : 'Turn off'}
              </Button>
            )}
            {a.status === 'active' && (
              <Button
                size="small"
                onClick={() => void change(a.email, { role: a.role === 'super_admin' ? 'user' : 'super_admin' })}
              >
                {a.role === 'super_admin' ? 'Make user' : 'Make super admin'}
              </Button>
            )}
          </Flex>
        ),
    },
  ]

  const searchColumns: ColumnsType<SearchRow> = [
    { title: 'When', key: 'at', width: 120, render: (_, s) => relativeTime(s.at) },
    {
      title: 'Who',
      key: 'by',
      render: (_, s) => (
        <Flex vertical>
          <span>{s.by ?? 'Before accounts'}</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{s.profileName}</span>
        </Flex>
      ),
    },
    {
      title: 'Prompt',
      key: 'prompt',
      render: (_, s) => (
        <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0, maxWidth: 520 }}>
          {s.prompt || s.name}
        </Typography.Paragraph>
      ),
    },
    {
      title: 'Results',
      key: 'n',
      render: (_, s) => (
        <span className="num">
          {s.shortlisted} shortlisted, {s.partly} partly, of {s.scored}
        </span>
      ),
    },
    {
      title: '',
      key: 'open',
      align: 'right',
      render: (_, s) => (
        <Button size="small" onClick={() => void openSearch(s)}>
          Open
        </Button>
      ),
    },
  ]

  const full = open?.full
  return (
    <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader title="Admin" description="Accounts, approvals and every search run in this workspace." />
      {error && <Alert type="error" showIcon title={error} />}
      <Flex gap={8} wrap align="center">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={[
            { value: 'accounts', label: `Accounts ${accounts?.length ?? ''}${pending ? ` (${pending} waiting)` : ''}` },
            { value: 'searches', label: `Searches ${searches?.length ?? ''}` },
          ]}
        />
        <Input
          allowClear
          placeholder={tab === 'accounts' ? 'Search email or username' : 'Search person, profile or prompt'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <Button onClick={() => reload()}>Refresh</Button>
      </Flex>
      <div className="panel" style={{ padding: 4, overflowX: 'auto' }}>
        {tab === 'accounts' ? (
          <Table
            rowKey="email"
            columns={accountColumns}
            dataSource={shownAccounts}
            loading={!accounts && !error}
            pagination={{ pageSize: 25 }}
          />
        ) : (
          <Table
            rowKey={(s) => `${s.profileId}:${s.id}`}
            columns={searchColumns}
            dataSource={shownSearches}
            loading={!searches && !error}
            pagination={{ pageSize: 25 }}
          />
        )}
      </div>

      <Drawer open={!!open} onClose={() => setOpen(undefined)} width={720} title={open?.row.name || 'Search'}>
        {open && (
          <Flex vertical gap={16}>
            <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
              {open.row.by ?? 'Before accounts'} in {open.row.profileName}, {formatDate(open.row.at)}
            </span>
            <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {full?.briefText ?? open.row.prompt}
            </Typography.Paragraph>
            {!!(full?.criteria ?? open.row.criteria).length && (
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {(full?.criteria ?? open.row.criteria).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            )}
            {full?.trimmed && (
              <Alert
                type="info"
                showIcon
                title="This search was very large, so the saved copy keeps the top people and shorter reasons."
              />
            )}
            <Table
              size="small"
              rowKey="id"
              loading={!full}
              dataSource={[...(full?.people ?? [])].sort((a, b) => b.score - a.score)}
              pagination={{ pageSize: 20 }}
              columns={[
                {
                  title: 'Person',
                  key: 'p',
                  render: (_, p) => (
                    <Flex vertical>
                      <span style={{ color: 'var(--text)' }}>{p.name}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                        {[p.position, p.company].filter(Boolean).join(' at ')}
                      </span>
                    </Flex>
                  ),
                },
                { title: 'Fit', key: 'f', render: (_, p) => `${p.priority}` },
                { title: 'Score', key: 's', align: 'right', render: (_, p) => <span className="num">{p.score}</span> },
              ]}
              expandable={{
                expandedRowRender: (p) => (
                  <Flex vertical gap={6}>
                    <span>{p.reason}</span>
                    {p.checks?.map((c, i) => (
                      <span key={i} style={{ fontSize: 13, color: 'var(--text-3)' }}>
                        {i + 1}. {c.criterion}:{' '}
                        <b>{c.status === 'met' ? 'Met' : c.status === 'not_met' ? 'Not met' : 'Unknown'}</b>{' '}
                        {c.evidence}
                      </span>
                    ))}
                  </Flex>
                ),
              }}
            />
          </Flex>
        )}
      </Drawer>
    </div>
  )
}
