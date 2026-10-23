import { useState } from 'react'
import { DatePicker, Flex, Input, InputNumber, Select, Typography } from 'antd'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import { FIELD_BY_KEY, NO_VALUE_OPS } from '../../lib/filters/fields'
import type { Condition, KeywordPack } from '../../lib/filters/schema'

interface Props {
  cond: Condition
  onChange: (value: Condition['value']) => void
  packs: KeywordPack[]
  /** Values seen in the data, for role tags and your tags. */
  listOptions: string[]
  autoFocus?: boolean
}

export function ValueInput({ cond, onChange, packs, listOptions, autoFocus }: Props) {
  const field = FIELD_BY_KEY[cond.field]
  if (NO_VALUE_OPS.includes(cond.op)) return null

  if (field.type === 'enum') {
    return (
      <Select
        mode="multiple"
        autoFocus={autoFocus}
        defaultOpen={autoFocus}
        placeholder="Choose one or more"
        value={Array.isArray(cond.value) ? cond.value : []}
        onChange={onChange}
        options={field.options}
        style={{ width: '100%' }}
        maxTagCount="responsive"
      />
    )
  }

  if (field.type === 'list') {
    return (
      <Select
        mode="tags"
        autoFocus={autoFocus}
        placeholder="Choose or type"
        value={Array.isArray(cond.value) ? cond.value : []}
        onChange={onChange}
        options={listOptions.map((v) => ({ value: v, label: v }))}
        style={{ width: '100%' }}
        maxTagCount="responsive"
      />
    )
  }

  if (field.type === 'keywords') {
    return (
      <Flex vertical gap={4}>
        <Select
          mode="tags"
          autoFocus={autoFocus}
          open={false}
          suffixIcon={null}
          tokenSeparators={[',', ';']}
          placeholder="Type a word and press Enter, e.g. Dynamics"
          value={Array.isArray(cond.value) ? cond.value : []}
          onChange={onChange}
          style={{ width: '100%' }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Separate words with commas. Matches whole words in the job title and company.
        </Typography.Text>
      </Flex>
    )
  }

  if (field.type === 'pack') {
    return (
      <Flex vertical gap={4}>
        <Select
          autoFocus={autoFocus}
          defaultOpen={autoFocus}
          placeholder="Choose a keyword pack"
          value={typeof cond.value === 'string' ? cond.value : undefined}
          onChange={onChange}
          options={packs.map((p) => ({ value: p.id, label: `${p.name} (${p.keywords.length})` }))}
          style={{ width: '100%' }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <Link to="/keyword-packs">Manage keyword packs</Link>
        </Typography.Text>
      </Flex>
    )
  }

  if (field.type === 'date') {
    if (cond.op === 'within_last') {
      return (
        <WithinLastInput
          months={typeof cond.value === 'number' ? cond.value : undefined}
          onChange={onChange}
          autoFocus={autoFocus}
        />
      )
    }
    return (
      <DatePicker
        autoFocus={autoFocus}
        value={typeof cond.value === 'string' && cond.value ? dayjs(cond.value) : null}
        onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : undefined)}
        style={{ width: '100%' }}
      />
    )
  }

  return (
    <Input
      autoFocus={autoFocus}
      allowClear
      placeholder="Type a value"
      value={typeof cond.value === 'string' ? cond.value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Number + unit. The unit is the user's choice, so 12 months stays "12 months" rather than flipping to "1 year". */
function WithinLastInput({
  months,
  onChange,
  autoFocus,
}: {
  months?: number
  onChange: (v: number | undefined) => void
  autoFocus?: boolean
}) {
  const [unit, setUnit] = useState<'months' | 'years'>(months === undefined || months % 12 === 0 ? 'years' : 'months')
  const factor = unit === 'years' ? 12 : 1
  const shown = months === undefined ? undefined : months / factor
  return (
    <Flex gap={8}>
      <InputNumber
        autoFocus={autoFocus}
        min={1}
        max={unit === 'years' ? 50 : 600}
        precision={0}
        placeholder="e.g. 2"
        value={shown}
        onChange={(v) => onChange(v ? v * factor : undefined)}
        style={{ flex: 1 }}
      />
      <Select
        value={unit}
        onChange={(u) => {
          setUnit(u)
          if (shown !== undefined) onChange(Math.max(1, Math.round(shown)) * (u === 'years' ? 12 : 1))
        }}
        options={[
          { value: 'months', label: 'months' },
          { value: 'years', label: 'years' },
        ]}
        style={{ width: 110 }}
      />
    </Flex>
  )
}
