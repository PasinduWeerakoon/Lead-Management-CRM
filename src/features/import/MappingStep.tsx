import { useState } from 'react'
import { Alert, App, Button, Flex, Select, Table, Typography } from 'antd'
import { CheckCircleFilled, MinusCircleOutlined } from '../../components/icons'
import { hasNameMapping, TARGET_FIELDS, type ColumnMapping, type TargetField } from '../../lib/csv'
import { planImport, type ImportPlan } from '../../lib/import-service'
import type { LoadedFile } from './ImportPage'

interface Props {
  file: LoadedFile
  mapping: ColumnMapping
  onChange: (m: ColumnMapping) => void
  onBack: () => void
  onPlanned: (plan: ImportPlan) => void
}

const HELP: Partial<Record<TargetField, string>> = {
  fullName: 'Only needed if the file has no first/last name columns',
  profileUrl: 'Used to recognise the same person on re-import',
  email: 'Usually empty in LinkedIn exports',
}

export function MappingStep({ file, mapping, onChange, onBack, onPlanned }: Props) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const { headers, rows } = file.table
  const matched = TARGET_FIELDS.filter((f) => mapping[f.key] !== undefined).length
  // Full name is only an alternative to first/last, so don't count it as "missing".
  const relevant = TARGET_FIELDS.length - (mapping.firstName !== undefined && mapping.fullName === undefined ? 1 : 0)

  const sample = (idx: number | undefined) => {
    if (idx === undefined) return undefined
    return rows
      .slice(0, 50)
      .map((r) => r[idx]?.trim())
      .find(Boolean)
  }

  const next = async () => {
    setBusy(true)
    try {
      onPlanned(await planImport(file.table, mapping, file.source))
    } catch {
      message.error('Something went wrong while checking the rows. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex vertical gap={16}>
      <Alert
        type={hasNameMapping(mapping) ? 'success' : 'warning'}
        showIcon
        title={
          hasNameMapping(mapping)
            ? `Found ${rows.length.toLocaleString()} rows in ${file.name}. ${matched === relevant ? 'Every column was matched automatically.' : `We matched ${matched} of ${relevant} fields for you.`}`
            : 'Pick which column holds the name. We need at least a first name or full name.'
        }
        description="Check the matches below. Change any that look wrong."
      />

      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={TARGET_FIELDS.map((f) => ({ ...f }))}
        columns={[
          {
            title: 'Field',
            dataIndex: 'label',
            width: 200,
            render: (label, f) => (
              <Flex vertical>
                <Flex gap={6} align="center">
                  {mapping[f.key] !== undefined ? (
                    <CheckCircleFilled style={{ color: '#16a34a' }} />
                  ) : (
                    <MinusCircleOutlined style={{ opacity: 0.4 }} />
                  )}
                  <Typography.Text strong>{label}</Typography.Text>
                </Flex>
                {HELP[f.key] && (
                  <Typography.Text type="secondary" style={{ fontSize: 12, paddingLeft: 20 }}>
                    {HELP[f.key]}
                  </Typography.Text>
                )}
              </Flex>
            ),
          },
          {
            title: 'Column in your file',
            width: 240,
            render: (_, f) => (
              <Select
                style={{ width: '100%' }}
                allowClear
                placeholder="Not in this file"
                value={mapping[f.key]}
                onChange={(v?: number) => onChange({ ...mapping, [f.key]: v })}
                options={headers.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }))}
              />
            ),
          },
          {
            title: 'Example',
            render: (_, f) => {
              const ex = sample(mapping[f.key])
              return ex ? (
                <Typography.Text ellipsis style={{ maxWidth: 320 }}>
                  {ex}
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              )
            },
          },
        ]}
      />

      <Flex justify="space-between">
        <Button onClick={onBack}>Choose another file</Button>
        <Button type="primary" disabled={!hasNameMapping(mapping)} loading={busy} onClick={next}>
          Continue
        </Button>
      </Flex>
    </Flex>
  )
}
