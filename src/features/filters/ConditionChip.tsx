import { Button, Flex, Popover, Select, Typography, theme } from 'antd'
import { CloseOutlined, ExclamationCircleOutlined } from '../../components/icons'
import { describeCondition } from '../../lib/filters/describe'
import { isComplete } from '../../lib/filters/engine'
import { FIELDS, FIELD_BY_KEY, NO_VALUE_OPS, OP_LABEL } from '../../lib/filters/fields'
import type { Condition, FieldKey, KeywordPack, Operator } from '../../lib/filters/schema'
import { useFilterStore } from './store'
import { ValueInput } from './ValueInput'

export interface ChipContext {
  packs: KeywordPack[]
  packMap: Map<string, KeywordPack>
  listOptions: (field: FieldKey) => string[]
}

const groupedFieldOptions = () => {
  const groups = new Map<string, Array<{ value: FieldKey; label: string }>>()
  for (const f of FIELDS) {
    if (!groups.has(f.group)) groups.set(f.group, [])
    groups.get(f.group)!.push({ value: f.key, label: f.label })
  }
  return [...groups].map(([label, options]) => ({ label, options }))
}

/** Value shape each operator expects, so switching operator only resets the value when it must. */
function valueKind(field: FieldKey, op: Operator) {
  if (NO_VALUE_OPS.includes(op)) return 'none'
  if (op === 'within_last') return 'number'
  const t = FIELD_BY_KEY[field].type
  return t === 'enum' || t === 'list' || t === 'keywords' ? 'list' : 'text'
}

function ConditionEditor({ cond, ctx }: { cond: Condition; ctx: ChipContext }) {
  const { updateCondition, removeItem, setEditing } = useFilterStore()
  const field = FIELD_BY_KEY[cond.field]

  const changeField = (key: FieldKey) => {
    const def = FIELD_BY_KEY[key]
    const op = def.ops[0]
    updateCondition(cond.id, { field: key, op, value: valueKind(key, op) === 'list' ? [] : undefined })
  }

  const changeOp = (op: Operator) => {
    const same = valueKind(cond.field, op) === valueKind(cond.field, cond.op)
    updateCondition(cond.id, { op, value: same ? cond.value : valueKind(cond.field, op) === 'list' ? [] : undefined })
  }

  return (
    <Flex vertical gap={12} style={{ width: 340 }}>
      <Flex gap={8}>
        <Select<FieldKey>
          value={cond.field}
          onChange={changeField}
          options={groupedFieldOptions()}
          style={{ flex: 1 }}
          aria-label="Field"
        />
        <Select<Operator>
          value={cond.op}
          onChange={changeOp}
          options={field.ops.map((o) => ({ value: o, label: OP_LABEL[o] }))}
          style={{ width: 150 }}
          aria-label="Condition"
          popupMatchSelectWidth={false}
        />
      </Flex>

      <ValueInput
        key={`${cond.field}-${cond.op}`}
        cond={cond}
        onChange={(value) => updateCondition(cond.id, { value })}
        packs={ctx.packs}
        listOptions={ctx.listOptions(cond.field)}
        autoFocus
      />

      {field.hint && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {field.hint}
        </Typography.Text>
      )}

      <Flex justify="space-between">
        <Button type="text" danger size="small" onClick={() => removeItem(cond.id)}>
          Remove
        </Button>
        <Button type="primary" size="small" onClick={() => setEditing(undefined)}>
          Done
        </Button>
      </Flex>
    </Flex>
  )
}

export function ConditionChip({ cond, ctx }: { cond: Condition; ctx: ChipContext }) {
  const { token } = theme.useToken()
  const { editingId, setEditing, removeItem } = useFilterStore()
  const label = describeCondition(cond, ctx.packMap)
  const complete = isComplete(cond, { packs: ctx.packMap })
  const open = editingId === cond.id

  return (
    <Popover
      open={open}
      onOpenChange={(o) => setEditing(o ? cond.id : undefined)}
      trigger="click"
      placement="bottomLeft"
      content={<ConditionEditor cond={cond} ctx={ctx} />}
      destroyOnHidden
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={`Filter: ${label.field} ${label.op} ${label.value ?? ''}. Click to edit.`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setEditing(cond.id)
          if (e.key === 'Backspace' || e.key === 'Delete') removeItem(cond.id)
        }}
        className="fade-in"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          maxWidth: 420,
          height: 30,
          padding: '0 4px 0 10px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
          background: open ? token.colorPrimaryBg : token.colorBgContainer,
          border: `1px ${complete ? 'solid' : 'dashed'} ${open ? token.colorPrimary : complete ? token.colorBorder : token.colorWarningBorder}`,
          transition: 'background 120ms, border-color 120ms',
          whiteSpace: 'nowrap',
        }}
      >
        {!complete && <ExclamationCircleOutlined style={{ color: token.colorWarning }} />}
        <span style={{ fontWeight: 500 }}>{label.field}</span>
        <span style={{ color: token.colorTextSecondary }}>{label.op}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label.value ?? (complete ? '' : <span style={{ color: token.colorTextTertiary }}>choose…</span>)}
        </span>
        <Button
          type="text"
          size="small"
          shape="circle"
          icon={<CloseOutlined style={{ fontSize: 10 }} />}
          aria-label="Remove filter"
          onClick={(e) => {
            e.stopPropagation()
            removeItem(cond.id)
          }}
          style={{ width: 20, minWidth: 20, height: 20 }}
        />
      </span>
    </Popover>
  )
}
