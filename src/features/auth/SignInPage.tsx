import { useState } from 'react'
import { Alert, Button, Form, Input, Segmented } from 'antd'
import { Link } from 'react-router-dom'
import { IconInfoCircle, IconShieldLock } from '@tabler/icons-react'
import { useAuth } from './store'

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ flex: 'none', marginTop: 2, color: 'var(--text-3)' }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}

/** The only screen people see before signing in: sign in or create an account, and the privacy notes. */
export function SignInPage() {
  const { message, notice, signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm<{ email: string; username?: string; password: string; confirm?: string }>()

  const submit = async (v: { email: string; username?: string; password: string }) => {
    setBusy(true)
    try {
      if (mode === 'signin') await signIn(v.email, v.password)
      else if (await signUp(v.email, v.username ?? '', v.password)) {
        form.resetFields(['password', 'confirm'])
        setMode('signin')
      }
    } finally {
      setBusy(false)
    }
  }

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
              {mode === 'signin' ? 'Sign in to your workspace' : 'Create your account'}
            </h1>
            <p style={{ margin: 0, color: 'var(--text-3)' }}>1 Billion Technology</p>
          </div>

          <Segmented
            block
            value={mode}
            onChange={(v) => setMode(v as 'signin' | 'signup')}
            options={[
              { value: 'signin', label: 'Sign in' },
              { value: 'signup', label: 'Create account' },
            ]}
          />
          {notice && <Alert type="success" showIcon title={notice} />}
          {message && <Alert type="error" showIcon title={message} />}
          <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => void submit(v)}>
            <Form.Item
              name="email"
              label="Email"
              rules={[{ required: true, type: 'email', message: 'Enter your email.' }]}
            >
              <Input autoComplete="email" inputMode="email" autoFocus />
            </Form.Item>
            {mode === 'signup' && (
              <Form.Item
                name="username"
                label="Username"
                rules={[{ required: true, min: 3, max: 40, message: 'Use 3 to 40 characters.' }]}
              >
                <Input autoComplete="nickname" />
              </Form.Item>
            )}
            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: 'Enter your password.' },
                ...(mode === 'signup' ? [{ min: 10, message: 'Use at least 10 characters.' }] : []),
              ]}
            >
              <Input.Password autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            </Form.Item>
            {mode === 'signup' && (
              <Form.Item
                name="confirm"
                label="Repeat password"
                dependencies={['password']}
                rules={[
                  { required: true, message: 'Repeat the password.' },
                  ({ getFieldValue }) => ({
                    validator: (_, v) =>
                      !v || v === getFieldValue('password')
                        ? Promise.resolve()
                        : Promise.reject(new Error('The passwords don’t match.')),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            )}
            <Button type="primary" htmlType="submit" block loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </Form>
          {mode === 'signup' && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
              New accounts can sign in after the super admin approves them.
            </p>
          )}

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
              By signing in you agree to the <Link to="/privacy">privacy policy</Link>.
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
