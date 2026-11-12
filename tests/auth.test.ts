import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authMode, checkPassword, handleAuth, hashPassword, readSession, requireUser } from '../api/_auth'
import { handleAdmin } from '../api/_admin'
import { fitRun, handleData } from '../api/_routes'
import { resetStores } from '../api/_store'

const ADMIN = 'boss@example.com'
const auth = (body: Record<string, string>) =>
  handleAuth(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]
const as = (cookie: string, path: string, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    ...init,
    headers: { cookie, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  })
const signUp = (email: string, username = 'Some Person', password = 'long-enough-pw') =>
  auth({ action: 'signup', email, username, password })
const signIn = (email: string, password = 'long-enough-pw') => auth({ action: 'signin', email, password })
const setAccount = (cookie: string, body: Record<string, string>) =>
  handleAdmin(as(cookie, '/api/admin', { method: 'POST', body: JSON.stringify({ op: 'set', ...body }) }))

describe('email and password sign-in', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'x'.repeat(40)
    process.env.DATA_STORE = 'memory'
    process.env.SUPER_ADMIN_EMAIL = ADMIN
    resetStores()
  })
  afterEach(() => {
    for (const k of ['SESSION_SECRET', 'DATA_STORE', 'SUPER_ADMIN_EMAIL', 'VERCEL']) delete process.env[k]
    resetStores()
  })

  it('is off on the local dev server without settings, and refuses when hosted', async () => {
    delete process.env.SESSION_SECRET
    expect(authMode()).toBe('off')
    expect((await readSession(new Request('http://localhost/')))?.role).toBe('super_admin')
    process.env.VERCEL = '1'
    expect(authMode()).toBe('broken')
    expect((await requireUser(new Request('http://localhost/')))?.status).toBe(503)
  })

  it('keeps passwords only as salted hashes', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    expect(a).not.toBe(b)
    expect(a).not.toContain('correct')
    expect(await checkPassword('correct horse battery', a)).toBe(true)
    expect(await checkPassword('wrong', a)).toBe(false)
  })

  it('makes the super admin active at once, and new accounts wait for approval', async () => {
    expect(await (await signUp(ADMIN, 'Boss')).json()).toMatchObject({ active: true })
    const admin = cookieOf(await signIn(ADMIN))
    expect(admin).toMatch(/^lm_session=/)
    expect((await readSession(as(admin, '/')))?.role).toBe('super_admin')

    expect(await (await signUp('new@example.com')).json()).toMatchObject({ pending: true })
    const waiting = await signIn('new@example.com')
    expect(waiting.status).toBe(403)
    expect(((await waiting.json()) as { code: string }).code).toBe('pending')

    expect((await setAccount(admin, { email: 'new@example.com', status: 'active' })).status).toBe(200)
    const user = cookieOf(await signIn('new@example.com'))
    expect(await requireUser(as(user, '/api/profiles'))).toBeUndefined()

    // Turned off: the next request is refused, even with a valid cookie.
    await setAccount(admin, { email: 'new@example.com', status: 'disabled' })
    expect((await requireUser(as(user, '/api/profiles')))?.status).toBe(401)
  })

  it('refuses duplicate emails, short passwords and wrong passwords, and pauses after 8 wrong ones', async () => {
    await signUp(ADMIN)
    expect((await signUp(ADMIN)).status).toBe(409)
    expect((await signUp('x@example.com', 'Name', 'short')).status).toBe(400)
    expect((await signIn(ADMIN, 'not-the-password')).status).toBe(401)
    expect((await signIn('nobody@example.com')).status).toBe(401)
    for (let i = 0; i < 7; i++) await signIn(ADMIN, 'not-the-password')
    expect((await signIn(ADMIN)).status).toBe(429)
  })

  it('keeps the admin pages to the super admin, who sees every account and search with its owner', async () => {
    await signUp(ADMIN)
    const admin = cookieOf(await signIn(ADMIN))
    await signUp('user@example.com', 'User One')
    await setAccount(admin, { email: 'user@example.com', status: 'active' })
    const user = cookieOf(await signIn('user@example.com'))

    expect((await handleAdmin(as(user, '/api/admin?op=users'))).status).toBe(403)
    expect((await setAccount(admin, { email: ADMIN, status: 'disabled' })).status).toBe(400)

    const users = (await (await handleAdmin(as(admin, '/api/admin?op=users'))).json()) as {
      users: Array<Record<string, unknown>>
    }
    expect(users.users.map((u) => u.email)).toEqual([ADMIN, 'user@example.com'])
    expect(JSON.stringify(users)).not.toContain('scrypt')

    const { handleProfiles } = await import('../api/_routes')
    await handleProfiles(
      as(user, '/api/profiles', { method: 'POST', body: JSON.stringify({ id: 'team', name: 'Team' }) }),
    )
    const run = {
      briefName: 'Ex-consultants',
      briefText: 'Worked at a consulting firm',
      at: '2026-11-12T10:00:00Z',
      total: 2,
      criteria: ['Worked at a consulting firm'],
      people: [
        { id: 'a', name: 'A', score: 80, priority: 'High', reason: 'r', checks: [{ status: 'met' }] },
        { id: 'b', name: 'B', score: 30, priority: 'Low', reason: 'r', checks: [{ status: 'met' }] },
      ],
    }
    await handleData(
      as(user, '/api/data', {
        method: 'POST',
        body: JSON.stringify({
          profileId: 'team',
          table: 'scoreRuns',
          upserts: [{ id: 'r1', data: run }],
          deletes: [],
        }),
      }),
    )
    const list = (await (await handleAdmin(as(admin, '/api/admin?op=searches'))).json()) as {
      searches: Array<Record<string, unknown>>
    }
    expect(list.searches).toEqual([
      expect.objectContaining({
        id: 'r1',
        by: 'user@example.com',
        profileName: 'Team',
        shortlisted: 1,
        partly: 1,
        scored: 2,
      }),
    ])
    const one = (await (await handleAdmin(as(admin, '/api/admin?op=search&profileId=team&id=r1'))).json()) as {
      search: { people: unknown[] }
    }
    expect(one.search.people).toHaveLength(2)
  })
})

describe('fitting a large search into one database item', () => {
  it('drops the step log, shortens reasons, then keeps the top people', () => {
    const people = Array.from({ length: 4000 }, (_, i) => ({
      id: `p${i}`,
      name: `Person ${i}`,
      score: i % 100,
      priority: 'Low',
      reason: 'x'.repeat(400),
      checks: [{ criterion: 'c', status: 'met', evidence: 'e'.repeat(300) }],
    }))
    const out = fitRun({ briefName: 'Big', log: [{ text: 'step' }], people })
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(360_000)
    expect(out.log).toBeUndefined()
    expect(out.trimmed).toBe(true)
    const kept = out.people as Array<{ score: number }>
    expect(kept.length).toBeGreaterThan(50)
    expect(Math.min(...kept.map((p) => p.score))).toBeGreaterThan(0)
    expect(fitRun({ briefName: 'Small', people: people.slice(0, 2) }).trimmed).toBeUndefined()
  })
})

describe('the main super admin on the Admin page', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'x'.repeat(40)
    process.env.DATA_STORE = 'memory'
    process.env.SUPER_ADMIN_EMAIL = ADMIN
    resetStores()
  })
  afterEach(() => {
    for (const k of ['SESSION_SECRET', 'DATA_STORE', 'SUPER_ADMIN_EMAIL']) delete process.env[k]
    resetStores()
  })

  it('is listed only to itself, and another super admin cannot change it', async () => {
    await signUp(ADMIN)
    const main = cookieOf(await signIn(ADMIN))
    await signUp('second@example.com', 'Second Admin')
    await setAccount(main, { email: 'second@example.com', status: 'active' })
    await setAccount(main, { email: 'second@example.com', role: 'super_admin' })
    const second = cookieOf(await signIn('second@example.com'))

    const emails = async (cookie: string) =>
      (
        (await (await handleAdmin(as(cookie, '/api/admin?op=users'))).json()) as { users: Array<{ email: string }> }
      ).users.map((u) => u.email)
    expect(await emails(main)).toEqual([ADMIN, 'second@example.com'])
    expect(await emails(second)).toEqual(['second@example.com'])
    expect((await setAccount(second, { email: ADMIN, status: 'disabled' })).status).toBe(404)
    expect((await setAccount(second, { email: ADMIN, role: 'user' })).status).toBe(404)
    expect((await readSession(as(main, '/')))?.role).toBe('super_admin')
  })
})
