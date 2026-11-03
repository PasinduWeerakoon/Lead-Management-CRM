import { useMemo, useState } from 'react'
import { App, Button, Empty, Flex, Input, Segmented, Table, Typography } from 'antd'
import Papa from 'papaparse'
import { useLiveQuery } from 'dexie-react-hooks'
import { BulbOutlined, DeleteOutlined, DownloadOutlined, SearchOutlined } from '../../components/icons'
import { TopBar } from '../../components/TopBar'
import { PageHeader } from '../../components/PageHeader'
import { Dot, PRIORITY_DOT } from '../../components/tags'
import { db } from '../../lib/db'
import { formatDate, relativeTime } from '../../lib/format'
import { downloadFile } from '../../lib/files'
import { neutralizeFormula, safeFileName } from '../../lib/export/rows'
import { PRIORITIES, type Priority, type ScoreRun } from '../../lib/schemas'

type Show = Priority | 'All'

const count = (r: ScoreRun, p: Priority) => r.people.filter((x) => x.priority === p).length

/** Every "Score with AI" run, kept as it was, so each prompt's shortlist can be opened again later. */
export function ResultsPage() {
  const { modal } = App.useApp()
  const runs = useLiveQuery(() => db.scoreRuns.orderBy('at').reverse().toArray(), [], [] as ScoreRun[])
  const [openId, setOpenId] = useState<string>()
  const [show, setShow] = useState<Show>('High')
  const [q, setQ] = useState('')
  const run = runs.find((r) => r.id === openId) ?? runs[0]

  const rows = useMemo(() => {
    if (!run) return []
    const needle = q.trim().toLowerCase()
    return run.people
      .filter((p) => show === 'All' || p.priority === show)
      .filter((p) => !needle || `${p.name} ${p.position ?? ''} ${p.company ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.score - a.score)
  }, [run, show, q])

  const exportCsv = () => {
    if (!run) return
    const data = rows.map((p) =>
      [p.name, p.position ?? '', p.company ?? '', String(p.score), p.priority, p.reason].map(neutralizeFormula),
    )
    const csv = Papa.unparse({ fields: ['Name', 'Title', 'Company', 'Score', 'Priority', 'Why'], data })
    downloadFile('﻿' + csv, `${safeFileName(`${run.briefName} ${run.at.slice(0, 10)}`)}.csv`, 'text/csv;charset=utf-8')
  }

  const remove = (r: ScoreRun) =>
    modal.confirm({
      title: `Delete this “${r.briefName}” result?`,
      content: 'Only this saved result is removed. People and their current scores stay.',
      okText: 'Delete result',
      okButtonProps: { danger: true },
      onOk: () => db.scoreRuns.delete(r.id),
    })

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Workspace' }, { label: 'AI results', icon: <BulbOutlined /> }]} />
      <div className="screen-body">
        <Flex vertical gap={20} style={{ maxWidth: 1180, margin: '0 auto' }}>
          <PageHeader
            title="AI results"
            description="Every prompt you score with is saved here with its own shortlist. New runs never change older results."
          />
          {!runs.length ? (
            <div className="panel" style={{ padding: 40 }}>
              <Empty description="No results yet. Use “Score with AI” on the People page and each run appears here." />
            </div>
          ) : (
            <Flex gap={20} align="flex-start" wrap>
              <div className="panel" style={{ flex: '1 1 280px', maxWidth: 360, minWidth: 0 }}>
                {runs.map((r, i) => {
                  const active = r.id === run?.id
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenId(r.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}
                      style={{
                        padding: '12px 16px',
                        cursor: 'pointer',
                        borderTop: i ? '1px solid var(--border-subtle)' : undefined,
                        background: active ? 'var(--bg-hover)' : undefined,
                      }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.briefName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                        {formatDate(r.at)} · {relativeTime(r.at)}
                      </div>
                      <Flex gap={12} style={{ fontSize: 12, marginTop: 6 }}>
                        {PRIORITIES.map((p) => (
                          <span key={p}>
                            <Dot color={PRIORITY_DOT[p]} /> {count(r, p)} {p}
                          </span>
                        ))}
                      </Flex>
                    </div>
                  )
                })}
              </div>

              {run && (
                <div className="panel" style={{ flex: '3 1 520px', minWidth: 0, padding: 16 }}>
                  <Flex justify="space-between" align="flex-start" gap={12} wrap>
                    <div style={{ minWidth: 0 }}>
                      <Typography.Title level={5} style={{ margin: 0 }}>
                        {run.briefName}
                      </Typography.Title>
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        {run.people.length.toLocaleString()} of {run.total.toLocaleString()} people scored on{' '}
                        {formatDate(run.at)}
                      </Typography.Text>
                    </div>
                    <Flex gap={8}>
                      <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>
                        Export CSV
                      </Button>
                      <Button icon={<DeleteOutlined />} onClick={() => remove(run)} aria-label="Delete result" />
                    </Flex>
                  </Flex>
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2, expandable: true, symbol: 'Show prompt' }}
                    style={{ fontSize: 13, margin: '10px 0', whiteSpace: 'pre-line' }}
                  >
                    {run.briefText}
                  </Typography.Paragraph>
                  <Flex gap={8} wrap style={{ marginBottom: 12 }}>
                    <Segmented<Show>
                      value={show}
                      onChange={setShow}
                      options={[...PRIORITIES, 'All'].map((p) => ({
                        value: p as Show,
                        label: p === 'All' ? `All ${run.people.length}` : `${p} ${count(run, p as Priority)}`,
                      }))}
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
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={rows}
                    pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
                    scroll={{ x: 760 }}
                    locale={{ emptyText: `No ${show === 'All' ? '' : show + ' '}people in this result.` }}
                    columns={[
                      { title: 'Name', dataIndex: 'name', width: 180, render: (v: string) => <b>{v}</b> },
                      { title: 'Title', dataIndex: 'position', width: 200, ellipsis: true },
                      { title: 'Company', dataIndex: 'company', width: 160, ellipsis: true },
                      {
                        title: 'Score',
                        dataIndex: 'score',
                        width: 90,
                        render: (v: number, p) => (
                          <span className="num">
                            <Dot color={PRIORITY_DOT[p.priority]} /> {v}
                          </span>
                        ),
                      },
                      { title: 'Why', dataIndex: 'reason', ellipsis: true },
                    ]}
                  />
                </div>
              )}
            </Flex>
          )}
        </Flex>
      </div>
    </div>
  )
}
