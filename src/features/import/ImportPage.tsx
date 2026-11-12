import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Steps } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
import { relativeTime } from '../../lib/format'
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
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<LoadedFile>()
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [plan, setPlan] = useState<ImportPlan>()
  const [record, setRecord] = useState<ImportRecord>()
  const past = useLiveQuery(() => db.imports.orderBy('at').reverse().limit(10).toArray(), [], [] as ImportRecord[])

  const restart = () => {
    setStep(0)
    setFile(undefined)
    setPlan(undefined)
    setRecord(undefined)
  }

  return (
    <div className="screen">
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
                    // Searches need web data, so collecting starts right away for the new connections.
                    if (r.added + r.updated > 0) navigate('/enrich?start=1')
                    else setStep(3)
                  }}
                />
              )}
              {step === 3 && record && <DoneStep record={record} onAnother={restart} />}
            </div>
          </Card>
          {past.length > 0 && (
            <div className="panel" style={{ padding: 0, marginTop: 20 }}>
              <div className="section-title" style={{ padding: '14px 20px' }}>
                Past imports
              </div>
              {past.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 20px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <span>{r.fileName}</span>
                  <span className="num" style={{ color: 'var(--text-3)', fontSize: 13 }}>
                    {r.added.toLocaleString()} added · {r.updated.toLocaleString()} updated · {relativeTime(r.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
