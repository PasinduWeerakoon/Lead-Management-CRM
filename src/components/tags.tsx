import type { LeadStatus, Priority, Seniority } from '../lib/schemas'

/** Quiet status/priority styling: a coloured dot and plain text, not loud pills. */
export const STATUS_META: Record<LeadStatus, { label: string; dot: string }> = {
  new: { label: 'New', dot: '#a1a1aa' },
  shortlisted: { label: 'Shortlisted', dot: '#e0a100' },
  contacted: { label: 'Contacted', dot: '#1a9d55' },
  not_a_fit: { label: 'Not a fit', dot: '#d93025' },
}

export const PRIORITY_DOT: Record<Priority, string> = { High: '#d93025', Medium: '#e08600', Low: '#1f6feb' }

export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />
}

export function StatusText({ value }: { value: LeadStatus }) {
  return (
    <span>
      <Dot color={STATUS_META[value].dot} />
      {STATUS_META[value].label}
    </span>
  )
}

export function SeniorityText({ value }: { value: Seniority }) {
  return <span>{value === 'IC' ? 'Individual' : value}</span>
}
