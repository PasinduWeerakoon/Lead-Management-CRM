import { useState } from 'react'
import { App, Button, Dropdown, Flex, Tag, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import {
  DeleteOutlined,
  EditOutlined,
  FilterOutlined,
  PlusOutlined,
  RollbackOutlined,
  ThunderboltOutlined,
} from '../../components/icons'
import { TopBar } from '../../components/TopBar'
import { PageHeader } from '../../components/PageHeader'
import { db } from '../../lib/db'
import { describeFilter } from '../../lib/filters/describe'
import { instantiate } from '../../lib/filters/presets'
import { deletePreset, restoreBuiltInPresets, sortPresets, updatePreset } from '../../lib/filters/preset-store'
import type { FilterGroup, KeywordPack, SavedPreset } from '../../lib/filters/schema'
import { PresetEditor } from '../filters/PresetEditor'
import { useFilters } from '../filters/store'

type Editing = { mode: 'new'; startFrom?: FilterGroup } | { mode: 'edit'; preset: SavedPreset }

/** Add, edit, update and delete presets — the built-in ones too. */
export function PresetsPage() {
  const { modal, message } = App.useApp()
  const navigate = useNavigate()
  const { draft, load, viewId } = useFilters()
  const presets = useLiveQuery(() => db.presets.toArray(), [], [] as SavedPreset[])
  const packs = useLiveQuery(() => db.keywordPacks.toArray(), [], [] as KeywordPack[])
  const packMap = new Map(packs.map((p) => [p.id, p]))
  const [editing, setEditing] = useState<Editing>()
  const sorted = sortPresets(presets)
  const hasDraft = draft.items.length > 0

  const remove = (p: SavedPreset) =>
    modal.confirm({
      title: `Delete “${p.name}”?`,
      content: p.builtIn
        ? 'This is a built-in preset. You can bring it back later with “Restore built-in presets”.'
        : 'Only the preset is deleted. Saved views and your contacts are not affected.',
      okText: 'Delete preset',
      okButtonProps: { danger: true },
      onOk: () => deletePreset(p.id),
    })

  const replaceFilters = (p: SavedPreset) =>
    modal.confirm({
      title: `Update “${p.name}” with your current filters?`,
      content: (
        <div style={{ marginTop: 8 }}>
          {describeFilter(draft, packMap).map((l) => (
            <div key={l} style={{ color: 'var(--text-2)' }}>
              {l}
            </div>
          ))}
        </div>
      ),
      okText: 'Update preset',
      onOk: async () => {
        await updatePreset(p.id, { filter: draft })
        message.success(`Updated “${p.name}”.`)
      },
    })

  const restore = () =>
    modal.confirm({
      title: 'Restore the built-in presets?',
      content:
        'Deleted built-ins come back and edited ones return to their original filters. Your own presets stay as they are.',
      okText: 'Restore',
      onOk: async () => {
        await restoreBuiltInPresets()
        message.success('Built-in presets restored.')
      },
    })

  const tryIt = (p: SavedPreset) => {
    load(instantiate(p.filter), viewId)
    navigate(viewId ? `/?view=${viewId}` : '/')
  }

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Setup' }, { label: 'Presets', icon: <ThunderboltOutlined /> }]} />
      <div className="screen-body">
        <div className="screen-narrow">
          <PageHeader
            title="Presets"
            description="Ready-made filter starting points in the People toolbar. Edit, delete or add your own — built-ins included."
            actions={
              <>
                <Button icon={<RollbackOutlined />} onClick={restore}>
                  Restore built-ins
                </Button>
                <Button
                  icon={<FilterOutlined />}
                  disabled={!hasDraft}
                  title={hasDraft ? 'Start from the filters on the People page' : 'No filters on the People page'}
                  onClick={() => setEditing({ mode: 'new', startFrom: draft })}
                >
                  From People filters
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mode: 'new' })}>
                  New preset
                </Button>
              </>
            }
          />

          <div className="panel">
            {sorted.map((p, i) => (
              <div
                key={p.id}
                style={{ padding: '14px 20px', borderTop: i ? '1px solid var(--border-subtle)' : undefined }}
              >
                <Flex justify="space-between" align="flex-start" gap={12}>
                  <Flex vertical gap={6} style={{ minWidth: 0 }}>
                    <Flex gap={8} align="center" wrap>
                      <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{p.name}</span>
                      {p.builtIn ? (
                        <Tag bordered={false} style={{ fontSize: 11, marginInlineEnd: 0 }}>
                          Built-in
                        </Tag>
                      ) : (
                        <Tag bordered={false} color="blue" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                          Yours
                        </Tag>
                      )}
                    </Flex>
                    {p.description && (
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        {p.description}
                      </Typography.Text>
                    )}
                    <div style={{ fontSize: 12.5, color: 'var(--text-2)', display: 'flex', gap: 6 }}>
                      <FilterOutlined style={{ color: 'var(--text-3)', marginTop: 2 }} />
                      <span>{describeFilter(p.filter, packMap).join(' ') || 'No filters'}</span>
                    </div>
                  </Flex>
                  <Flex gap={4} style={{ flex: 'none' }}>
                    <Button size="small" onClick={() => tryIt(p)}>
                      Apply
                    </Button>
                    <Dropdown
                      trigger={['click']}
                      placement="bottomRight"
                      menu={{
                        items: [
                          { key: 'edit', icon: <EditOutlined />, label: 'Edit preset' },
                          {
                            key: 'replace',
                            icon: <FilterOutlined />,
                            label: 'Replace with current filters',
                            disabled: !hasDraft,
                          },
                          { type: 'divider' },
                          { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true },
                        ],
                        onClick: ({ key }) => {
                          if (key === 'edit') setEditing({ mode: 'edit', preset: p })
                          if (key === 'replace') replaceFilters(p)
                          if (key === 'delete') remove(p)
                        },
                      }}
                    >
                      <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${p.name}`} />
                    </Dropdown>
                  </Flex>
                </Flex>
              </div>
            ))}
            {sorted.length === 0 && (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-2)' }}>
                No presets. Use “Restore built-ins” or save your own.
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <PresetEditor
          key={editing.mode === 'edit' ? editing.preset.id : 'new'}
          preset={editing.mode === 'edit' ? editing.preset : undefined}
          startFrom={editing.mode === 'new' ? editing.startFrom : undefined}
          onClose={(saved) => {
            setEditing(undefined)
            if (saved) message.success(editing.mode === 'edit' ? 'Preset updated.' : 'Preset created.')
          }}
        />
      )}
    </div>
  )
}
