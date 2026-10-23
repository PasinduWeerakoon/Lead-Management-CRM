import { Fragment, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { App, Button, Dropdown, Flex, Tooltip, Typography, type MenuProps } from 'antd'
import {
  ApartmentOutlined,
  EditOutlined,
  FilterOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '../../components/icons'
import { FIELDS } from '../../lib/filters/fields'
import { instantiate } from '../../lib/filters/presets'
import { sortPresets } from '../../lib/filters/preset-store'
import { db } from '../../lib/db'
import { PresetEditor } from './PresetEditor'
import type { Combinator, FieldKey, SavedPreset } from '../../lib/filters/schema'
import { ConditionChip, type ChipContext } from './ConditionChip'
import { useFilterStore, useFilters } from './store'

export const ADD_FILTER_BUTTON_ID = 'add-filter-button'

function fieldMenu(onPick: (key: FieldKey) => void, extra?: MenuProps['items']): MenuProps {
  const groups = [...new Set(FIELDS.map((f) => f.group))]
  return {
    items: [
      ...groups.map((g) => ({
        type: 'group' as const,
        key: g,
        label: g,
        children: FIELDS.filter((f) => f.group === g).map((f) => ({ key: f.key, label: f.label })),
      })),
      ...(extra ?? []),
    ],
    onClick: ({ key }) => {
      if (key !== '__group') onPick(key as FieldKey)
    },
    style: { maxHeight: 420, overflowY: 'auto' },
  }
}

function Connector({ combinator, onToggle }: { combinator: Combinator; onToggle: () => void }) {
  return (
    <Tooltip title={`Click to switch to “${combinator === 'and' ? 'or' : 'and'}”`} mouseEnterDelay={0.4}>
      <Button
        type="text"
        size="small"
        onClick={onToggle}
        style={{ fontSize: 13, color: 'var(--text-2)', padding: '0 6px' }}
      >
        {combinator}
      </Button>
    </Tooltip>
  )
}

/** Toolbar button with filter starting points: yours and the built-ins, all editable. */
export function PresetsButton() {
  const { modal, message } = App.useApp()
  const navigate = useNavigate()
  const { draft, load, viewId } = useFilters()
  const presets = useLiveQuery(() => db.presets.toArray(), [], [] as SavedPreset[])
  const [editor, setEditor] = useState<'blank' | 'current'>()
  const sorted = sortPresets(presets)
  const own = sorted.filter((p) => !p.builtIn)
  const builtIn = sorted.filter((p) => p.builtIn)

  const applyPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id)
    if (!preset) return
    const apply = () => load(instantiate(preset.filter), viewId)
    if (draft.items.length === 0) apply()
    else
      modal.confirm({
        title: `Start from “${preset.name}”?`,
        content: 'This replaces the filters you have now.',
        okText: 'Replace filters',
        onOk: apply,
      })
  }

  const item = (p: SavedPreset) => ({
    key: p.id,
    label: (
      <Flex vertical style={{ padding: '2px 0', maxWidth: 320 }}>
        <Typography.Text>{p.name}</Typography.Text>
        {p.description && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {p.description}
          </Typography.Text>
        )}
      </Flex>
    ),
  })

  const items: MenuProps['items'] = [
    ...(own.length ? [{ type: 'group' as const, key: 'own', label: 'Your presets', children: own.map(item) }] : []),
    ...(builtIn.length
      ? [{ type: 'group' as const, key: 'builtin', label: 'Built-in', children: builtIn.map(item) }]
      : []),
    { type: 'divider' as const },
    { key: '__new', icon: <PlusOutlined />, label: 'Create a new preset…' },
    {
      key: '__save',
      icon: <FilterOutlined />,
      label: 'Save current filters as a preset…',
      disabled: draft.items.length === 0,
    },
    { key: '__manage', icon: <EditOutlined />, label: 'Manage presets…' },
  ]

  return (
    <>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
          items,
          style: { maxHeight: 460, overflowY: 'auto' },
          onClick: ({ key }) => {
            if (key === '__new') setEditor('blank')
            else if (key === '__save') setEditor('current')
            else if (key === '__manage') navigate('/presets')
            else applyPreset(key)
          },
        }}
      >
        <Button icon={<ThunderboltOutlined />}>Presets</Button>
      </Dropdown>
      {editor && (
        <PresetEditor
          startFrom={editor === 'current' ? draft : undefined}
          onClose={(saved) => {
            setEditor(undefined)
            if (saved && typeof saved !== 'string') message.success(`Created “${saved.name}”.`)
          }}
        />
      )}
    </>
  )
}

/** The row of filter chips under the toolbar. */
export function FilterBar({
  ctx,
  addButtonId = ADD_FILTER_BUTTON_ID,
  padding = '0 16px 10px',
}: {
  ctx: ChipContext
  /** DOM id for the "Add filter" button (the F shortcut targets the People page's). */
  addButtonId?: string
  padding?: string
}) {
  const { draft, addCondition, addGroup, setCombinator, clear } = useFilterStore()
  const flip = (c: Combinator): Combinator => (c === 'and' ? 'or' : 'and')

  return (
    <Flex wrap align="center" gap={6} style={{ padding }}>
      <Typography.Text type="secondary" style={{ fontSize: 13, marginRight: 2 }}>
        {draft.items.length ? 'Where' : 'No filters yet'}
      </Typography.Text>

      {draft.items.map((item, idx) => (
        <Fragment key={item.id}>
          {idx > 0 && (
            <Connector combinator={draft.combinator} onToggle={() => setCombinator(flip(draft.combinator))} />
          )}
          {item.kind === 'condition' ? (
            <ConditionChip cond={item} ctx={ctx} />
          ) : (
            <Flex
              wrap
              align="center"
              gap={4}
              className="fade-in"
              style={{
                padding: '2px 4px 2px 8px',
                borderRadius: 8,
                border: '1px dashed var(--border)',
              }}
            >
              {item.conditions.map((cond, ci) => (
                <Fragment key={cond.id}>
                  {ci > 0 && (
                    <Connector
                      combinator={item.combinator}
                      onToggle={() => setCombinator(flip(item.combinator), item.id)}
                    />
                  )}
                  <ConditionChip cond={cond} ctx={ctx} />
                </Fragment>
              ))}
              <Dropdown trigger={['click']} menu={fieldMenu((key) => addCondition(key, item.id))}>
                <Tooltip title={`Add to this group (“${item.combinator}”)`}>
                  <Button type="text" size="small" icon={<PlusOutlined />} aria-label="Add to group" />
                </Tooltip>
              </Dropdown>
            </Flex>
          )}
        </Fragment>
      ))}

      <Dropdown
        trigger={['click']}
        menu={fieldMenu(
          (key) => addCondition(key),
          [
            { type: 'divider' },
            {
              key: '__group',
              icon: <ApartmentOutlined />,
              label: 'Add a group (for “this or that”)',
              onClick: () => addGroup(),
            },
          ],
        )}
      >
        <Button
          id={addButtonId || undefined}
          type="text"
          size="small"
          icon={<PlusOutlined />}
          style={{ color: 'var(--primary-text)' }}
        >
          Add filter
        </Button>
      </Dropdown>

      {draft.items.length > 0 && (
        <Button type="text" size="small" onClick={clear} style={{ color: 'var(--text-2)' }}>
          Clear all
        </Button>
      )}
    </Flex>
  )
}
