import { createHmac, timingSafeEqual } from 'node:crypto'
import { getDb, isHosted, json } from './_db.js'

/**
 * Google sign-in. The browser gets a Google ID token from Google's button and posts it here; we check
 * it with Google, check the email is allowed, then keep the person signed in with a signed,
 * httpOnly session cookie. Every other /api route calls `checkAccess`, which reads that cookie.
 *
 * Settings (server only): GOOGLE_CLIENT_ID, SESSION_SECRET, ALLOWED_DOMAIN (default
 * 1billiontech.com) and ALLOWED_EMAILS (extra addresses outside the domain, comma separated).
 * On the local dev server, leaving GOOGLE_CLIENT_ID unset turns sign-in off; when hosted it never is.
 */

export interface SessionUser {
  email: string
  name: string
  picture?: string
}

const COOKIE = 'lm_session'
const SESSION_DAYS = 14

const clientId = () => process.env.GOOGLE_CLIENT_ID?.trim() || ''
const secret = () => process.env.SESSION_SECRET?.trim() || ''
const allowedDomain = () => (process.env.ALLOWED_DOMAIN?.trim() || '1billiontech.com').toLowerCase()
const allowedEmails = () =>
  (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

/** 'on' = sign-in required, 'off' = local dev without a client id, 'broken' = hosted but not set up. */
export function authMode(): 'on' | 'off' | 'broken' {
  if (clientId() && secret().length >= 32) return 'on'
  return isHosted() ? 'broken' : 'off'
}

const LOCAL_USER: SessionUser = { email: 'local@dev', name: 'Local developer' }

export function isAllowedEmail(email: string): boolean {
  const e = email.toLowerCase()
  return e.endsWith('@' + allowedDomain()) || allowedEmails().includes(e)
}

const b64 = (s: string) => Buffer.from(s).toString('base64url')
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

export function makeSessionCookie(user: SessionUser, now = Date.now()): string {
  const payload = b64(JSON.stringify({ ...user, exp: now + SESSION_DAYS * 86_400_000 }))
  const secure = isHosted() ? '; Secure' : ''
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`
}

const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHosted() ? '; Secure' : ''}`

/** The signed-in person from the request's cookie, or null. */
export function readSession(request: Request, now = Date.now()): SessionUser | null {
  if (authMode() === 'off') return LOCAL_USER
  if (authMode() !== 'on') return null
  const raw = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1)
  if (!raw) return null
  const [payload, sig] = raw.split('.')
  if (!payload || !sig) return null
  const want = Buffer.from(sign(payload))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionUser & { exp: number }
    if (typeof data.exp !== 'number' || data.exp < now || !isAllowedEmail(data.email)) return null
    return { email: data.email, name: data.name, picture: data.picture }
  } catch {
    return null
  }
}

/** Used by every data route: a 401 when nobody is signed in, otherwise undefined. */
export function requireUser(request: Request): Response | undefined {
  if (readSession(request)) return undefined
  if (authMode() === 'broken')
    return json(503, { error: 'Sign-in isn’t set up on the server.', code: 'auth_not_set_up' })
  return json(401, { error: 'Please sign in.', code: 'signed_out' })
}

interface GoogleTokenInfo {
  aud?: string
  iss?: string
  email?: string
  email_verified?: string | boolean
  name?: string
  picture?: string
  exp?: string
}

/** Checks a Google ID token with Google and returns the person, or an error message. */
export async function verifyGoogleToken(
  credential: string,
  fetchFn: typeof fetch = fetch,
): Promise<SessionUser | { error: string }> {
  const res = await fetchFn('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential))
  if (!res.ok) return { error: 'Google could not confirm this sign-in. Try again.' }
  const info = (await res.json()) as GoogleTokenInfo
  if (info.aud !== clientId()) return { error: 'This sign-in was made for a different app.' }
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com')
    return { error: 'This sign-in did not come from Google.' }
  if (!info.email || !(info.email_verified === true || info.email_verified === 'true'))
    return { error: 'Your Google email is not verified.' }
  if (Number(info.exp) * 1000 < Date.now()) return { error: 'This sign-in has expired. Try again.' }
  if (!isAllowedEmail(info.email)) return { error: 'This account doesn’t have access. Use your 1BT Google account.' }
  return { email: info.email.toLowerCase(), name: info.name || info.email, picture: info.picture }
}

/** Writes one activity record (sign in, sign out). Best effort: never blocks the request. */
export async function logActivity(email: string, action: string, detail?: Record<string, unknown>) {
  try {
    const db = await getDb()
    await db?.collection('activity').insertOne({ at: new Date(), email, action, ...(detail ? { detail } : {}) })
  } catch {
    /* the log must never stop someone working */
  }
}

/**
 * /api/auth
 *   GET    → { mode, clientId, user }   (public: tells the sign-in screen what to show)
 *   POST   { credential } → signs in and sets the session cookie
 *   DELETE → signs out
 */
export async function handleAuth(request: Request, fetchFn: typeof fetch = fetch): Promise<Response> {
  const mode = authMode()
  if (request.method === 'GET') return json(200, { mode, clientId: clientId() || null, user: readSession(request) })

  if (request.method === 'DELETE') {
    const user = readSession(request)
    if (user && mode === 'on') await logActivity(user.email, 'sign_out')
    const res = json(200, { ok: true })
    res.headers.append('Set-Cookie', clearCookie())
    return res
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })
  if (mode !== 'on') return json(503, { error: 'Sign-in isn’t set up on the server.', code: 'auth_not_set_up' })
  let credential: unknown
  try {
    credential = ((await request.json()) as { credential?: unknown }).credential
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
  if (typeof credential !== 'string' || credential.length > 4096) return json(400, { error: 'Missing sign-in token.' })
  const result = await verifyGoogleToken(credential, fetchFn).catch(() => ({
    error: 'Couldn’t reach Google. Try again.',
  }))
  if ('error' in result) return json(403, { error: result.error, code: 'denied' })
  await logActivity(result.email, 'sign_in')
  const res = json(200, { user: result })
  res.headers.append('Set-Cookie', makeSessionCookie(result))
  return res
}
