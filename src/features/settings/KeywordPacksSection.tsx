import { useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { App, Button, Flex, Input, Modal, Select, Tag, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '../../components/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
import type { KeywordPack } from '../../lib/filters/schema'

interface Draft {
  id?: string
  name: string
  keywords: string[]
}

function PackModal({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { message } = App.useApp()
  const [name, setName] = useState(draft.name)
  const [keywords, setKeywords] = useState(draft.keywords)

  const save = async () => {
    const clean = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 300)
    const now = new Date().toISOString()
    if (draft.id) await db.keywordPacks.update(draft.id, { name: name.trim(), keywords: clean, updatedAt: now })
    else await db.keywordPacks.add({ id: crypto.randomUUID(), name: name.trim(), keywords: clean, updatedAt: now })
    message.success(`Saved “${name.trim()}”.`)
    onClose()
  }

  return (
    <Modal
      open
      title={draft.id ? 'Edit keyword pack' : 'New keyword pack'}
      okText="Save pack"
      okButtonProps={{ disabled: !name.trim() || keywords.length === 0 }}
      onOk={save}
      onCancel={onClose}
    >
      <Flex vertical gap={14}>
        <Flex vertical gap={4}>
          <Typography.Text strong>Name</Typography.Text>
          <Input
            autoFocus
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Salesforce ecosystem"
          />
        </Flex>
        <Flex vertical gap={4}>
          <Typography.Text strong>Keywords</Typography.Text>
          <Select
            mode="tags"
            open={false}
            suffixIcon={null}
            tokenSeparators={[',', ';', '\n']}
            value={keywords}
            onChange={setKeywords}
            placeholder="Type or paste words, separated by commas"
            style={{ width: '100%' }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Each keyword matches as a whole word in the job title or company, ignoring case. “BI” matches “Power BI” but
            not “Bill”.
          </Typography.Text>
        </Flex>
      </Flex>
    </Modal>
  )
}

export function KeywordPacksSection() {
  const { modal } = App.useApp()
  const packs = useLiveQuery(() => db.keywordPacks.orderBy('name').toArray(), [], [] as KeywordPack[])
  const views = useLiveQuery(() => db.views.toArray(), [], [])
  const [editing, setEditing] = useState<Draft>()

  const remove = (p: KeywordPack) => {
    const usedBy = views.filter((v) => JSON.stringify(v.filter).includes(`"${p.id}"`)).map((v) => v.name)
    modal.confirm({
      title: `Delete “${p.name}”?`,
      content: usedBy.length
        ? `It's used by: ${usedBy.join(', ')}. Those filters will stop matching until you pick another pack.`
        : 'No saved views use it.',
      okText: 'Delete pack',
      okButtonProps: { danger: true },
      onOk: () => db.keywordPacks.delete(p.id),
    })
  }

  return (
    <>
      <PageHeader
        title="Keyword packs"
        description={
          <>
            Reusable keyword lists for an offer or technology stack — one click matches every word in the list. They
            power the <b>Keyword pack</b> filter, presets like “Dynamics 365 decision-makers”, the <b>Keywords</b>{' '}
            column, the export's <b>Skill Match</b>, and Ask AI. Add packs for your own offers (e.g. Salesforce, SAP).
          </>
        }
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ name: '', keywords: [] })}>
            New pack
          </Button>
        }
      />
      <div className="panel">
        {packs.map((p, i) => (
          <div key={p.id} style={{ padding: '16px 20px', borderTop: i ? '1px solid var(--border-subtle)' : undefined }}>
            <Flex justify="space-between" align="flex-start" gap={12}>
              <Flex vertical gap={10} style={{ minWidth: 0 }}>
                <Flex gap={8} align="center" wrap>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{p.name}</span>
                  <span className="num" style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {p.keywords.length} keywords
                  </span>
                  {p.builtIn && (
                    <Tag bordered={false} style={{ fontSize: 11, marginInlineEnd: 0 }}>
                      Starter
                    </Tag>
                  )}
                </Flex>
                <Flex gap={6} wrap>
                  {p.keywords.slice(0, 12).map((k) => (
                    <span key={k} className="kw">
                      {k}
                    </span>
                  ))}
                  {p.keywords.length > 12 && (
                    <span style={{ fontSize: 12, color: 'var(--text-3)', alignSelf: 'center' }}>
                      +{p.keywords.length - 12} more
                    </span>
                  )}
                </Flex>
              </Flex>
              <Flex gap={2} style={{ flex: 'none' }}>
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  aria-label={`Edit ${p.name}`}
                  onClick={() => setEditing({ id: p.id, name: p.name, keywords: p.keywords })}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={`Delete ${p.name}`}
                  onClick={() => remove(p)}
                />
              </Flex>
            </Flex>
          </div>
        ))}
        {packs.length === 0 && (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-2)' }}>No keyword packs yet.</div>
        )}
      </div>

      {editing && <PackModal key={editing.id ?? 'new'} draft={editing} onClose={() => setEditing(undefined)} />}
    </>
  )
}
