import { useState } from 'react'
import { App, Button, Card, Col, Collapse, Flex, Row, Statistic, Table, Typography } from 'antd'
import { commitImport, type ImportPlan } from '../../lib/import-service'
import type { ImportRecord } from '../../lib/schemas'
import type { LoadedFile } from './ImportPage'

interface Props {
  file: LoadedFile
  plan: ImportPlan
  onBack: () => void
  onDone: (record: ImportRecord) => void
}

export function ReviewStep({ file, plan, onBack, onDone }: Props) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)
  const writes = plan.toAdd.length + plan.toUpdate.length

  const run = async () => {
    setBusy(true)
    try {
      onDone(await commitImport(plan, file.name))
    } catch {
      message.error("We couldn't save the contacts. Your browser may be out of storage space.")
    } finally {
      setBusy(false)
    }
  }

  const stats = [
    { title: 'New people', value: plan.toAdd.length, color: '#4f46e5' },
    { title: 'Will be updated', value: plan.toUpdate.length, color: '#0891b2' },
    { title: 'Already up to date', value: plan.unchanged },
    { title: 'Skipped', value: plan.skipped.length, color: plan.skipped.length ? '#d97706' : undefined },
  ]

  return (
    <Flex vertical gap={20}>
      <Row gutter={[12, 12]}>
        {stats.map((s) => (
          <Col xs={12} md={6} key={s.title}>
            <Card size="small">
              <Statistic title={s.title} value={s.value} styles={{ content: { color: s.color } }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Typography.Text type="secondary">
        {plan.toUpdate.length > 0
          ? 'Updates only change details from LinkedIn (name, title, company…). Your status, tags and notes are kept. '
          : ''}
        {plan.duplicatesInFile > 0 && `${plan.duplicatesInFile} duplicate rows in the file were merged.`}
      </Typography.Text>

      {plan.skipped.length > 0 && (
        <Collapse
          size="small"
          items={[
            {
              key: 'skipped',
              label: `See the ${plan.skipped.length} skipped rows`,
              children: (
                <Table
                  size="small"
                  rowKey="row"
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  dataSource={plan.skipped}
                  columns={[
                    { title: 'Row', dataIndex: 'row', width: 100 },
                    { title: 'Why', dataIndex: 'reason' },
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      <Flex justify="space-between">
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" loading={busy} disabled={writes === 0} onClick={run}>
          {writes === 0
            ? 'Nothing new to import'
            : `Import ${writes.toLocaleString()} ${writes === 1 ? 'person' : 'people'}`}
        </Button>
      </Flex>
    </Flex>
  )
}
