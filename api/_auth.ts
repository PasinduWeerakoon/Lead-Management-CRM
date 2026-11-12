import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { isHosted, json } from './_db.js'
import { getStore, storeConfigured, type UserRecord } from './_store.js'

/**
 * Email and password sign-in, with no outside service.
 *  - Sign up with email, username and password. The account waits as "pending" until the super admin
 *    approves it. The address in SUPER_ADMIN_EMAIL becomes the super admin as soon as it signs up.
 *  - Passwords are kept only as scrypt hashes. After 8 wrong passwords in a row sign-in pauses for 15 minutes.
 *  - A signed, httpOnly cookie keeps people signed in. Every request also checks the account is still
 *    active (cached for a minute), so a disabled account loses access within a minute.
 *
 * Settings (server only): SESSION_SECRET (32+ characters), SUPER_ADMIN_EMAIL, and a shared store
 * (DATA_TABLE, MONGODB_URI or DATA_STORE=memory). On the local dev server without these, sign-in is
 * off and everyone is a local super admin; when hosted it never is.
 */

export type Role = UserRecord['role']

export interface SessionUser {
  email: string
  name: string
  role: Role
}

const COOKIE = 'lm_session'
const SESSION_DAYS = 14
const MAX_FAILED = 8
const LOCK_MINUTES = 15
const STATUS_CACHE_MS = 60_000

const secret = () => process.env.SESSION_SECRET?.trim() || ''
const superAdminEmail = () => process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() || ''

/** 'on' = sign-in required, 'off' = local dev without settings, 'broken' = hosted but not set up. */
export function authMode(): 'on' | 'off' | 'broken' {
  if (secret().length >= 32 && storeConfigured()) return 'on'
  return isHosted() ? 'broken' : 'off'
}

const LOCAL_USER: SessionUser = { email: 'local@dev', name: 'Local developer', role: 'super_admin' }

// --- passwords ---------------------------------------------------------------------------------

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, 32, SCRYPT)
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64')
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, { ...SCRYPT, N: Number(n) })
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Hashed once, so a sign-in for an unknown email takes as long as one for a real account. */
let dummyHash: Promise<string> | undefined

// --- session cookie ----------------------------------------------------------------------------

const b64 = (s: string) => Buffer.from(s).toString('base64url')
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

export function makeSessionCookie(user: SessionUser, now = Date.now()): string {
  const payload = b64(JSON.stringify({ email: user.email, exp: now + SESSION_DAYS * 86_400_000 }))
  const secure = isHosted() ? '; Secure' : ''
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`
}

const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHosted() ? '; Secure' : ''}`

/** The email in a valid, unexpired cookie, or null. */
function cookieEmail(request: Request, now: number): string | null {
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
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email?: string; exp?: number }
    return typeof data.email === 'string' && typeof data.exp === 'number' && data.exp > now ? data.email : null
  } catch {
    return null
  }
}

// Recently checked accounts, so most requests skip the database read.
const statusCache = new Map<string, { user: SessionUser | null; at: number }>()

/** Call after changing an account, so the change applies at once on this server. */
export function forgetCachedUser(email: string) {
  statusCache.delete(email)
}

const toSession = (u: UserRecord): SessionUser => ({ email: u.email, name: u.username, role: u.role })

/** The signed-in person (active accounts only), or null. */
export async function readSession(request: Request, now = Date.now()): Promise<SessionUser | null> {
  const mode = authMode()
  if (mode === 'off') return LOCAL_USER
  if (mode !== 'on') return null
  const email = cookieEmail(request, now)
  if (!email) return null
  const hit = statusCache.get(email)
  if (hit && now - hit.at < STATUS_CACHE_MS) return hit.user
  const store = await getStore()
  const rec = await store?.getUser(email)
  const user = rec?.status === 'active' ? toSession(rec) : null
  statusCache.set(email, { user, at: now })
  return user
}

/** Used by every data route: a 401 when nobody is signed in, otherwise undefined. */
export async function requireUser(request: Request): Promise<Response | undefined> {
  if (await readSession(request)) return undefined
  if (authMode() === 'broken')
    return json(503, { error: 'Sign-in isn’t set up on the server.', code: 'auth_not_set_up' })
  return json(401, { error: 'Please sign in.', code: 'signed_out' })
}

/** For admin routes: the super admin, or the answer to send back. */
export async function requireSuperAdmin(request: Request): Promise<SessionUser | Response> {
  const user = await readSession(request)
  if (!user) return (await requireUser(request))!
  return user.role === 'super_admin' ? user : json(403, { error: 'Only the super admin can do this.' })
}

// --- sign up and sign in -----------------------------------------------------------------------

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/
const USERNAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{1,38}[\p{L}\p{N}]$/u

const cleanEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const cleanUsername = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

async function signUp(body: Record<string, unknown>): Promise<Response> {
  const email = cleanEmail(body.email)
  const username = cleanUsername(body.username)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!EMAIL.test(email)) return json(400, { error: 'Enter a valid email address.' })
  if (!USERNAME.test(username)) return json(400, { error: 'Username needs 3 to 40 letters, numbers or spaces.' })
  if (password.length < 10) return json(400, { error: 'Use a password of at least 10 characters.' })
  if (password.length > 200) return json(400, { error: 'That password is too long.' })

  const store = (await getStore())!
  const first = email === superAdminEmail()
  const now = new Date().toISOString()
  const created = await store.putUser(
    {
      email,
      username,
      passwordHash: await hashPassword(password),
      role: first ? 'super_admin' : 'user',
      status: first ? 'active' : 'pending',
      createdAt: now,
      updatedAt: now,
    },
    { create: true },
  )
  if (!created) return json(409, { error: 'An account with this email already exists. Sign in instead.' })
  forgetCachedUser(email)
  return first ? json(200, { ok: true, active: true }) : json(200, { ok: true, pending: true })
}

async function signIn(body: Record<string, unknown>): Promise<Response> {
  const email = cleanEmail(body.email)
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : ''
  const wrong = () => json(401, { error: 'Email or password is wrong.', code: 'denied' })
  const store = (await getStore())!
  const user = email ? await store.getUser(email) : undefined
  if (!user) {
    await checkPassword(password, await (dummyHash ??= hashPassword('not-a-real-password')))
    return wrong()
  }
  const now = Date.now()
  if (user.lockedUntil && Date.parse(user.lockedUntil) > now)
    return json(429, { error: `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.`, code: 'locked' })

  if (!(await checkPassword(password, user.passwordHash))) {
    const failed = (user.failedSignIns ?? 0) + 1
    await store.putUser({
      ...user,
      failedSignIns: failed >= MAX_FAILED ? 0 : failed,
      lockedUntil: failed >= MAX_FAILED ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : user.lockedUntil,
    })
    return wrong()
  }
  if (user.status === 'pending')
    return json(403, { error: 'Your account is waiting for the super admin to approve it.', code: 'pending' })
  if (user.status === 'disabled') return json(403, { error: 'This account has been turned off.', code: 'disabled' })

  await store.putUser({
    ...user,
    failedSignIns: 0,
    lockedUntil: undefined,
    lastSignInAt: new Date(now).toISOString(),
  })
  forgetCachedUser(email)
  const session = toSession(user)
  const res = json(200, { user: session })
  res.headers.append('Set-Cookie', makeSessionCookie(session, now))
  return res
}

/**
 * /api/auth
 *   GET    → { mode, user }   (public: tells the sign-in screen what to show)
 *   POST   { action: 'signup', email, username, password } → { pending } or { active }
 *   POST   { action: 'signin', email, password } → signs in and sets the session cookie
 *   DELETE → signs out
 */
export async function handleAuth(request: Request): Promise<Response> {
  const mode = authMode()
  if (request.method === 'GET') return json(200, { mode, user: await readSession(request) })

  if (request.method === 'DELETE') {
    const res = json(200, { ok: true })
    res.headers.append('Set-Cookie', clearCookie())
    return res
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' })
  if (mode !== 'on') return json(503, { error: 'Sign-in isn’t set up on the server.', code: 'auth_not_set_up' })
  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 4000) return json(413, { error: 'Request too large.' })
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return json(400, { error: 'Request body must be JSON.' })
  }
  if (body.action === 'signup') return signUp(body)
  if (body.action === 'signin') return signIn(body)
  return json(400, { error: 'Unknown action.' })
}
