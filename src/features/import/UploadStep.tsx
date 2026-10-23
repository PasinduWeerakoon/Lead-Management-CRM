import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { App, Button, Collapse, Flex, Spin, Typography, Upload } from 'antd'
import { ExperimentOutlined, InboxOutlined } from '../../components/icons'
import { autoMapColumns, type ColumnMapping } from '../../lib/csv'
import { parseCsvFile } from '../../lib/files'
import type { LoadedFile } from './ImportPage'

export function UploadStep({ onLoaded }: { onLoaded: (file: LoadedFile, mapping: ColumnMapping) => void }) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)

  const load = async (blob: Blob, name: string, source: LoadedFile['source']) => {
    setBusy(true)
    try {
      const table = await parseCsvFile(blob)
      if (table.rows.length === 0) {
        message.warning("We couldn't find any rows in that file. Is it the Connections.csv file?")
        return
      }
      onLoaded({ name, source, table }, autoMapColumns(table.headers))
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Could not read this file.')
    } finally {
      setBusy(false)
    }
  }

  const loadSample = async () => {
    const res = await fetch('/sample-connections.csv')
    await load(await res.blob(), 'sample-connections.csv', 'sample')
  }

  // "Try sample data" on the welcome screen links here with ?sample=1. Run once, after mount.
  const [params, setParams] = useSearchParams()
  const sampleStarted = useRef(false)
  useEffect(() => {
    if (params.get('sample') !== '1' || sampleStarted.current) return
    sampleStarted.current = true
    setParams({}, { replace: true })
    // Not cancelled on cleanup: clearing the URL re-renders, and the ref already guarantees one run.
    setTimeout(() => void loadSample(), 0)
  })

  return (
    <Spin spinning={busy} description="Reading your file…">
      <Flex vertical gap={20}>
        <Upload.Dragger
          accept=".csv,text/csv"
          multiple={false}
          showUploadList={false}
          beforeUpload={(file) => {
            void load(file, file.name, 'linkedin_export')
            return Upload.LIST_IGNORE
          }}
          style={{ padding: '28px 12px' }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Drop your Connections.csv here
          </Typography.Title>
          <Typography.Text type="secondary">or click to choose a file · CSV up to 20 MB</Typography.Text>
        </Upload.Dragger>

        <Collapse
          ghost
          items={[
            {
              key: 'how',
              label: "Don't have the file yet? Here's how to get it from LinkedIn",
              children: (
                <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                  <li>
                    On LinkedIn, open <b>Me → Settings &amp; Privacy → Data privacy</b>.
                  </li>
                  <li>
                    Under “How LinkedIn uses your data”, click <b>Download your data</b>.
                  </li>
                  <li>
                    Tick <b>Connections</b> under “Select the data files you're most interested in”. If Connections
                    isn't listed for your account, choose <b>Download larger data archive</b> instead — it includes
                    connections.
                  </li>
                  <li>
                    Click <b>Request archive</b> (LinkedIn asks for your password). The email arrives in about 10
                    minutes for Connections only, or up to 24 hours for the larger archive. Then return to the same page
                    and click <b>Download archive</b>.
                  </li>
                  <li>
                    Unzip it and drop <b>Connections.csv</b> above.
                  </li>
                </ol>
              ),
            },
          ]}
        />

        <Flex align="center" gap={8} wrap>
          <Typography.Text type="secondary">Just exploring?</Typography.Text>
          <Button icon={<ExperimentOutlined />} onClick={loadSample}>
            Try with sample data
          </Button>
        </Flex>
      </Flex>
    </Spin>
  )
}
