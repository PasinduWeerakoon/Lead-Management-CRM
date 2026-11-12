import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  authMode,
  handleAuth,
  isAllowedEmail,
  makeSessionCookie,
  readSession,
  requireUser,
  verifyGoogleToken,
} from '../api/_auth'

const CLIENT = 'test-client.apps.googleusercontent.com'
const withCookie = (cookie: string) =>
  new Request('http://localhost/api/profiles', { headers: { cookie: cookie.split(';')[0] } })
const tokenInfo = (over: Record<string, unknown> = {}) =>
  (async () =>
    new Response(
      JSON.stringify({
        aud: CLIENT,
        iss: 'https://accounts.google.com',
        email: 'someone@1billiontech.com',
        email_verified: 'true',
        name: 'Some One',
        exp: String(Math.floor(Date.now() / 1000) + 600),
        ...over,
      }),
    )) as unknown as typeof fetch

describe('Google sign-in', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = CLIENT
    process.env.SESSION_SECRET = 'x'.repeat(40)
  })
  afterEach(() => {
    for (const k of ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'ALLOWED_EMAILS', 'VERCEL']) delete process.env[k]
  })

  it('is off on the local dev server without a client id, and refuses when hosted', () => {
    delete process.env.GOOGLE_CLIENT_ID
    expect(authMode()).toBe('off')
    expect(requireUser(new Request('http://localhost/'))).toBeUndefined()
    process.env.VERCEL = '1'
    expect(authMode()).toBe('broken')
    expect(requireUser(new Request('http://localhost/'))?.status).toBe(503)
  })

  it('needs a valid session cookie', () => {
    expect(requireUser(new Request('http://localhost/'))?.status).toBe(401)
    const cookie = makeSessionCookie({ email: 'someone@1billiontech.com', name: 'Some One' })
    expect(readSession(withCookie(cookie))?.email).toBe('someone@1billiontech.com')
    expect(requireUser(withCookie(cookie))).toBeUndefined()
  })

  it('rejects a changed or expired cookie', () => {
    const cookie = makeSessionCookie({ email: 'someone@1billiontech.com', name: 'Some One' })
    const [payload, sig] = cookie.split(';')[0].split('=')[1].split('.')
    const forged = Buffer.from(
      JSON.stringify({ email: 'boss@1billiontech.com', name: 'B', exp: Date.now() + 1e9 }),
    ).toString('base64url')
    expect(readSession(withCookie(`lm_session=${forged}.${sig}`))).toBeNull()
    expect(readSession(withCookie(`lm_session=${payload}.${sig}`), Date.now() + 15 * 86_400_000)).toBeNull()
  })

  it('only allows the company domain and listed emails', () => {
    expect(isAllowedEmail('a@1billiontech.com')).toBe(true)
    expect(isAllowedEmail('a@gmail.com')).toBe(false)
    process.env.ALLOWED_EMAILS = 'partner@example.com'
    expect(isAllowedEmail('Partner@example.com')).toBe(true)
  })

  it('checks the Google token', async () => {
    expect(await verifyGoogleToken('t', tokenInfo())).toMatchObject({ email: 'someone@1billiontech.com' })
    expect(await verifyGoogleToken('t', tokenInfo({ aud: 'other' }))).toHaveProperty('error')
    expect(await verifyGoogleToken('t', tokenInfo({ email: 'x@gmail.com' }))).toHaveProperty('error')
    expect(await verifyGoogleToken('t', tokenInfo({ email_verified: 'false' }))).toHaveProperty('error')
  })

  it('signs in and sets an httpOnly cookie', async () => {
    const res = await handleAuth(
      new Request('http://localhost/api/auth', { method: 'POST', body: JSON.stringify({ credential: 'tok' }) }),
      tokenInfo(),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/lm_session=.+HttpOnly/)
    const denied = await handleAuth(
      new Request('http://localhost/api/auth', { method: 'POST', body: JSON.stringify({ credential: 'tok' }) }),
      tokenInfo({ email: 'x@gmail.com' }),
    )
    expect(denied.status).toBe(403)
  })
})
