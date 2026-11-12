import { useMemo, useState } from 'react'
import { Layout } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import { useLocation, useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import type { Contact, ScoreRun } from '../lib/schemas'
import { ProfileSwitcher, SyncStatus } from './ProfileSwitcher'
import { useAuth } from '../features/auth/store'
import { coverage } from '../features/home/HomePage'
import { groupSearches } from '../features/ai/ResultsPage'

interface Item {
  to: string
  label: string
  /** Paths that also count as this item, e.g. /results/new under Searches. */
  also?: string[]
  count?: string
  countTone?: 'accent' | 'muted'
}

function NavLink({ item, active, onGo }: { item: Item; active: boolean; onGo: (to: string) => void }) {
  return (
    <a
      href={item.to}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault()
        onGo(item.to)
      }}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        padding: '9px 10px',
        borderRadius: 7,
        textDecoration: 'none',
        fontSize: 14,
        background: active ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--text-2)',
        fontWeight: active ? 500 : 400,
      }}
    >
      <span>{item.label}</span>
      {item.count && (
        <span
          className="num"
          style={{
            fontSize: 13,
            color: item.countTone === 'accent' ? 'var(--primary)' : 'var(--text-3)',
            fontWeight: 400,
          }}
        >
          {item.count}
        </span>
      )}
    </a>
  )
}

/** Who is signed in, with a sign-out link. */
function SignedInAs() {
  const { user, signOut } = useAuth()
  if (!user) return null
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 10px' }}
    >
      <span
        title={user.email}
        style={{
          fontSize: 12.5,
          color: 'var(--text-3)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {user.email}
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        style={{
          border: 0,
          background: 'none',
          padding: 0,
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 12.5,
          color: 'var(--primary)',
        }}
      >
        Sign out
      </button>
    </div>
  )
}

/** Profile, Home, the four steps in order, then Settings. */
export function Sidebar() {
  const go = useNavigate()
  const { pathname } = useLocation()
  // On a phone the menu is hidden behind a Menu button and closes after picking a page.
  const [small, setSmall] = useState(false)
  const [open, setOpen] = useState(false)
  const navigate = (to: string) => {
    go(to)
    if (small) setOpen(false)
  }
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], [] as Contact[])
  const runs = useLiveQuery(() => db.scoreRuns.toArray(), [], [] as ScoreRun[])
  const pct = useMemo(() => coverage(contacts).percent, [contacts])
  const searches = useMemo(() => groupSearches(runs).length, [runs])

  const steps: Item[] = [
    { to: '/import', label: '1 Import' },
    {
      to: '/enrich',
      label: '2 Collect web data',
      also: ['/enrich/csv'],
      count: contacts.length ? `${pct}%` : undefined,
      countTone: 'accent',
    },
    { to: '/', label: '3 Connections', also: ['/table'], count: contacts.length.toLocaleString() },
    { to: '/results', label: '4 Searches', also: ['/results/new'], count: searches.toLocaleString() },
  ]
  const isActive = (i: Item) => pathname === i.to || !!i.also?.includes(pathname)

  return (
    <>
      {small && (
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{
            position: 'fixed',
            top: 'calc(10px + env(safe-area-inset-top, 0px))',
            right: 12,
            zIndex: 1001,
            height: 38,
            padding: '0 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-header)',
            color: 'var(--ink)',
            font: 'inherit',
            fontWeight: 500,
            boxShadow: 'var(--shadow-sm)',
            cursor: 'pointer',
          }}
        >
          {open ? 'Close' : 'Menu'}
        </button>
      )}
      <Layout.Sider
        width={240}
        breakpoint="md"
        collapsedWidth={0}
        collapsed={small && !open}
        onBreakpoint={(b) => {
          setSmall(b)
          setOpen(false)
        }}
        trigger={null}
        style={{
          background: 'var(--bg-header)',
          borderRight: '1px solid var(--border)',
          ...(small
            ? {
                position: 'fixed',
                zIndex: 1000,
                height: '100%',
                left: 0,
                top: 0,
                width: 260,
                minWidth: 260,
                maxWidth: '85vw',
                boxShadow: 'var(--shadow-pop)',
              }
            : {}),
        }}
      >
        <nav
          aria-label="Main"
          style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '18px 12px' }}
        >
          <div style={{ marginBottom: 14 }}>
            <ProfileSwitcher collapsed={false} />
          </div>
          <NavLink item={{ to: '/home', label: 'Home' }} active={pathname === '/home'} onGo={navigate} />
          <span style={{ fontSize: 12, color: 'var(--text-3)', padding: '14px 10px 4px' }}>Steps</span>
          {steps.map((s) => (
            <NavLink key={s.to} item={s} active={isActive(s)} onGo={navigate} />
          ))}
          <span style={{ flex: 1 }} />
          <NavLink
            item={{ to: '/settings', label: 'Settings' }}
            active={['/settings', '/ai', '/briefs', '/keyword-packs', '/presets', '/accuracy'].includes(pathname)}
            onGo={navigate}
          />
          <NavLink
            item={{ to: '/privacy', label: 'Privacy and PDPA' }}
            active={pathname === '/privacy'}
            onGo={navigate}
          />
          <SignedInAs />
          <div style={{ padding: '4px 10px 0' }}>
            <SyncStatus />
          </div>
        </nav>
      </Layout.Sider>
    </>
  )
}
