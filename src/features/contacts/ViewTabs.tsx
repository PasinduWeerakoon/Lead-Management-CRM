import { Button, Tooltip } from 'antd'
import { PlusOutlined, TableOutlined } from '../../components/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'

interface Props {
  activeId?: string
  shown: number
  total: number
  dirty: boolean
  canSave: boolean
  onSaveNew: () => void
  onSaveChanges: () => void
}

/** Saved views as tabs along the bottom of the sheet, with a live "match" readout on the right. */
export function ViewTabs({ activeId, shown, total, dirty, canSave, onSaveNew, onSaveChanges }: Props) {
  const navigate = useNavigate()
  const views = useLiveQuery(() => db.views.orderBy('createdAt').toArray(), [], [])
  const pct = total ? Math.round((shown / total) * 100) : 0

  return (
    <div className="viewbar">
      <div className="viewtabs" role="tablist" aria-label="Views">
        <button
          type="button"
          role="tab"
          aria-selected={!activeId}
          className={`viewtab${!activeId ? ' active' : ''}`}
          onClick={() => navigate('/')}
        >
          <TableOutlined /> All people
        </button>
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={activeId === v.id}
            className={`viewtab${activeId === v.id ? ' active' : ''}`}
            onClick={() => navigate(`/?view=${v.id}`)}
          >
            <TableOutlined /> {v.name}
            {activeId === v.id && dirty && (
              <Tooltip title="Unsaved changes">
                <span className="dot" style={{ background: '#e0a100', margin: 0 }} />
              </Tooltip>
            )}
          </button>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 10px' }}>
          <Tooltip title={canSave ? 'Save these filters as a new view' : 'Add a filter first, then save it as a view'}>
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={onSaveNew} disabled={!canSave}>
              Save view
            </Button>
          </Tooltip>
        </span>
      </div>

      <div className="viewbar-right">
        {activeId && dirty ? (
          <>
            <span>This view has unsaved changes</span>
            <Button size="small" type="primary" onClick={onSaveChanges}>
              Save changes
            </Button>
          </>
        ) : (
          <>
            <span className="meter" style={{ width: 90 }} aria-hidden>
              <span style={{ width: `${pct}%`, background: 'var(--primary)' }} />
            </span>
            <span>
              {shown.toLocaleString()} of {total.toLocaleString()} people shown
            </span>
          </>
        )}
      </div>
    </div>
  )
}
