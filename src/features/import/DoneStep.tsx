import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'
import { resetFilters } from '../filters/store'
import type { ImportRecord } from '../../lib/schemas'

export function DoneStep({ record, onAnother }: { record: ImportRecord; onAnother: () => void }) {
  const navigate = useNavigate()
  const parts = [
    record.added && `${record.added.toLocaleString()} added`,
    record.updated && `${record.updated.toLocaleString()} updated`,
    record.skipped && `${record.skipped.toLocaleString()} skipped`,
  ].filter(Boolean)

  return (
    <Result
      status="success"
      title="Your connections are in"
      subTitle={`${parts.join(' · ')}. Next, collect web data so searches have something to work with.`}
      extra={[
        <Button type="primary" key="collect" onClick={() => navigate('/enrich?start=1')}>
          Next: collect web data
        </Button>,
        <Button
          key="view"
          onClick={() => {
            // Show the whole list after an import, not whatever filter was active before it.
            resetFilters()
            navigate('/')
          }}
        >
          See connections
        </Button>,
        <Button key="another" onClick={onAnother}>
          Import another file
        </Button>,
      ]}
    />
  )
}
