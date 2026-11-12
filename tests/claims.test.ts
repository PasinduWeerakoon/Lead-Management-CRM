import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleAuth } from '../api/_auth'
import { handleClaims } from '../api/_claims'
import { resetStores } from '../api/_store'
import { ranges, shareOrder } from '../src/lib/claims'
import type { Contact } from '../src/lib/schemas'

const post = (path: string, body: unknown, cookie = '', method = 'POST') =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })

async function account(email: string) {
  await handleAuth(post('/api/auth', { action: 'signup', email, username: 'Some One', password: 'long-enough-pw' }))
  const res = await handleAuth(post('/api/auth', { action: 'signin', email, password: 'long-enough-pw' }))
  return (res.headers.get('set-cookie') ?? '').split(';')[0]
}

describe('/api/claims', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'x'.repeat(40)
    process.env.DATA_STORE = 'memory'
    resetStores()
  })
  afterEach(() => {
    for (const k of ['SESSION_SECRET', 'DATA_STORE', 'SUPER_ADMIN_EMAIL']) delete process.env[k]
    resetStores()
  })

  it('hands out the next block in order, and the next person starts where the last stopped', async () => {
    process.env.SUPER_ADMIN_EMAIL = 'a@x.com'
    const a = await account('a@x.com')
    const ids = Array.from({ length: 100 }, (_, i) => `c${i + 1}`)
    const first = (await (await handleClaims(post('/api/claims', { profileId: 'p', ids, count: 30 }, a))).json()) as {
      claimed: string[]
    }
    expect(first.claimed).toEqual(ids.slice(0, 30))

    // A second taker (here the same account, standing in for a colleague) gets 31 onwards, never 1–30.
    const second = (await (await handleClaims(post('/api/claims', { profileId: 'p', ids, count: 10 }, a))).json()) as {
      claimed: string[]
    }
    expect(second.claimed).toEqual(ids.slice(30, 40))

    // Two people at the same moment: no connection is given twice.
    const [x, y] = await Promise.all([
      handleClaims(post('/api/claims', { profileId: 'p', ids, count: 20 }, a)).then((r) => r.json()),
      handleClaims(post('/api/claims', { profileId: 'p', ids, count: 20 }, a)).then((r) => r.json()),
    ])
    const both = [...(x as { claimed: string[] }).claimed, ...(y as { claimed: string[] }).claimed]
    expect(new Set(both).size).toBe(both.length)

    const list = (await (
      await handleClaims(new Request('http://localhost/api/claims?profileId=p', { headers: { cookie: a } }))
    ).json()) as { claims: unknown[]; me: string }
    expect(list.me).toBe('a@x.com')
    expect(list.claims).toHaveLength(40 + both.length)
  })

  it('needs sign-in and a valid amount', async () => {
    expect((await handleClaims(post('/api/claims', { profileId: 'p', ids: ['a'], count: 1 }))).status).toBe(401)
    const a = await (async () => {
      process.env.SUPER_ADMIN_EMAIL = 'a@x.com'
      return account('a@x.com')
    })()
    expect((await handleClaims(post('/api/claims', { profileId: 'p', ids: ['a'], count: 0 }, a))).status).toBe(400)
    expect((await handleClaims(post('/api/claims', { profileId: '../x', ids: ['a'], count: 1 }, a))).status).toBe(400)
  })
})

describe('the shared numbering', () => {
  const c = (id: string, importedAt: string, connectedOn?: string) =>
    ({ id, fullName: id, importedAt, connectedOn }) as Contact

  it('orders oldest import first, then newest connection first, the same way every time', () => {
    const list = [
      c('late-import', '2026-02-01'),
      c('older-conn', '2026-01-01', '2020-01-01'),
      c('newer-conn', '2026-01-01', '2024-01-01'),
    ]
    expect(shareOrder(list).map((x) => x.id)).toEqual(['newer-conn', 'older-conn', 'late-import'])
    expect(shareOrder([...list].reverse()).map((x) => x.id)).toEqual(['newer-conn', 'older-conn', 'late-import'])
  })

  it('shows positions as ranges', () => {
    expect(ranges([3, 1, 2, 5, 7, 8])).toBe('1–3, 5, 7–8')
    expect(ranges([])).toBe('')
  })
})
