import { useState } from 'react'
import { App, Button, Dropdown, Flex, Input, Popover } from 'antd'
import { CloseOutlined, DownloadOutlined, FlagOutlined, TagOutlined, CheckCircleOutlined } from '../../components/icons'
import { bulkUpdate, type BulkAction } from '../../lib/contacts'
import { PRIORITIES, STATUSES, type Contact } from '../../lib/schemas'
import { Dot, PRIORITY_DOT, STATUS_META } from '../../components/tags'

interface Props {
  selected: Contact[]
  onClear: () => void
  onExport: () => void
}

const plural = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`

function AddTag({ onAdd }: { onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false)
  const [tag, setTag] = useState('')
  const submit = () => {
    if (!tag.trim()) return
    onAdd(tag.trim())
    setTag('')
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      content={
        <Flex gap={8}>
          <Input
            autoFocus
            maxLength={60}
            placeholder="e.g. warm"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onPressEnter={submit}
          />
          <Button type="primary" onClick={submit} disabled={!tag.trim()}>
            Add
          </Button>
        </Flex>
      }
    >
      <button type="button" className="bulk-btn">
        <TagOutlined /> Add tag
      </button>
    </Popover>
  )
}

/** Floating bar that appears when rows are ticked, like Clay's selection toolbar. */
export function BulkBar({ selected, onClear, onExport }: Props) {
  const { message } = App.useApp()
  const ids = selected.map((c) => c.id)
  const tagsInSelection = [...new Set(selected.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b))

  const run = async (action: BulkAction, done: string) => {
    const n = await bulkUpdate(ids, action)
    message.success(`${done} for ${plural(n)}.`)
  }

  return (
    <div className="bulkbar fade-in" role="toolbar" aria-label="Actions for selected people">
      <span className="bulk-count">{plural(selected.length)} selected</span>
      <span className="bulk-sep" />
      <Dropdown
        trigger={['click']}
        placement="top"
        menu={{
          items: STATUSES.map((s) => ({
            key: s,
            label: (
              <span>
                <Dot color={STATUS_META[s].dot} />
                {STATUS_META[s].label}
              </span>
            ),
          })),
          onClick: ({ key }) =>
            run(
              { kind: 'status', status: key as Contact['status'] },
              `Status set to ${STATUS_META[key as Contact['status']].label}`,
            ),
        }}
      >
        <button type="button" className="bulk-btn">
          <CheckCircleOutlined /> Status
        </button>
      </Dropdown>
      <Dropdown
        trigger={['click']}
        placement="top"
        menu={{
          items: [
            ...PRIORITIES.map((p) => ({
              key: p,
              label: (
                <span>
                  <Dot color={PRIORITY_DOT[p]} />
                  {p}
                </span>
              ),
            })),
            { type: 'divider' as const },
            { key: 'ai', label: 'Use AI priority', disabled: !selected.some((c) => c.ai) },
            { key: 'none', label: 'Clear priority' },
          ],
          onClick: ({ key }) =>
            key === 'ai'
              ? run({ kind: 'aiPriority' }, 'AI priority applied')
              : key === 'none'
                ? run({ kind: 'priority', priority: undefined }, 'Priority cleared')
                : run({ kind: 'priority', priority: key as Contact['priority'] }, `Priority set to ${key}`),
        }}
      >
        <button type="button" className="bulk-btn">
          <FlagOutlined /> Priority
        </button>
      </Dropdown>
      <AddTag onAdd={(tag) => run({ kind: 'addTag', tag }, `Tag “${tag}” added`)} />
      {tagsInSelection.length > 0 && (
        <Dropdown
          trigger={['click']}
          placement="top"
          menu={{
            items: tagsInSelection.map((t) => ({ key: t, label: t })),
            onClick: ({ key }) => run({ kind: 'removeTag', tag: key }, `Tag “${key}” removed`),
          }}
        >
          <button type="button" className="bulk-btn">
            Remove tag
          </button>
        </Dropdown>
      )}
      <span className="bulk-sep" />
      <button type="button" className="bulk-btn" onClick={onExport}>
        <DownloadOutlined /> Export
      </button>
      <button
        type="button"
        className="bulk-btn"
        onClick={onClear}
        aria-label="Clear selection"
        style={{ padding: '0 8px' }}
      >
        <CloseOutlined />
      </button>
    </div>
  )
}
