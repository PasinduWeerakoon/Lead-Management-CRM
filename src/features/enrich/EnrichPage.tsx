import { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Flex,
  Result,
  Row,
  Select,
  Spin,
  Statistic,
  Steps,
  Table,
  Typography,
  Upload,
} from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import {
  BankOutlined,
  CheckCircleFilled,
  ExperimentOutlined,
  InboxOutlined,
  MinusCircleOutlined,
} from '../../components/icons'
import { TopBar } from '../../components/TopBar'
import { PageHeader } from '../../components/PageHeader'
import type { ParsedTable } from '../../lib/csv'
import { parseCsvFile } from '../../lib/files'
import { db } from '../../lib/db'
import {
  autoMapEnrich,
  canMatch,
  commitEnrichment,
  ENRICH_FIELDS,
  hasData,
  planEnrichment,
  type EnrichMapping,
  type EnrichPlan,
} from '../../lib/enrich'

export function EnrichPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], [])
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<{ name: string; table: ParsedTable }>()
  const [mapping, setMapping] = useState<EnrichMapping>({})
  const [plan, setPlan] = useState<EnrichPlan>()
  const [saved, setSaved] = useState(0)

  const load = async (f: File) => {
    setBusy(true)
    try {
      const table = await parseCsvFile(f)
      if (!table.rows.length) return void message.warning('That file has no rows.')
      setFile({ name: f.name, table })
      setMapping(autoMapEnrich(table.headers))
      setStep(1)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not read this file.')
    } finally {
      setBusy(false)
    }
  }

  const review = () => {
    if (!file) return
    setPlan(planEnrichment(file.table, mapping, contacts, file.name))
    setStep(2)
  }

  const apply = async () => {
    if (!plan) return
    setBusy(true)
    try {
      setSaved(await commitEnrichment(plan))
      setStep(3)
    } finally {
      setBusy(false)
    }
  }

  const restart = () => {
    setStep(0)
    setFile(undefined)
    setPlan(undefined)
  }

  const sample = (idx?: number) =>
    idx === undefined
      ? undefined
      : file?.table.rows
          .slice(0, 50)
          .map((r) => r[idx]?.trim())
          .find(Boolean)

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Import' }, { label: 'Company data', icon: <BankOutlined /> }]} />
      <div className="screen-body">
        <div className="screen-narrow" style={{ maxWidth: 920 }}>
          <PageHeader
            title="Add company data"
            description="Fill in website, industry, company size, company HQ and location for people you already have, from any CSV — an Apollo, ZoomInfo or Sales Navigator export, or your own sheet."
          />
          <Card>
            <Steps
              current={step}
              size="small"
              style={{ marginBottom: 28 }}
              items={[{ title: 'Choose file' }, { title: 'Match columns' }, { title: 'Review' }, { title: 'Done' }]}
            />

            {step === 0 && (
              <Spin spinning={busy}>
                <Flex vertical gap={16}>
                  {contacts.length === 0 && (
                    <Alert
                      type="info"
                      showIcon
                      title="Import your connections first — company data is matched to people already in your list."
                    />
                  )}
                  <Upload.Dragger
                    accept=".csv,text/csv"
                    showUploadList={false}
                    disabled={contacts.length === 0}
                    beforeUpload={(f) => {
                      void load(f)
                      return Upload.LIST_IGNORE
                    }}
                    style={{ padding: '24px 12px' }}
                  >
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <Typography.Text strong>Drop a CSV with company data</Typography.Text>
                    <br />
                    <Typography.Text type="secondary">
                      It needs a LinkedIn URL, name or company column to match people, plus any of: website, industry,
                      company size, company HQ, location. Company-only rows update everyone at that company.
                    </Typography.Text>
                  </Upload.Dragger>
                  {contacts.some((c) => c.source === 'sample') && (
                    <Flex align="center" gap={8} wrap>
                      <Typography.Text type="secondary">Using the sample people?</Typography.Text>
                      <Button
                        icon={<ExperimentOutlined />}
                        onClick={async () => {
                          const res = await fetch('/sample-company-data.csv')
                          await load(new File([await res.blob()], 'sample-company-data.csv', { type: 'text/csv' }))
                        }}
                      >
                        Try sample company data
                      </Button>
                    </Flex>
                  )}
                </Flex>
              </Spin>
            )}

            {step === 1 && file && (
              <Flex vertical gap={16}>
                <Alert
                  type={canMatch(mapping) && hasData(mapping) ? 'success' : 'warning'}
                  showIcon
                  title={
                    !canMatch(mapping)
                      ? 'Pick the column with LinkedIn URLs, names or companies, so rows can be matched to people.'
                      : !hasData(mapping)
                        ? 'Pick at least one column to add: website, industry, company size, company HQ or location.'
                        : `${file.table.rows.length.toLocaleString()} rows in ${file.name}. Check the matches below.`
                  }
                />
                <Table
                  size="small"
                  pagination={false}
                  rowKey="key"
                  dataSource={ENRICH_FIELDS.map((f) => ({ ...f }))}
                  columns={[
                    {
                      title: 'Field',
                      width: 220,
                      render: (_, f) => (
                        <Flex gap={8} align="center">
                          {mapping[f.key] !== undefined ? (
                            <CheckCircleFilled style={{ color: 'var(--success)' }} />
                          ) : (
                            <MinusCircleOutlined style={{ color: 'var(--text-3)' }} />
                          )}
                          <span style={{ fontWeight: 500 }}>{f.label}</span>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {f.role === 'match' ? 'to match' : 'to add'}
                          </Typography.Text>
                        </Flex>
                      ),
                    },
                    {
                      title: 'Column in your file',
                      width: 240,
                      render: (_, f) => (
                        <Select
                          allowClear
                          placeholder="Not in this file"
                          value={mapping[f.key]}
                          onChange={(v?: number) => setMapping({ ...mapping, [f.key]: v })}
                          options={file.table.headers.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }))}
                          style={{ width: '100%' }}
                        />
                      ),
                    },
                    {
                      title: 'Example',
                      render: (_, f) => sample(mapping[f.key]) ?? <Typography.Text type="secondary">—</Typography.Text>,
                    },
                  ]}
                />
                <Flex justify="space-between">
                  <Button onClick={restart}>Choose another file</Button>
                  <Button type="primary" disabled={!canMatch(mapping) || !hasData(mapping)} onClick={review}>
                    Continue
                  </Button>
                </Flex>
              </Flex>
            )}

            {step === 2 && plan && (
              <Flex vertical gap={18}>
                <Row gutter={[12, 12]}>
                  {[
                    { title: 'People updated', value: plan.updates.length },
                    { title: 'Already up to date', value: plan.unchanged },
                    { title: 'Rows not matched', value: plan.unmatched.length },
                  ].map((s) => (
                    <Col xs={24} sm={8} key={s.title}>
                      <Card size="small">
                        <Statistic title={s.title} value={s.value} />
                      </Card>
                    </Col>
                  ))}
                </Row>
                <Typography.Text type="secondary">
                  Rows are matched by LinkedIn URL first, then name and company, then name alone when it's unique; rows
                  with only a company update everyone there. A location or HQ you typed yourself is never overwritten.
                </Typography.Text>
                {plan.unmatched.length > 0 && (
                  <Collapse
                    size="small"
                    items={[
                      {
                        key: 'u',
                        label: `See the ${plan.unmatched.length} rows that weren't matched`,
                        children: (
                          <Table
                            size="small"
                            rowKey="row"
                            pagination={{ pageSize: 8, hideOnSinglePage: true }}
                            dataSource={plan.unmatched}
                            columns={[
                              { title: 'Row', dataIndex: 'row', width: 70 },
                              { title: 'Person', dataIndex: 'label', width: 220 },
                              { title: 'Why', dataIndex: 'reason' },
                            ]}
                          />
                        ),
                      },
                    ]}
                  />
                )}
                <Flex justify="space-between">
                  <Button onClick={() => setStep(1)}>Back</Button>
                  <Button type="primary" loading={busy} disabled={plan.updates.length === 0} onClick={apply}>
                    {plan.updates.length
                      ? `Update ${plan.updates.length.toLocaleString()} people`
                      : 'Nothing to update'}
                  </Button>
                </Flex>
              </Flex>
            )}

            {step === 3 && (
              <Result
                status="success"
                title={`${saved.toLocaleString()} ${saved === 1 ? 'person' : 'people'} updated`}
                subTitle="Website, industry and size now show in the grid, filters, the lead panel, AI scoring and exports."
                extra={[
                  <Button type="primary" key="people" onClick={() => navigate('/')}>
                    See your people
                  </Button>,
                  <Button key="again" onClick={restart}>
                    Add another file
                  </Button>,
                ]}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
