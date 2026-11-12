import { useState } from 'react'
import { Button, Flex, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { Check, Contact, ScoreRun } from '../../lib/schemas'

type Person = ScoreRun['people'][number]

const FIT = (score: number) =>
  score >= 70
    ? { label: 'Strong fit', color: 'var(--success)', bg: 'rgba(22,163,74,.12)' }
    : score >= 40
      ? { label: 'Possible fit', color: 'var(--warning)', bg: 'rgba(217,119,6,.12)' }
      : { label: 'Weak fit', color: 'var(--text-2)', bg: 'var(--bg-hover)' }

const MARK: Record<Check['status'], { sign: string; color: string; label: string }> = {
  met: { sign: '✓', color: 'var(--success)', label: 'Met' },
  not_met: { sign: '✕', color: '#d93025', label: 'Not met' },
  unknown: { sign: '?', color: 'var(--warning)', label: 'Unknown' },
}

function CheckRow({ check, n }: { check: Check; n: number }) {
  const m = MARK[check.status]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 8, fontSize: 13.5 }}>
      <span
        aria-label={m.label}
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 700,
          color: m.color,
          border: `1.5px solid ${m.color}`,
        }}
      >
        {m.sign}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ color: 'var(--ink)' }}>
          {n}. {check.criterion}
        </span>
        <span style={{ display: 'block', color: 'var(--text-2)', fontSize: 13 }}>
          <b style={{ color: m.color, fontWeight: 500 }}>{m.label}.</b> {check.evidence}
        </span>
      </span>
    </div>
  )
}

/** One person in a search result: fit, each condition with evidence, the reasoning, and openings. */
export function ResultCard({
  person: p,
  contact,
  isNew,
  opportunities,
}: {
  person: Person
  contact?: Contact
  isNew: boolean
  opportunities: React.ReactNode
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const fit = FIT(p.score)
  return (
    <article className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <div style={{ minWidth: 0 }}>
          <Flex gap={8} align="center" wrap>
            <b style={{ fontSize: 16, color: 'var(--ink)' }}>{p.name}</b>
            {isNew && (
              <Tag color="blue" style={{ margin: 0 }}>
                New since last run
              </Tag>
            )}
          </Flex>
          <span style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
            {[p.position, p.company].filter(Boolean).join(' at ')}
          </span>
        </div>
        <Flex gap={8} align="center">
          <span style={{ fontSize: 12.5, color: fit.color }}>{fit.label}</span>
          <span
            className="num"
            style={{
              padding: '4px 10px',
              borderRadius: 8,
              background: fit.bg,
              color: fit.color,
              fontFamily: 'var(--mono)',
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            {p.score}
          </span>
        </Flex>
      </Flex>

      {!!p.checks?.length && (
        <Flex vertical gap={8}>
          {p.checks.map((c, i) => (
            <CheckRow key={i} check={c} n={i + 1} />
          ))}
        </Flex>
      )}

      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', display: 'block', marginBottom: 2 }}>AI reasoning</span>
        {p.reason}
      </div>

      {p.missing && (
        <div
          style={{
            fontSize: 13,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(217,119,6,.08)',
            color: 'var(--text-2)',
          }}
        >
          <b style={{ color: 'var(--warning)', fontWeight: 500 }}>Missing data: </b>
          {p.missing}
        </div>
      )}

      <Flex gap={8} wrap>
        <Button size="small" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide opportunities' : 'Show opportunities and technologies'}
        </Button>
        {contact && (
          <Button size="small" type="link" onClick={() => navigate(`/?open=${contact.id}`)}>
            Open full profile
          </Button>
        )}
      </Flex>
      {open && opportunities}
    </article>
  )
}
