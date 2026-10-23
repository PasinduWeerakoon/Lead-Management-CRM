import { useState } from 'react'
import { Card, Steps } from 'antd'
import { CloudUploadOutlined } from '../../components/icons'
import { TopBar } from '../../components/TopBar'
import { PageHeader } from '../../components/PageHeader'
import { resetFilters } from '../filters/store'
import type { ColumnMapping, ParsedTable } from '../../lib/csv'
import type { ImportPlan } from '../../lib/import-service'
import type { ContactSource, ImportRecord } from '../../lib/schemas'
import { UploadStep } from './UploadStep'
import { MappingStep } from './MappingStep'
import { ReviewStep } from './ReviewStep'
import { DoneStep } from './DoneStep'

export interface LoadedFile {
  name: string
  source: ContactSource
  table: ParsedTable
}

export function ImportPage() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<LoadedFile>()
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [plan, setPlan] = useState<ImportPlan>()
  const [record, setRecord] = useState<ImportRecord>()

  const restart = () => {
    setStep(0)
    setFile(undefined)
    setPlan(undefined)
    setRecord(undefined)
  }

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Import', icon: <CloudUploadOutlined /> }, { label: 'LinkedIn connections' }]} />
      <div className="screen-body">
        <div className="screen-narrow" style={{ maxWidth: 920 }}>
          <PageHeader
            title="Import connections"
            description="Bring in your LinkedIn export. Re-importing later updates people without losing your notes."
          />
          <Card>
            <Steps
              current={step}
              size="small"
              style={{ marginBottom: 28 }}
              items={[{ title: 'Choose file' }, { title: 'Match columns' }, { title: 'Review' }, { title: 'Done' }]}
            />

            <div key={step} className="fade-in">
              {step === 0 && (
                <UploadStep
                  onLoaded={(f, m) => {
                    setFile(f)
                    setMapping(m)
                    setStep(1)
                  }}
                />
              )}
              {step === 1 && file && (
                <MappingStep
                  file={file}
                  mapping={mapping}
                  onChange={setMapping}
                  onBack={restart}
                  onPlanned={(p) => {
                    setPlan(p)
                    setStep(2)
                  }}
                />
              )}
              {step === 2 && file && plan && (
                <ReviewStep
                  file={file}
                  plan={plan}
                  onBack={() => setStep(1)}
                  onDone={(r) => {
                    // New data: start from the full list, whichever way you go back to People.
                    resetFilters()
                    setRecord(r)
                    setStep(3)
                  }}
                />
              )}
              {step === 3 && record && <DoneStep record={record} onAnother={restart} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
