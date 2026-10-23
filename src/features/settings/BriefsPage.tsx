import { useState } from 'react'
import { App, Button, Dropdown, Flex, Input, Modal, Tag, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import {
  BulbOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PlusOutlined,
  RollbackOutlined,
} from '../../components/icons'
import { TopBar } from '../../components/TopBar'
import { PageHeader } from '../../components/PageHeader'
import { db } from '../../lib/db'
import { BRIEF_TEMPLATE } from '../../lib/ai/scoring'
import { sampleBriefRecords, SAMPLE_BRIEFS } from '../../lib/ai/sample-briefs'
import { relativeTime } from '../../lib/format'
import type { Brief } from '../../lib/schemas'

/** Remembered by "Score with AI", so the brief picked here is the one it opens with. */
export const LAST_BRIEF_KEY = 'leads.lastBrief'

/** Your scoring briefs: the offer and ideal buyer that "Score with AI" rates people against. */
export function BriefsPage() {
  const { modal, message } = App.useApp()
  const navigate = useNavigate()
  const briefs = useLiveQuery(() => db.briefs.orderBy('updatedAt').reverse().toArray(), [], [] as Brief[])
  const scored = useLiveQuery(
    async () => {
      const counts = new Map<string, number>()
      await db.contacts.each((c) => c.ai && counts.set(c.ai.briefId, (counts.get(c.ai.briefId) ?? 0) + 1))
      return counts
    },
    [],
    new Map<string, number>(),
  )
  const [editing, setEditing] = useState<Brief | 'new'>()
  const missingSamples = SAMPLE_BRIEFS.filter((s) => !briefs.some((b) => b.id === s.id))

  const addSamples = async () => {
    const records = sampleBriefRecords(new Date().toISOString()).filter((r) =>
      missingSamples.some((m) => m.id === r.id),
    )
    await db.briefs.bulkPut(records)
    message.success(`Added ${records.length} sample ${records.length === 1 ? 'brief' : 'briefs'}.`)
  }

  const remove = (b: Brief) =>
    modal.confirm({
      title: `Delete “${b.name}”?`,
      content: 'Scores already given with this brief stay on people, labelled with its name.',
      okText: 'Delete brief',
      okButtonProps: { danger: true },
      onOk: () => db.briefs.delete(b.id),
    })

  const scoreWith = (b: Brief) => {
    try {
      localStorage.setItem(LAST_BRIEF_KEY, b.id)
    } catch {
      // non-critical: the brief can still be picked in the dialog
    }
    navigate('/?score=1')
  }

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Setup' }, { label: 'Briefs', icon: <FileTextOutlined /> }]} />
      <div className="screen-body">
        <div className="screen-narrow">
          <PageHeader
            title="Briefs"
            description="Describe an offer and your ideal buyer. “Score with AI” rates each person 0–100 against the brief you pick."
            actions={
              <>
                {missingSamples.length > 0 && (
                  <Button icon={<RollbackOutlined />} onClick={() => void addSamples()}>
                    Add sample briefs
                  </Button>
                )}
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
                  New brief
                </Button>
              </>
            }
          />

          <div className="panel">
            {briefs.map((b, i) => (
              <div
                key={b.id}
                style={{ padding: '14px 20px', borderTop: i ? '1px solid var(--border-subtle)' : undefined }}
              >
                <Flex justify="space-between" align="flex-start" gap={12}>
                  <Flex vertical gap={6} style={{ minWidth: 0 }}>
                    <Flex gap={8} align="center" wrap>
                      <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{b.name}</span>
                      {b.id.startsWith('sample-') && (
                        <Tag bordered={false} style={{ fontSize: 11, marginInlineEnd: 0 }}>
                          Sample
                        </Tag>
                      )}
                    </Flex>
                    <Typography.Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}
                    >
                      {b.text}
                    </Typography.Paragraph>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {(scored.get(b.id) ?? 0).toLocaleString()} people scored · edited {relativeTime(b.updatedAt)}
                    </span>
                  </Flex>
                  <Flex gap={4} style={{ flex: 'none' }}>
                    <Button size="small" icon={<BulbOutlined />} onClick={() => scoreWith(b)}>
                      Score with this
                    </Button>
                    <Dropdown
                      trigger={['click']}
                      placement="bottomRight"
                      menu={{
                        items: [
                          { key: 'edit', icon: <EditOutlined />, label: 'Edit brief' },
                          { type: 'divider' },
                          { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
                        ],
                        onClick: ({ key }) => (key === 'edit' ? setEditing(b) : remove(b)),
                      }}
                    >
                      <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${b.name}`} />
                    </Dropdown>
                  </Flex>
                </Flex>
              </div>
            ))}
            {briefs.length === 0 && (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-2)' }}>
                No briefs yet. Create one to start scoring people with AI.
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <BriefEditor
          key={editing === 'new' ? 'new' : editing.id}
          brief={editing === 'new' ? undefined : editing}
          onClose={(saved) => {
            setEditing(undefined)
            if (saved) message.success(editing === 'new' ? 'Brief created.' : 'Brief updated.')
          }}
        />
      )}
    </div>
  )
}

function BriefEditor({ brief, onClose }: { brief?: Brief; onClose: (saved: boolean) => void }) {
  const [name, setName] = useState(brief?.name ?? '')
  const [text, setText] = useState(brief?.text ?? '')
  const valid = name.trim() && text.trim()

  const save = async () => {
    const now = new Date().toISOString()
    await db.briefs.put({
      id: brief?.id ?? crypto.randomUUID(),
      name: name.trim().slice(0, 80),
      text: text.trim().slice(0, 4000),
      createdAt: brief?.createdAt ?? now,
      updatedAt: now,
    })
    onClose(true)
  }

  return (
    <Modal
      open
      title={brief ? 'Edit brief' : 'New brief'}
      width={620}
      onCancel={() => onClose(false)}
      okText={brief ? 'Save changes' : 'Create brief'}
      okButtonProps={{ disabled: !valid }}
      onOk={() => void save()}
    >
      <Flex vertical gap={14} style={{ marginTop: 8 }}>
        <Flex vertical gap={4}>
          <Typography.Text strong>Name</Typography.Text>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Boston Dynamics 365 decision-makers"
            autoFocus
          />
        </Flex>
        <Flex vertical gap={4}>
          <Flex justify="space-between" align="baseline">
            <Typography.Text strong>Brief</Typography.Text>
            {!text.trim() && (
              <Typography.Link style={{ fontSize: 12.5 }} onClick={() => setText(BRIEF_TEMPLATE)}>
                Start from an example
              </Typography.Link>
            )}
          </Flex>
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            What you offer, who the ideal buyer is (roles, seniority), strong signals (technologies, keywords) and
            preferred locations.
          </Typography.Text>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoSize={{ minRows: 7, maxRows: 14 }}
            maxLength={4000}
            showCount
          />
        </Flex>
      </Flex>
    </Modal>
  )
}
