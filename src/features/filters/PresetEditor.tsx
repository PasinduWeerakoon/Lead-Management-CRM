import { useMemo, useState } from 'react'
import { Alert, Flex, Input, Modal, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useStore } from 'zustand'
import { db } from '../../lib/db'
import { compileFilter, countConditions } from '../../lib/filters/engine'
import type { FieldKey, FilterGroup, KeywordPack, SavedPreset } from '../../lib/filters/schema'
import { instantiate } from '../../lib/filters/presets'
import { createPreset, updatePreset } from '../../lib/filters/preset-store'
import { FilterBar } from './FilterBar'
import { createFilterStore, FilterStoreContext } from './store'

interface Props {
  /** Edit this preset; omit to create a new one. */
  preset?: SavedPreset
  /** Starting filters for a new preset (e.g. what's on the People page). */
  startFrom?: FilterGroup
  onClose: (saved?: SavedPreset | string) => void
}

/**
 * Create or edit a preset: name, description and the full filter builder, with a live count of
 * how many people match. Works on its own copy of the filters, so the People page is untouched.
 */
export function PresetEditor({ preset, startFrom, onClose }: Props) {
  const [store] = useState(() =>
    createFilterStore(instantiate(preset?.filter ?? startFrom ?? { combinator: 'and', items: [] })),
  )
  const draft = useStore(store, (s) => s.draft)
  const [name, setName] = useState(preset?.name ?? '')
  const [description, setDescription] = useState(preset?.description ?? '')
  const [busy, setBusy] = useState(false)

  const contacts = useLiveQuery(() => db.contacts.toArray(), [], [])
  const packs = useLiveQuery(() => db.keywordPacks.orderBy('name').toArray(), [], [] as KeywordPack[])
  const packMap = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs])

  const listOptions = useMemo(() => {
    const role = new Set<string>()
    const own = new Set<string>()
    for (const c of contacts) {
      c.titleTags.forEach((t) => role.add(t))
      c.tags.forEach((t) => own.add(t))
    }
    const byField: Partial<Record<FieldKey, string[]>> = { titleTags: [...role].sort(), tags: [...own].sort() }
    return (field: FieldKey) => byField[field] ?? []
  }, [contacts])

  const matches = useMemo(() => {
    const pred = compileFilter(draft, { packs: packMap })
    return pred ? contacts.filter(pred).length : contacts.length
  }, [draft, packMap, contacts])

  const conditions = countConditions(draft)
  const canSave = !!name.trim() && conditions > 0

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      if (preset) {
        await updatePreset(preset.id, { name, description, filter: draft })
        onClose(preset.id)
      } else {
        onClose(await createPreset(name, description, draft))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      width={760}
      title={preset ? `Edit preset` : 'New preset'}
      okText={preset ? 'Save changes' : 'Create preset'}
      okButtonProps={{ disabled: !canSave, loading: busy }}
      onOk={save}
      onCancel={() => onClose()}
      destroyOnHidden
    >
      <Flex vertical gap={16} style={{ marginTop: 8 }}>
        <Flex gap={12} wrap>
          <Flex vertical gap={4} style={{ flex: '1 1 240px' }}>
            <Typography.Text strong>Name</Typography.Text>
            <Input
              autoFocus
              maxLength={80}
              placeholder="e.g. Sri Lanka tech leaders"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Flex>
          <Flex vertical gap={4} style={{ flex: '2 1 320px' }}>
            <Typography.Text strong>
              Description <Typography.Text type="secondary">(optional)</Typography.Text>
            </Typography.Text>
            <Input
              maxLength={200}
              placeholder="Shown under the name in the Presets menu"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Flex>
        </Flex>

        <Flex vertical gap={6}>
          <Flex justify="space-between" align="baseline" wrap gap={8}>
            <Typography.Text strong>Filters</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 13 }} className="num">
              {conditions === 0 ? (
                'Add at least one filter'
              ) : (
                <>
                  <b style={{ color: 'var(--ink)' }}>{matches.toLocaleString()}</b> of{' '}
                  {contacts.length.toLocaleString()} people match right now
                </>
              )}
            </Typography.Text>
          </Flex>
          <div
            className="panel"
            style={{ padding: '12px 12px 8px', minHeight: 64, boxShadow: 'none', background: 'var(--bg-sidebar)' }}
          >
            <FilterStoreContext.Provider value={store}>
              <FilterBar ctx={{ packs, packMap, listOptions }} addButtonId="" padding="0" />
            </FilterStoreContext.Provider>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Click “Add filter” to pick a field (seniority, function, role tags, keywords, keyword pack, company,
            location, AI priority…). Click a chip to change it, and “and”/“or” between chips to switch. Use “Add a
            group” for “this or that”.
          </Typography.Text>
        </Flex>

        {preset?.builtIn && (
          <Alert
            type="info"
            showIcon
            title="This is a built-in preset. Your changes are kept; “Restore built-ins” on the Presets page undoes them."
          />
        )}
      </Flex>
    </Modal>
  )
}
