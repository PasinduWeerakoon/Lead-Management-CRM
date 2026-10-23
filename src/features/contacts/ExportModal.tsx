import { useState } from 'react'
import { App, Checkbox, Flex, Modal, Radio, Typography } from 'antd'
import { FileExcelOutlined, FileTextOutlined } from '../../components/icons'
import type { Contact } from '../../lib/schemas'
import { exportColumns, safeFileName, toExportRow } from '../../lib/export/rows'
import { toCsv, toXlsx } from '../../lib/export/writers'
import { downloadFile } from '../../lib/files'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  /** Everyone currently shown, and the ticked subset (may be empty). */
  shown: Contact[]
  selected: Contact[]
  skillTerms: string[]
  /** Where Skill Match terms come from, for the explanation. */
  skillSource: 'filter' | 'packs'
  filterSummary: string[]
  defaultScope: 'shown' | 'selected'
}

export function ExportModal({
  open,
  onClose,
  title,
  shown,
  selected,
  skillTerms,
  skillSource,
  filterSummary,
  defaultScope,
}: Props) {
  const { message } = App.useApp()
  const [scope, setScope] = useState<'shown' | 'selected'>(selected.length ? defaultScope : 'shown')
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [includeEmail, setIncludeEmail] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [busy, setBusy] = useState(false)

  const people = scope === 'selected' && selected.length ? selected : shown

  const run = async () => {
    setBusy(true)
    try {
      const opts = { skillTerms, includeNotes, includeEmail }
      const rows = people.map((c) => toExportRow(c, opts))
      const columns = exportColumns(opts)
      const name = `${safeFileName(title)}-${new Date().toISOString().slice(0, 10)}`
      if (format === 'xlsx') {
        const buf = await toXlsx(rows, columns, { title, filterSummary, generatedAt: new Date() })
        downloadFile(buf, `${name}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      } else {
        downloadFile(toCsv(rows, columns), `${name}.csv`, 'text/csv;charset=utf-8')
      }
      message.success(`Exported ${people.length.toLocaleString()} ${people.length === 1 ? 'person' : 'people'}.`)
      onClose()
    } catch {
      message.error('The export failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Export leads"
      okText={`Export ${people.length.toLocaleString()}`}
      okButtonProps={{ loading: busy, disabled: people.length === 0 }}
      onOk={run}
      onCancel={onClose}
      destroyOnHidden
    >
      <Flex vertical gap={18} style={{ marginTop: 12 }}>
        <Flex vertical gap={6}>
          <Typography.Text strong>Who</Typography.Text>
          <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
            <Flex vertical gap={6}>
              <Radio value="shown">Everyone in this list ({shown.length.toLocaleString()})</Radio>
              <Radio value="selected" disabled={selected.length === 0}>
                Only selected ({selected.length.toLocaleString()})
              </Radio>
            </Flex>
          </Radio.Group>
        </Flex>

        <Flex vertical gap={6}>
          <Typography.Text strong>Format</Typography.Text>
          <Radio.Group
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="xlsx">
              <FileExcelOutlined /> Excel (.xlsx)
            </Radio.Button>
            <Radio.Button value="csv">
              <FileTextOutlined /> CSV
            </Radio.Button>
          </Radio.Group>
        </Flex>

        <Flex vertical gap={6}>
          <Typography.Text strong>Include</Typography.Text>
          <Checkbox checked={includeEmail} onChange={(e) => setIncludeEmail(e.target.checked)}>
            Email addresses
          </Checkbox>
          <Checkbox checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)}>
            Your private notes
          </Checkbox>
        </Flex>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Columns follow the lead brief: name, title, company, location, LinkedIn URL, connection degree, skill match,
          company website, priority and reason for match. “Skill Match” lists{' '}
          {skillSource === 'filter' ? 'the keywords your filters look for' : 'keywords from all your keyword packs'}{' '}
          that appear in the title or company. Website stays empty until enrichment is added; nothing is made up.
        </Typography.Text>
      </Flex>
    </Modal>
  )
}
