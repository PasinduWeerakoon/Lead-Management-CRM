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
      subTitle={`${parts.join(' · ')}. Saved to this profile. Without a shared database connected, it lives only in this browser — make a backup from Settings now and then.`}
      extra={[
        <Button
          type="primary"
          key="view"
          onClick={() => {
            // Show the whole list after an import, not whatever filter was active before it.
            resetFilters()
            navigate('/')
          }}
        >
          See your contacts
        </Button>,
        <Button key="enrich" onClick={() => navigate('/enrich')}>
          Add company data
        </Button>,
        <Button key="another" onClick={onAnother}>
          Import another file
        </Button>,
      ]}
    />
  )
}
