import { useState } from 'react'
import {
  IconBrandLinkedin,
  IconBuilding,
  IconCheck,
  IconChecklist,
  IconDatabase,
  IconLoader2,
  IconSparkles,
  IconUserSearch,
  IconWorldSearch,
} from '@tabler/icons-react'
import type { LogStep } from '../../lib/schemas'

const ICON: Record<LogStep['kind'], React.ReactNode> = {
  check: <IconChecklist size={16} stroke={1.7} />,
  company: <IconBuilding size={16} stroke={1.7} />,
  web: <IconWorldSearch size={16} stroke={1.7} />,
  registry: <IconDatabase size={16} stroke={1.7} />,
  person: <IconUserSearch size={16} stroke={1.7} />,
  linkedin: <IconBrandLinkedin size={16} stroke={1.7} />,
  score: <IconSparkles size={16} stroke={1.7} />,
  done: <IconCheck size={16} stroke={1.7} />,
}

/** Which icon a step gets, from what it says. */
export function kindOf(text: string, fallback: LogStep['kind']): LogStep['kind'] {
  // Only company-collection messages are re-sorted; prompt, people, LinkedIn and scoring steps keep theirs.
  if (fallback !== 'company') return fallback
  if (/^Reading |says about itself/.test(text)) return 'company'
  if (/^Searching the web|^Finding websites/.test(text)) return 'web'
  if (/registr|job boards|Reused/.test(text)) return 'registry'
  return fallback
}

const secs = (steps: LogStep[]) =>
  steps.length > 1 ? Math.max(1, Math.round((Date.parse(steps.at(-1)!.at) - Date.parse(steps[0].at)) / 1000)) : 0

/**
 * The steps a search took, in order: what was checked, read and searched, and what came of it.
 * Live while running (latest step spinning), and saved with the run so it can be read later.
 */
export function ActivityLog({
  steps,
  live = false,
  defaultOpen = live,
}: {
  steps: LogStep[]
  live?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!steps.length) return null
  const shown = open ? steps : steps.slice(-1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          alignSelf: 'flex-start',
          border: 0,
          background: 'none',
          padding: 0,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 13.5,
          color: 'var(--text-3)',
        }}
      >
        {live ? 'Working' : 'Worked'} for {secs(steps)}s · {steps.length} steps {open ? '▴' : '▾'}
      </button>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((s, i) => {
          const last = live && s === steps.at(-1)
          return (
            <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5 }}>
              <span
                aria-hidden
                style={{
                  flex: 'none',
                  marginTop: 2,
                  color: s.kind === 'linkedin' ? '#0a66c2' : last ? 'var(--primary)' : 'var(--text-3)',
                }}
                className={last ? 'spin' : undefined}
              >
                {last ? <IconLoader2 size={16} stroke={1.7} /> : ICON[s.kind]}
              </span>
              <span style={{ color: last ? 'var(--ink)' : 'var(--text-2)', minWidth: 0, overflowWrap: 'anywhere' }}>
                {s.kind === 'linkedin' && <b style={{ color: '#0a66c2', fontWeight: 600 }}>LinkedIn · </b>}
                {s.text}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
