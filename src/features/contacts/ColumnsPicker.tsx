import { useState } from 'react'
import { Checkbox, Flex, Popover, Typography } from 'antd'
import { InsertRowRightOutlined } from '../../components/icons'
import { COLUMN_DEFS, DEFAULT_HIDDEN, type ColumnKey } from './columns'

// v6: Website, Industry and Company size shown again (Company research fills them); older choices reset once.
const STORAGE_KEY = 'leads.hiddenColumns.v6'

function readHidden(): ColumnKey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (Array.isArray(parsed)) return parsed.filter((k): k is ColumnKey => COLUMN_DEFS.some((d) => d.key === k))
  } catch {
    // ignore — fall back to defaults
  }
  return DEFAULT_HIDDEN
}

/** Which columns are shown. Remembered per browser; Name is always shown. */
export function useVisibleColumns() {
  const [hidden, setHidden] = useState<ColumnKey[]>(readHidden)
  const save = (next: ColumnKey[]) => {
    setHidden(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // non-critical
    }
  }
  const visible = COLUMN_DEFS.map((d) => d.key).filter((k) => !hidden.includes(k))
  return { visible, hidden, setHidden: save }
}

export function ColumnsPicker({ hidden, onChange }: { hidden: ColumnKey[]; onChange: (h: ColumnKey[]) => void }) {
  const total = COLUMN_DEFS.length
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      content={
        <Flex vertical gap={6} style={{ minWidth: 200 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Show columns
          </Typography.Text>
          {COLUMN_DEFS.map((d) => (
            <Checkbox
              key={d.key}
              disabled={d.key === 'name'}
              checked={!hidden.includes(d.key)}
              onChange={(e) => onChange(e.target.checked ? hidden.filter((k) => k !== d.key) : [...hidden, d.key])}
            >
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-2)' }}>{d.icon}</span>
                {d.title}
              </span>
            </Checkbox>
          ))}
        </Flex>
      }
    >
      <button type="button" className="tool-btn" aria-label="Choose columns">
        <InsertRowRightOutlined /> {total - hidden.length}/{total}
      </button>
    </Popover>
  )
}
