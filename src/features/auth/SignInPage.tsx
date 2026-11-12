import { useEffect, useRef, useState } from 'react'
import { Alert } from 'antd'
import { Link } from 'react-router-dom'
import { IconInfoCircle, IconShieldLock } from '@tabler/icons-react'
import { useAuth } from './store'

interface GoogleId {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'

/** Loads Google's sign-in script once. */
function loadGis(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('gis')))
    s.onerror = () => reject(new Error('gis'))
    document.head.appendChild(s)
  })
}

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ flex: 'none', marginTop: 2, color: 'var(--text-3)' }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}

/** The only screen people see before signing in: a Google button and the privacy notes. */
export function SignInPage() {
  const { clientId, message, signInWithGoogle } = useAuth()
  const btnRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    loadGis()
      .then((gis) => {
        if (cancelled || !btnRef.current) return
        gis.initialize({ client_id: clientId, callback: (r) => void signInWithGoogle(r.credential) })
        gis.renderButton(btnRef.current, { theme: 'outline', size: 'large', text: 'continue_with', width: 328 })
      })
      .catch(() => setLoadError(true))
    return () => {
      cancelled = true
    }
  }, [clientId, signInWithGoogle])

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        color: 'var(--text-2)',
      }}
    >
      <header style={{ padding: '24px 32px', fontWeight: 600, color: 'var(--text)', fontSize: 15 }}>
        Leads Manager
      </header>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            background: 'var(--bg-header)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow-pop)',
            padding: '36px 36px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>
              Sign in to your workspace
            </h1>
            <p style={{ margin: 0, color: 'var(--text-3)' }}>1 Billion Technology</p>
          </div>

          {message && <Alert type="error" showIcon title={message} />}
          {loadError && (
            <Alert type="error" showIcon title="Couldn’t load Google sign-in. Check your connection and reload." />
          )}
          <div ref={btnRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              paddingTop: 20,
              borderTop: '1px solid var(--border-subtle)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <Note icon={<IconShieldLock size={16} stroke={1.8} />}>
              Use your @1billiontech.com Google account. By signing in you agree to the{' '}
              <Link to="/privacy">privacy policy</Link>.
            </Note>
            <Note icon={<IconInfoCircle size={16} stroke={1.8} />}>
              Your sign-ins and actions are logged to protect personal data under the PDPA.
            </Note>
          </div>
        </div>
      </main>
      <footer
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 20,
          padding: 24,
          fontSize: 12.5,
          color: 'var(--text-3)',
        }}
      >
        <span>© 2026 1 Billion Technology</span>
        <Link to="/privacy">Privacy and PDPA</Link>
      </footer>
    </div>
  )
}
